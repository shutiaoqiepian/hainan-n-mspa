import { KINDS, aodBand, levelOf } from '@/data/forecast/levels'
import { matchPhenomena } from '@/data/forecast/phenomena'
import { MULTI_MODELS } from '@/data/forecast/models'
import { DETAIL_SPOT, dataFileFor, spotsFor } from '@/data/forecast/spots'
import { cloudProfile, syntheticProfile } from './clouds'
import { conflictsOf, interpret } from './interpret'
import {
  clarityOf, clamp, crepuscularOf, lclMeters, pillarOf, profileOf, rainbowHint, rainbowOf, scoreOf
} from './scoring'
import { state } from './state'
import { faceMatch, sunPosition } from './sun'
import { nextUpdateMs, parseIso } from './time'
import type {
  CacheData, CloudLayer, DataQuality, Detail, DetailHour, Interpretation, Measure, Phototip, RawData, RawPoint, RawSeries, Row, Spot, SpotDetail, StaticFile, SunPos
} from './types'

/* ---------- 工具 ---------- */

export function hourIndex(times: string[], isoTime: string): number {
  if (!times || !times.length || !isoTime) return -1
  const want = isoTime.slice(0, 13) + ':00'
  const i = times.indexOf(want)
  if (i >= 0) return i

  /* 退路：找最接近的一小时 */
  const target = new Date(isoTime).getTime()
  let best = -1
  let bestDiff = Infinity
  for (let k = 0; k < times.length; k++) {
    const d = Math.abs(new Date(times[k]).getTime() - target)
    if (d < bestDiff) { bestDiff = d; best = k }
  }
  return best
}

/* w.hourly.time 一定是字符串数组；缺失时当空数组（旧版会直接抛错） */
function hourTimes(w: RawPoint): string[] {
  const t = w.hourly?.time
  return Array.isArray(t) ? (t as string[]) : []
}

function addMin(t: string, delta: number): string {
  const p = String(t).split(':')
  const d = new Date(2000, 0, 1, Number(p[0]), Number(p[1]))
  d.setMinutes(d.getMinutes() + delta)
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
}

/* ---------- 坐标去重 ----------
   大坑：Open-Meteo 会先把坐标吸附到自己网格的中心点，**然后再去重**。
   海口市区那几个机位（观海台/假日海滩/西秀海滩/云洞/世纪大桥/白沙门）
   原始经纬度各不相同，但吸附后全落在 (20.00, 110.25) 同一格，
   于是接口只回一条、后面几位的数组里是空对象 —— 表现为「机位并行错位、
   有的机位永远没数据、有的机位显示的其实是别的机位的气象」。
   解决：请求只发**吸附后的唯一坐标**，响应再按坐标映射回机位。 */
let snapGrid = 0.03

export function snapKey(lat: number, lon: number): string {
  const g = snapGrid
  return (Math.round(lat / g) * g).toFixed(3) + ',' + (Math.round(lon / g) * g).toFixed(3)
}

/** 从实际返回值里学出吸附网格（0.05 / 0.0625 / 0.1 / 0.125 度），下次请求就按它去重 */
function learnGrid(points: RawPoint[]): void {
  const p0 = points[0]
  if (!p0 || typeof p0.latitude !== 'number') return
  for (const g of [0.05, 0.0625, 0.1, 0.125]) {
    const r = (p0.latitude as number) / g
    if (Math.abs(Math.abs(r) - Math.round(r)) < 1e-6) {
      snapGrid = g
      return
    }
  }
}

/** 建立「机位序号 → 响应数组下标」的映射。
    Open-Meteo 按各自模式的格点吸附后**去重**，回来的点数通常少于机位数，
    所以不能用「一一对应」，只能每个机位认领**离它最近**的那一条（允许多个机位共用）。 */
function bindGrid(points: RawPoint[], spots: Spot[]): number[] {
  learnGrid(points)

  const hasCoords = points.length > 0 && points.every((p) => typeof p.latitude === 'number')
  if (!hasCoords) return spots.map((_, i) => Math.min(i, points.length - 1))

  return spots.map((s) => {
    let best = 0
    let bestD = Infinity
    points.forEach((p, i) => {
      const d = Math.abs((p.latitude as number) - s.lat) + Math.abs((p.longitude as number) - s.lon)
      if (d < bestD) { bestD = d; best = i }
    })
    return best
  })
}

/* 请求里要带的唯一坐标（按第一次出现的顺序） */
function uniqueCoords(spots: Spot[]): Array<{ lat: number; lon: number }> {
  const seen = new Set<string>()
  const out: Array<{ lat: number; lon: number }> = []
  for (const s of spots) {
    const k = snapKey(s.lat, s.lon)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ lat: s.lat, lon: s.lon })
  }
  return out
}

/* ---------- 取数 ---------- */
export function buildUrl(host: string, params: string, models: string[] | null): string {
  const coords = uniqueCoords(spotsFor(state.prov))
  const lats = coords.map((c) => c.lat).join(',')
  const lons = coords.map((c) => c.lon).join(',')
  const m = models && models.length ? '&models=' + models.join(',') : ''
  return host + '?latitude=' + lats + '&longitude=' + lons + '&' + params + m +
         '&timezone=Asia%2FShanghai&forecast_days=2'
}

export function modelsForRequest(): string[] {
  if (!state.model || state.model === 'multi') return MULTI_MODELS
  return [state.model]
}

/* 单个模式取一个变量；只有一个模式时 Open-Meteo 返回不带后缀的键 */
export function fieldOf(
  hourly: Record<string, RawSeries> | undefined,
  base: string,
  mid: string,
  k: number
): number | null {
  if (!hourly) return null
  const a = hourly[base + '_' + mid] || hourly[base]
  if (!a) return null
  const v = a[k]
  return typeof v === 'number' ? v : null
}

/* 带超时 + 重试：手机网络下偶发挂住，不能让页面一直转圈 */
export function fetchJson(url: string, tries = 2): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => {
    try { ctl.abort() } catch { /* 忽略 */ }
  }, 15000)

  function done(): void {
    clearTimeout(timer)
  }

  return fetch(url, { signal: ctl.signal })
    .then((r) => {
      done()
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .catch((err: unknown) => {
      done()
      if (tries > 1) return fetchJson(url, tries - 1)
      throw err
    })
}

/* 取某一小时的观测集合（多模式时取平均） */
export function measureAt(
  w: RawPoint,
  airObj: RawPoint | null | undefined,
  k: number,
  models?: string[]
): Measure {
  const mids = models || modelsForRequest()

  function avg(base: string): number | null {
    const vals: number[] = []
    for (let i = 0; i < mids.length; i++) {
      const v = fieldOf(w.hourly, base, mids[i], k)
      if (v != null) vals.push(v)
    }
    if (!vals.length) return null   /* 没数据 ≠ 0% 云 */
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  /* AOD 缺测时填 0.2（气溶胶不清澈也不脏），但要记下来 ——
     否则「没数据」和「空气一般」在界面上长得一模一样。 */
  let aod = 0.2
  let aodMissing = true
  if (airObj && airObj.hourly && airObj.hourly.aerosol_optical_depth) {
    const v2 = airObj.hourly.aerosol_optical_depth[k]
    if (typeof v2 === 'number') { aod = v2; aodMissing = false }
  }

  return {
    high: avg('cloud_cover_high'),
    mid: avg('cloud_cover_mid'),
    low: avg('cloud_cover_low'),
    rh: avg('relative_humidity_2m'),
    pop: avg('precipitation_probability'),
    t2m: avg('temperature_2m'),
    td2m: avg('dew_point_2m'),
    vis: avg('visibility'),
    aod: aod,
    aodMissing: aodMissing
  }
}

/** 关键字段完整度：把「天气不好」和「没有数据」分开。
    这几个字段任一缺测，scoreOf 都会用固定不利值兜底，
    所以缺得越多，分数越不可信，而不是「天气越差」。 */
export function qualityOf(m: Measure): DataQuality {
  const missing: string[] = []
  if (m.high == null) missing.push('高云量')
  if (m.mid == null) missing.push('中云量')
  if (m.low == null) missing.push('低云量')
  if (m.rh == null) missing.push('相对湿度')
  if (m.pop == null) missing.push('降水概率')
  if (m.aodMissing) missing.push('气溶胶(AOD)')

  const total = 6
  const completeness = Math.round(100 * (total - missing.length) / total)
  const status: DataQuality['status'] =
    missing.length === 0 ? 'ok' : missing.length <= 2 ? 'partial' : 'poor'
  return { completeness, missing, status }
}


/* 把「唯一坐标响应」摊回 25 个机位；映射失败就退回按顺序 */
function remapBySpots(points: RawData | null, prov: string = state.prov): RawData | null {
  if (!points || !points.length) return null
  const spots = spotsFor(prov)
  const map = bindGrid(points, spots)
  return spots.map((_, i) => points[map[i]] || points[0])
}

/** 动态测出模式格点大小：看返回的坐标能对齐到哪一种网格（0.25 / 0.125 / 0.1 / 0.0625 / 0.05 度） */
const GRID_STEPS = [0.25, 0.125, 0.1, 0.0625, 0.05, 0.04]

function noteGrid(points: RawPoint[]): void {
  const lats = points.map((p) => p.latitude).filter((v): v is number => typeof v === 'number')
  const lons = points.map((p) => p.longitude).filter((v): v is number => typeof v === 'number')
  if (!lats.length) return

  const aligns = (v: number, g: number): boolean => {
    const r = v / g
    return Math.abs(r - Math.round(r)) < 0.02
  }

  let step = 0
  for (const g of GRID_STEPS) {
    if (lats.every((v) => aligns(v, g)) && lons.every((v) => aligns(v, g))) {
      step = g
      break
    }
  }

  if (!step) {
    /* 对不齐（只有一两个机位、或坐标被取整过）就不显示，别给错数字 */
    state.gridNote = ''
    return
  }
  state.gridNote = step.toFixed(step < 0.1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '') +
    ' 度（≈' + Math.round(step * 111) + ' km）'
}

/* ---------- 一次取数的缓存 ---------- */
let CACHE: CacheData | null = null
const CACHE_MS = 10 * 60 * 1000

/* 请求令牌：每次 load() 自增。快速连点省份/日期时，先发出去的那次
   可能在后面返回，把新省份的数据覆盖掉 —— 用令牌把过期响应丢掉。 */
let loadToken = 0

/** 切换模式时丢弃缓存（旧版直接 CACHE = null） */
export function clearCache(): void {
  CACHE = null
}

/* 一次取数，缓存起来：切换今天/明天/日出/日落不再重新请求 */
export function load(force = false): void {
  /* 缓存按省份分开：切到广东时必须重新取，不能拿海南的数据去算 */
  if (CACHE && (CACHE as CacheData & { prov?: string }).prov !== state.prov) CACHE = null

  if (!force && CACHE && Date.now() - CACHE.at < CACHE_MS) {
    compute(CACHE.weather, CACHE.air, CACHE.profs)
    return
  }

  const token = ++loadToken

  if (!force && state.model === 'multi') {
    loadStatic(token)
    return
  }
  loadLive(token)
}

/* 优先读预生成的静态缓存（一天更新 6 次），读不到再现场请求 */
function loadStatic(token: number): void {
  state.loading = true
  state.error = null

  const prov = state.prov
  const file = dataFileFor(prov)
  /* 用浏览器 HTTP 缓存（_headers 里 /data/* 是 max-age=300）：
     5 分钟内重复打开不再发请求，超过 5 分钟浏览器自己带 If-None-Match 换 304。 */
  fetch(file)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then((j: StaticFile) => {
      if (token !== loadToken) return          /* 已经有更新的一次请求了 */
      if (!j || !j.weather || !j.weather.length) throw new Error('缓存为空')
      const at = j.generatedAt ? Date.parse(j.generatedAt) : NaN
      if (!isNaN(at) && Date.now() - at > 14 * 3600 * 1000) throw new Error('缓存过期')

      noteGrid(j.weather)
      CACHE = {
        weather: remapBySpots(j.weather, prov) ?? [],
        air: remapBySpots(j.air ?? null, prov),
        profs: remapBySpots(j.prof ?? null, prov),
        at: isNaN(at) ? Date.now() : at,
        fromStatic: true,
        prov: prov
      } as CacheData
      state.fromStatic = true
      compute(CACHE.weather, CACHE.air, CACHE.profs)
    })
    .catch(() => {
      if (token !== loadToken) return
      state.fromStatic = false
      loadLive(token)
    })
}

function loadLive(token: number): void {
  state.fromStatic = false
  state.loading = true
  state.error = null

  const prov = state.prov
  const mids = modelsForRequest()

  const fUrl = buildUrl(
    'https://api.open-meteo.com/v1/forecast',
    'hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,' +
    'precipitation_probability&daily=sunrise,sunset',
    mids
  )

  const aUrl = buildUrl(
    'https://air-quality-api.open-meteo.com/v1/air-quality',
    'hourly=aerosol_optical_depth,pm2_5',
    null
  )

  /* 高空剖面只用 ECMWF：变量多，全模式取会太大。
     气压层变量是「云种识别」的原料（SunsetBot 大气截面图的同款思路）：
     925/850/700/600/500/300/200 hPa 的云量、湿度、温度、露点、位势高度。 */
  const pUrl = buildUrl(
    'https://api.open-meteo.com/v1/forecast',
    'hourly=' + PROFILE_VARS,
    ['ecmwf_ifs025']
  )

  Promise.all([
    fetchJson(fUrl),
    fetchJson(aUrl).catch(() => null),
    fetchJson(pUrl).catch(() => null)
  ]).then((res) => {
    if (token !== loadToken) return          /* 已经有更新的一次请求了 */
    let weather = res[0] as RawData | RawPoint
    const airRaw = res[1] as RawData | RawPoint | null
    const profRaw = res[2] as RawData | RawPoint | null

    /* 单点时返回对象，多点时返回数组 */
    if (!Array.isArray(weather)) weather = [weather]

    const air = airRaw ? (Array.isArray(airRaw) ? airRaw : [airRaw]) : null
    const profs = profRaw ? (Array.isArray(profRaw) ? profRaw : [profRaw]) : null

    noteGrid(weather)
    CACHE = {
      weather: remapBySpots(weather, prov) ?? [],
      air: remapBySpots(air, prov),
      profs: remapBySpots(profs, prov),
      at: Date.now(),
      fromStatic: false,
      prov: prov
    } as CacheData
    compute(CACHE.weather, CACHE.air, CACHE.profs)
  }).catch((e: unknown) => {
    if (token !== loadToken) return
    state.loading = false
    state.error = '取不到数据：' + (e instanceof Error && e.message ? e.message : '网络错误')
  })
}

/* 气压层变量清单：多层 × 多要素，全部来自 ECMWF IFS。
   与 tools/build-cache.mjs 里的 PROFILE_VARS 必须一致。 */
export const PROFILE_VARS = [
  ...[1000, 925, 850, 700, 600, 500, 300, 200].flatMap((lv) => [
    'cloud_cover_' + lv + 'hPa',
    'relative_humidity_' + lv + 'hPa',
    'temperature_' + lv + 'hPa',
    'geopotential_height_' + lv + 'hPa'
  ]),
  ...[1000, 925, 850, 700].flatMap((lv) => ['dew_point_' + lv + 'hPa']),
  'temperature_2m', 'dew_point_2m', 'visibility',
  'boundary_layer_height', 'cape', 'precipitation', 'wind_speed_10m'
].join(',')

/* 剖面里的单点值：多模式时键名带后缀，优先取不带后缀的 */
function profField(pr: RawPoint, name: string, idx: number): number | null {
  const ph = pr.hourly
  if (!ph) return null
  const a = ph[name] || ph[name + '_ecmwf_ifs025']
  if (!a) return null
  const v = a[idx]
  return typeof v === 'number' ? v : null
}

/* 逐小时：目标时刻前后各 2 小时（趋势图 / 详情表用） */
function buildHours(w: RawPoint, air: RawPoint | null | undefined, idx: number, mids: string[]): DetailHour[] {
  const times = hourTimes(w)
  const hours: DetailHour[] = []
  const start = Math.max(0, idx - 2)
  const end = Math.min(times.length - 1, idx + 2)

  for (let k = start; k <= end; k++) {
    const mm = measureAt(w, air, k, mids)
    hours.push({
      t: times[k].slice(11, 16),
      high: mm.high,
      mid: mm.mid,
      low: mm.low,
      aod: mm.aod,
      pop: mm.pop,
      score: scoreOf(mm)
    })
  }
  return hours
}

/* 一个机位的完整详情：云种剖面 + 自动解读 + 拍摄题材 + 逐小时 */
function buildSpotDetail(o: {
  spot: Spot
  w: RawPoint
  air: RawPoint | null | undefined
  idx: number
  iso: string
  mids: string[]
  m: Measure
  sun: SunPos | null
  score: number
  spread: number
  faceOff: boolean
  cape: number | null
  crep: number
  pillar: number
  clarity: number
  rainbow: number
  cbLow: number | null
  layers: CloudLayer[]
  sheets: ReturnType<typeof cloudProfile>['sheets']
  genusText: string
  profLabel: string
  profMod: number
  ecmwf?: { high: number | null; mid: number | null; low: number | null }
  grid?: string
}): SpotDetail {
  const p = parseIso(o.iso)
  const t = p.time

  /* 性能：interpret / tips / hourly 这三样只有「展开详情」和「生成名片」才用得到，
     列表里 169 个机位一个都用不上。以前每个机位都算一遍，
     等于每次刷新都白算 169 次 58 条天象匹配 + 169 张逐小时表。
     现在改成惰性求值 + 各自缓存，取值时机变了，算出来的结果完全一样。 */
  let itCache: Interpretation | null = null
  let tipsCache: Phototip[] | null = null
  let hoursCache: DetailHour[] | null = null

  const detail: SpotDetail = {
    spot: o.spot,
    date: p.date,
    weekday: p.weekday,
    time: t,
    sunEl: o.sun ? Math.round(o.sun.el * 10) / 10 : null,
    sunAz: o.sun ? Math.round(o.sun.az) : null,
    golden: addMin(t, -30) + ' – ' + t,
    blue: addMin(t, 14) + ' – ' + addMin(t, 34),
    layers: o.layers,
    sheets: o.sheets,
    genusText: o.genusText,
    conflicts: o.ecmwf ? conflictsOf(o.m, o.ecmwf) : [],
    grid: o.grid ?? '',
    get interpret(): Interpretation {
      if (!itCache) {
        itCache = interpret({
          kind: state.kind,
          score: o.score,
          levelName: levelOf(o.score).name,
          m: o.m,
          sun: o.sun,
          spread: o.spread,
          faceOff: o.faceOff,
          face: o.spot.face,
          cloudBaseLow: o.cbLow,
          layers: o.layers,
          cape: o.cape,
          day: state.day,
          profileLabel: o.profLabel,
          profileMod: o.profMod
        })
      }
      return itCache
    },
    get tips(): Phototip[] {
      if (!tipsCache) {
        tipsCache = matchPhenomena({
          kind: state.kind,
          score: o.score,
          high: o.m.high ?? 0,
          mid: o.m.mid ?? 0,
          low: o.m.low ?? 0,
          aod: o.m.aod,
          pop: o.m.pop ?? 0,
          rh: o.m.rh,
          vis: o.m.vis,
          cape: o.cape,
          sunEl: o.sun ? o.sun.el : null,
          crep: o.crep,
          pillar: o.pillar,
          clarity: o.clarity,
          rainbow: o.rainbow,
          cloudBaseLow: o.cbLow,
          spread: o.spread,
          faceOff: o.faceOff,
          layers: o.layers,
          t2m: o.m.t2m
        })
      }
      return tipsCache
    },
    get hourly(): DetailHour[] {
      if (!hoursCache) hoursCache = buildHours(o.w, o.air, o.idx, o.mids)
      return hoursCache
    }
  }

  return detail
}

function compute(weather: RawData, air: RawData | null, profs: RawData | null): void {
  state.detail = null
  const cfg = KINDS[state.kind]
  const rows: Row[] = []
  const mids = modelsForRequest()

  spotsFor(state.prov).forEach((spot, i) => {
    const w = weather[i] || weather[0]
    if (!w) return

    /* 多模式时 daily 也会带模式后缀，取第一个有的 */
    let dayList: RawSeries | null = null
    if (w.daily) {
      dayList = w.daily[cfg.key + '_' + mids[0]] || w.daily[cfg.key] || null
      if (!dayList) {
        for (let mi = 0; mi < mids.length; mi++) {
          if (w.daily[cfg.key + '_' + mids[mi]]) { dayList = w.daily[cfg.key + '_' + mids[mi]]; break }
        }
      }
    }
    if (!dayList) return

    const iso = String(dayList[Math.min(state.day, dayList.length - 1)])
    const times = hourTimes(w)
    const idx = hourIndex(times, iso)
    if (idx < 0) return

    const airObj = air && air[i] ? air[i] : null
    const pr = profs && profs[i] ? profs[i] : null

    const m = measureAt(w, airObj, idx, mids)
    m.time = iso.slice(11, 16)

    /* 温度、露点、能见度只从 ECMWF 剖面取（避免多模式请求过大） */
    if (pr && pr.hourly) {
      m.t2m = profField(pr, 'temperature_2m', idx)
      m.td2m = profField(pr, 'dew_point_2m', idx)
      m.vis = profField(pr, 'visibility', idx)
    }

    /* 太阳位置与机位朝向。
       以前评分用整点、详情用精确日落时刻，两处方位最多差 30 分钟，
       行内「太阳方位」和详情面板会打架。现在统一用精确时刻。 */
    let sun: SunPos | null = null
    let face = 1
    const ms = Date.parse(iso + (iso.length === 16 ? ':00' : '') + '+08:00')
    if (!isNaN(ms)) sun = sunPosition(ms, spot.lat, spot.lon)
    if (sun) face = faceMatch(spot, sun.az)

    const sunExact: SunPos | null = sun

    /* 每个模式各算一遍：平均值当结果，标准差当“可信度” */
    let perModel: number[] = []
    mids.forEach((mid) => {
      const mm = measureAt(w, airObj, idx, [mid])
      if (mm.high == null) return          /* 这个模式没给数据，不参与统计 */
      perModel.push(scoreOf(mm))
    })
    if (!perModel.length) perModel = [scoreOf(m)]

    const mean = perModel.reduce((a, b) => a + b, 0) / perModel.length
    const variance = perModel.reduce((a, b) => a + (b - mean) * (b - mean), 0) / perModel.length
    const spread = Math.round(Math.sqrt(variance))

    /* 逐时平滑 */
    const s1 = scoreOf(m)
    const sPrev = idx > 0 ? scoreOf(measureAt(w, airObj, idx - 1, mids)) : s1
    const sNext = idx < times.length - 1
      ? scoreOf(measureAt(w, airObj, idx + 1, mids))
      : s1

    let score = 0.25 * sPrev + 0.5 * s1 + 0.25 * sNext

    /* 模式分歧越大，分数越不可信 → 直接打折（最多扣 28%） */
    if (mids.length > 1) {
      score = score * (1 - Math.min(0.28, spread / 55))
    }

    /* 朝向匹配 */
    if (sun) score = Math.round(score * face)

    /* 高空湿度剖面（旧口径，保留以便和历史分数对比） */
    const prof = profileOf(pr, idx)
    if (prof) score = clamp(Math.round(score * prof.mod), 0, 100)

    /* 时效折扣 */
    if (state.day === 1) score = Math.round(score * 0.95)
    score = clamp(score, 0, 96)

    /* ---- 其它几种“值得跑”的条件 ---- */
    let cape: number | null = null
    let z850: number | null = null
    let t850: number | null = null
    let td850: number | null = null
    if (pr && pr.hourly) {
      cape = profField(pr, 'cape', idx)
      z850 = profField(pr, 'geopotential_height_850hPa', idx)
      t850 = profField(pr, 'temperature_850hPa', idx)
      td850 = profField(pr, 'dew_point_850hPa', idx)
    }

    const pop = m.pop ?? 0
    const rainNear = rainbowHint(spot, times, idx, prof, (k) => measureAt(w, null, k, mids).pop)
    const clarity = clarityOf(m)
    const rainbow = rainbowOf(m, sun, cape, rainNear)

    /* 云底：地面 LCL 当中低云底；850hPa 层推中层云底 */
    const cbLow = lclMeters(m.t2m, m.td2m)
    let cbMid: number | null = null
    if (z850 != null && t850 != null && td850 != null) {
      const lcl850 = lclMeters(t850, td850)
      cbMid = lcl850 != null ? Math.round(z850 - lcl850) : null
    }

    /* 云层剖面与云种（SunsetBot 大气截面图的同款思路） */
    const prof2 = cloudProfile(pr, idx, { pop, cape, sunEl: sun ? sun.el : null })
    let layers = prof2.layers
    let sheets = prof2.sheets
    let genusText = prof2.genusText
    if (!layers.length) {
      const syn = syntheticProfile(m, pr, idx, cape, pop)
      layers = syn.layers
      sheets = syn.sheets
      genusText = syn.genusText
    }

    /* 光柱与云隙光分开算（用精确时刻的太阳高度） */
    const crep = crepuscularOf(m, sunExact, { face, cloudBase: cbLow })
    const pillar = pillarOf(m, sunExact, layers)
    const faceOff = face < 0.85

    /* ECMWF 单模式的三档云量：云种剖面就是用这套，和上面的平均值对照用 */
    const ecmM = mids.length > 1 ? measureAt(w, airObj, idx, ['ecmwf_ifs025']) : null
    const gridText = typeof w.latitude === 'number' && typeof w.longitude === 'number'
      ? (w.latitude as number).toFixed(2) + '°N, ' + (w.longitude as number).toFixed(2) + '°E'
      : ''

    const detail = buildSpotDetail({
      spot, w, air: airObj, idx, iso, mids, m, sun: sunExact, score, spread, faceOff,
      cape, crep, pillar, clarity, rainbow, cbLow, layers, sheets, genusText,
      profLabel: prof ? prof.label : '', profMod: prof ? prof.mod : 1,
      ecmwf: ecmM ? { high: ecmM.high, mid: ecmM.mid, low: ecmM.low } : undefined,
      grid: gridText
    })

    if (spot.n === DETAIL_SPOT) state.detail = detail

    rows.push({
      spot: spot,
      m: m,
      score: score,
      rawScore: s1,
      quality: qualityOf(m),
      level: levelOf(score),
      aodName: aodBand(m.aod).name,
      profLabel: prof ? prof.label : '',
      rainbow: rainbow >= 35,
      rainbowScore: rainbow,
      clarity: clarity,
      rays: crep,
      pillar: pillar,
      spread: spread,
      models: perModel.length,
      cloudBaseLow: cbLow,
      cloudBaseMid: cbMid,
      sunAz: sun ? Math.round(sun.az) : null,
      faceOff: faceOff,
      date: iso.slice(0, 10),
      ms: ms,
      detail: detail
    })
  })

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    /* 同分时把“拍不到”的机位排后面 */
    if (a.faceOff !== b.faceOff) return a.faceOff ? 1 : -1
    return 0
  })

  state.rows = rows
  state.loading = false
  state.error = null
  state.updatedAt = CACHE ? CACHE.at : Date.now()
  state.nextUpdateAt = nextUpdateMs()

  /* 预报目标：所有机位同一天，取第一行的日期与时刻 */
  const first = rows[0]
  if (first && first.detail) {
    state.targetDate = first.detail.date
    state.targetTime = first.detail.time
  }
}
