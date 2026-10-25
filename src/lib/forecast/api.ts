import { KINDS, aodBand, levelOf } from '@/data/forecast/levels'
import { matchPhenomena } from '@/data/forecast/phenomena'
import { ALL_MODELS, MODELS, MULTI_MODELS } from '@/data/forecast/models'
import { DETAIL_SPOT, dataFileFor, spotsFor } from '@/data/forecast/spots'
import { cloudProfile, syntheticProfile } from './clouds'
import { conflictsOf, interpret } from './interpret'
import {
  airmass, clarityOf, clarityLabel, clamp, crepuscularOf, lclMeters, pillarOf, profileOf,
  rainbowHint, rainbowOf, scoreOf, scoreOfAt, vividLabel, vividnessOf
} from './scoring'
import { state } from './state'
import { faceMatch, sunPosition } from './sun'
import { nextUpdateMs, parseIso } from './time'
import type {
  CacheData, CloudLayer, DataQuality, Detail, DetailHour, HorizonCols, Interpretation, KindKey, Measure, Phototip, RawData, RawPoint, RawSeries, Row, Spot, SpotDetail, StaticFile, SunPos
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
  if (!state.model || state.model === 'multi') return ALL_MODELS
  return [state.model]
}

/** 多模式实际拿来做平均与分歧统计的三个（参考模式只展示、不计分） */
export function scoringModels(): string[] {
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
  return Number.isFinite(v) ? (v as number) : null
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
    if (Number.isFinite(v2)) { aod = v2 as number; aodMissing = false }
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

/** 值是否可参与计算：排除 null / NaN / Infinity / 超出物理范围的值。
    （只判 `typeof === 'number'` 是不够的 —— NaN 也是 number，会一路传到分数上，
    页面上就会显示「NaN」。） */
export function validNumber(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  if (v < min || v > max) return null
  return v
}

/** 地平线遮挡系数（缺口 1）。
    看的是「太阳升起/落下那个方向」60 km 外的柱状云，而不是头顶的云。
    太阳高度贴近 0° 时，光线是横着穿过低层的：西边一排低云就能把整条光路挡掉，
    而头顶可能是晴的。返回 1 = 那个方向干净；越小越挡。
    旧缓存没有这个字段时返回 1，等于不启用。 */
export function horizonBlockOf(
  cols: HorizonCols | null | undefined,
  kind: KindKey,
  idx: number
): number {
  if (!cols) return 1
  const col = kind === 'sunrise' ? cols.east : cols.west
  if (!col || !col.hourly) return 1

  const pick = (name: string): number | null => {
    const a = col.hourly?.[name]
    if (!a) return null
    const v = a[idx]
    return Number.isFinite(v) ? (v as number) : null
  }

  const low = pick('cloud_cover_low')
  const mid = pick('cloud_cover_mid')

  let block = 1
  if (low != null) block -= 0.45 * clamp((low - 25) / 60, 0, 1)   /* 低云 25% 起扣，85% 扣满 0.45 */
  if (mid != null) block -= 0.15 * clamp((mid - 65) / 35, 0, 1)   /* 中云 65% 起扣，最多 0.15 */
  return clamp(block, 0.4, 1)
}

/** 关键字段完整度：把「天气不好」和「没有数据」分开。
    这几个字段任一缺测，scoreOf 都会用固定不利值兜底，
    所以缺得越多，分数越不可信，而不是「天气越差」。 */
export function qualityOf(m: Measure): DataQuality {
  const missing: string[] = []
  if (validNumber(m.high, 0, 100) == null) missing.push('高云量')
  if (validNumber(m.mid, 0, 100) == null) missing.push('中云量')
  if (validNumber(m.low, 0, 100) == null) missing.push('低云量')
  if (validNumber(m.rh, 0, 100) == null) missing.push('相对湿度')
  if (validNumber(m.pop, 0, 100) == null) missing.push('降水概率')
  if (m.aodMissing || validNumber(m.aod, 0, 5) == null) missing.push('气溶胶(AOD)')

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

/** 给离线工具（效果图 / 快照脚本）读原始 hourly 用；线上页面不调用 */
export function rawCache(): CacheData | null { return CACHE }
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
    compute(CACHE.weather, CACHE.air, CACHE.profs, CACHE.horizon)
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
        /* 地平线柱在缓存文件里已按机位顺序排好，不需要再按坐标映射 */
        horizon: j.horizon ?? null,
        at: isNaN(at) ? Date.now() : at,
        fromStatic: true,
        prov: prov
      } as CacheData
      state.fromStatic = true
      compute(CACHE.weather, CACHE.air, CACHE.profs, CACHE.horizon)
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
      /* 实时路径不抓地平线柱：显式置空，避免沿用上一次缓存的残余 */
      horizon: null,
      at: Date.now(),
      fromStatic: false,
      prov: prov
    } as CacheData
    compute(CACHE.weather, CACHE.air, CACHE.profs, CACHE.horizon)
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
  return Number.isFinite(v) ? (v as number) : null
}

/* 逐小时：目标时刻前后各 2 小时（趋势图 / 详情表用） */
function buildHours(
  w: RawPoint,
  air: RawPoint | null | undefined,
  idx: number,
  mids: string[],
  c0: Spot
): DetailHour[] {
  const times = hourTimes(w)
  const hours: DetailHour[] = []
  const start = Math.max(0, idx - 2)
  const end = Math.min(times.length - 1, idx + 2)

  for (let k = start; k <= end; k++) {
    const mm = measureAt(w, air, k, mids)
    const msK = Date.parse(times[k].slice(0, 16) + ':00+08:00')
    const sz = isNaN(msK) ? null : sunPosition(msK, c0.lat, c0.lon)
    const clarK = clarityOf(mm)
    const vivK = sz ? vividnessOf(mm, sz) : 0
    hours.push({
      t: times[k].slice(11, 16),
      high: mm.high,
      mid: mm.mid,
      low: mm.low,
      aod: mm.aod,
      pop: mm.pop,
      score: scoreOf(mm),
      sunEl: sz ? Math.round(sz.el * 10) / 10 : null,
      clarity: clarK,
      clarityLabel: clarityLabel(clarK),
      vivid: vivK,
      vividLabel: sz ? vividLabel(vivK) : '',
      aodName: aodBand(mm.aod).name
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
      if (!hoursCache) hoursCache = buildHours(o.w, o.air, o.idx, o.mids, o.spot)
      return hoursCache
    }
  }

  return detail
}

function compute(weather: RawData, air: RawData | null, profs: RawData | null, horizon?: Array<HorizonCols | null> | null): void {
  state.detail = null
  const cfg = KINDS[state.kind]
  const rows: Row[] = []
  /* mids：计分用的模型（3 个）；allMids：请求下来的全部模型（8 个），
     多的那 5 个只用来展示「各家怎么看」，不参与平均与分歧 */
  const mids = scoringModels()
  const allMids = modelsForRequest()

  const spots = spotsFor(state.prov)
  /* 缓存是按「建缓存那一刻的 spots.json 顺序」存 weather[] 的，索引必须一一对齐。
     spots.json 加了机位但缓存没重跑时，多出来的点会静默退回 weather[0]
     （= 海口西海岸的天气），这种错最难发现，所以显式报一句。 */
  if (Array.isArray(weather) && weather.length && weather.length !== spots.length) {
    console.warn('[forecast] 缓存与机位数量不一致：缓存 ' + weather.length + ' 个点，机位表 ' +
      spots.length + ' 个。多出来的机位会拿到 weather[0] 的数据，请重跑 tools/build-cache.mjs。')
  }

  spots.forEach((spot, i) => {
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
    let perModelScores: number[] = []
    mids.forEach((mid) => {
      const mm = measureAt(w, airObj, idx, [mid])
      if (mm.high == null) return          /* 这个模式没给数据，不参与统计 */
      perModelScores.push(scoreOf(mm))
    })
    if (!perModelScores.length) perModelScores = [scoreOf(m)]

    const mean = perModelScores.reduce((a, b) => a + b, 0) / perModelScores.length
    const variance = perModelScores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / perModelScores.length
    const spread = Math.round(Math.sqrt(variance))

    /* ---------- 逐小时评分（带物理修正）----------
       每个小时用**它自己的太阳高度**去算斜程气溶胶 —— 日落前后太阳高度从 +12° 掉到 −5°，
       光程差两倍以上，用同一个 AOD 值算这三小时是不对的。
       另外两小时内停过雨、现在不再下、而 pop 仍然报得很高时，给一点点回补
       （原实现只看 pop，雨停了还会继续按坏天气罚）。 */
    const hourSunEl = (k: number): number | null => {
      const t = times[k]
      if (!t) return null
      const kms = Date.parse(t.length === 16 ? t + ':00+08:00' : t + '+08:00')
      return isNaN(kms) ? null : sunPosition(kms, spot.lat, spot.lon).el
    }

    const precipAt = (k: number): number | null =>
      pr && pr.hourly && k >= 0 ? profField(pr, 'precipitation', k) : null

    /* 缺口 1：太阳方向的上游柱；旧缓存没有该字段时为 1（不启用） */
    const horizonBlock = horizon && horizon[i] ? horizonBlockOf(horizon[i], state.kind, idx) : 1

    const hourScoreCache = new Map<number, number>()
    /* 基准取窗口内三个小时的平均光程：整个窗口平均下来不改变分数水平，
       只调整小时之间的相对大小（太阳高时气溶胶影响小，太阳低时影响大）。 */
    const winMasses = [idx - 1, idx, idx + 1]
      .map((k) => {
        const e = hourSunEl(k)
        return e == null ? null : airmass(e)
      })
      .filter((v): v is number => v != null)
    const refMass = winMasses.length
      ? winMasses.reduce((a, b) => a + b, 0) / winMasses.length
      : null

    const hourScore = (k: number): number => {
      const hit = hourScoreCache.get(k)
      if (hit != null) return hit

      const mm = measureAt(w, airObj, k, mids)
      let relief = 0
      const now = precipAt(k)
      const prev = precipAt(k - 1)
      if (now != null && prev != null && now <= 0.1 && prev >= 0.3 && (mm.pop ?? 0) >= 50) {
        relief = 1      /* 刚停雨 + 概率还高 → 把被 pop 压掉的分数找回一点 */
      }
      const v = scoreOfAt(mm, {
        sunEl: hourSunEl(k),
        aodRefMass: refMass,
        horizonBlock,
        rainRelief: relief
      })
      hourScoreCache.set(k, v)
      return v
    }

    const rawAt = (k: number): number => {
      if (k < 0 || k >= times.length) return hourScore(idx)
      return hourScore(k)
    }

    /* 每个时刻的「局部平滑值」= 0.25·前一小时 + 0.5·本小时 + 0.25·后一小时 */
    const smoothedAt = (k: number): number =>
      0.25 * rawAt(k - 1) + 0.5 * rawAt(k) + 0.25 * rawAt(k + 1)

    /* ---------- 峰值窗口 ----------
       主分数仍然报「日出/日落正点」这个时刻（与历史分数可比、也不虚高）。
       额外再找一次「正点前后各一小时」里平滑值最高的那个小时，
       作为「更值得蹲的时刻」单独展示：
         · 平稳天气下两者相同，不显示；
         · 连续两三小时都不错时，峰值会明显高于正点，提示用户晚/早半小时出发。
       不拿峰值当主分数，是因为它一定会 ≥ 正点值，会整体抬高全站分数。 */
    const cand = [smoothedAt(idx - 1), smoothedAt(idx), smoothedAt(idx + 1)]
    const peakVal = Math.max(...cand)
    const peakIdx = idx - 1 + cand.indexOf(peakVal)
    const peakTime = times[peakIdx] ? times[peakIdx].slice(11, 16) : (m.time || '')

    /* 高空湿度剖面（旧口径，保留以便和历史分数对比） */
    const prof = profileOf(pr, idx)

    /* 把「正点评分」和「窗口峰值」走同一串折扣，保证两者口径一致 */
    function finish(v: number): number {
      let s = v
      /* 模式分歧越大，分数越不可信 → 直接打折（最多扣 28%） */
      if (mids.length > 1) s = s * (1 - Math.min(0.28, spread / 55))
      /* 朝向匹配 */
      if (sun) s = Math.round(s * face)
      /* 高空湿度剖面 */
      if (prof) s = clamp(Math.round(s * prof.mod), 0, 100)
      /* 时效折扣 */
      if (state.day === 1) s = Math.round(s * 0.95)
      return clamp(s, 0, 96)
    }

    const baseScore = smoothedAt(idx)
    const score = finish(baseScore)
    const peakScore = finish(peakVal)

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

    /* 每个模式自己一份「粗分」：只把逐层云量换成该模式的，其它量共用。
       用来在界面上摊开「各家怎么看」——比只给一个平均值有信息量得多。
       务必标清它是粗分：差异只来自云量，不是完整的单模式预报。 */
    const perModel = allMids.map((mid) => {
      const mm = measureAt(w, airObj, idx, [mid])
      const ok = mm.high != null || mm.mid != null || mm.low != null
      const md = MODELS.find((x) => x.id === mid)
      return {
        id: mid,
        name: md ? md.name : mid,
        tag: md ? md.tag : '',
        ok: ok,
        high: mm.high,
        mid: mm.mid,
        low: mm.low,
        score: ok ? scoreOf(mm) : null
      }
    })

    /* 鲜亮度峰值：窗口内最鲜艳的那一小时。
       和上面的「峰值窗口」是两个不同判断 —— 后者看分数，前者看颜色。 */
    let vividBest = { t: '', sunEl: null as number | null, v: 0, label: '', aod: m.aod }
    for (let k = Math.max(0, idx - 1); k <= Math.min(times.length - 1, idx + 1); k++) {
      const e = hourSunEl(k)
      if (e == null) continue
      const mm = measureAt(w, airObj, k, mids)
      const v = vividnessOf(mm, { el: e, az: 0 })
      if (v > vividBest.v) {
        vividBest = {
          t: times[k].slice(11, 16),
          sunEl: Math.round(e * 10) / 10,
          v: v,
          label: vividLabel(v),
          aod: mm.aod
        }
      }
    }

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

    /* 逐层「会被染成什么色」：用同一套 vividnessOf 口径的色相部分，
       只把「有没有云」换成这一层自己的云量。
       这样横条颜色和顶部「鲜亮度 75 橙金」说的是同一件事，不是另起一套标准。

       ★ 只有「会被照亮」的层才给色相。照不亮的层（太厚/太低）染不出颜色，
         给它一个假颜色会让人以为这层也能出霞——所以那几层返回「无」，
         界面上画成暗色小点。

       ★ 2026-10-25 修：云种剖面只看 ECMWF 单模式的逐层云量，
         所以经常出现「8 层全是无云 / 全照不亮」，但六格里的高云却有 74%。
         原因是计分用的三层云量是多模式平均，ECMWF 恰好报 0。
         这里加两条兜底，避免剖面条在明明有画布时一条都不亮：
           ① 「照不亮」只由云种判定给出；ECMWF 云量足够（≥15%）且本层湿度不像
              厚云（<88%）时，按可被照亮处理（多模式平均说有云，就该有这层）；
           ② 八层全无云、但多模式平均的高/中云量 ≥15% 时，把这些云量挂到
              对应高度段（中云→850/700、高云→500/300/200），让剖面至少画出来。 */
    const levelsRaw = layers.map((l) => l.level)
    const litSet = new Set(layers.filter((l) => l.lit).map((l) => l.level))
    /* ★ 挂起决定（全仓搜「挂起决定」）—— profile-data-source
       下面这段是补丁，不是正解：它让「剖面」和「六格」在模式分歧大时至少
       不自相矛盾，但剖面底层仍然是 ECMWF 单模式、计分仍是三家平均。
       要不要把剖面也改成多模式平均，等 A 级校验样本说话（约 2026-11-25）。
       台账：tools/todo.mjs　说明：交接文档 26.5 */
    const anyCover = layers.some((l) => l.cover >= 8)
    const multiHigh = m.high ?? 0
    const multiMid = m.mid ?? 0

    if (!anyCover && (multiHigh >= 15 || multiMid >= 15)) {
      for (const l of layers) {
        const seg = l.height >= 6000 ? 'high' : l.height >= 2000 ? 'mid' : 'low'
        const v = seg === 'high' ? multiHigh : seg === 'mid' ? multiMid : 0
        if (v >= 15) {
          l.cover = Math.round(v)
          if (l.code === '--') {
            l.code = seg === 'high' ? 'Ci' : 'Ac'
            l.genus = seg === 'high' ? '卷云（多模式均）' : '高积云（多模式均）'
            /* 这一步补出来的云来自多模式平均，ECMWF 单模式没报，所以没有云种判据。
               薄高云默认「能被夕阳照亮」——否则 74% 的高云会显示成「照不亮」，
               和下面「会烧成火烧」自相矛盾。 */
            l.lit = true
          }
        }
      }
    }

    const hueByLevel = new Map<number, string>()
    for (const l of layers) {
      if (l.cover < 4) { hueByLevel.set(l.level, '无'); continue }
      const reachable = litSet.has(l.level) || (l.cover >= 15 && l.rh < 88)
      if (!reachable) { hueByLevel.set(l.level, '无'); continue }
      hueByLevel.set(l.level, vividLabel(vividnessOf({ ...m, high: l.cover, mid: 0, low: 0 }, sunExact)))
    }
    void levelsRaw

    rows.push({
      spot: spot,
      m: m,
      score: score,
      rawScore: scoreOf(m),
      quality: qualityOf(m),
      peakScore: peakScore,
      peakTime: peakTime,
      vivid: vividnessOf(m, sunExact),
      vividLabel: vividLabel(vividnessOf(m, sunExact)),
      vividPeak: vividBest.v,
      vividPeakTime: vividBest.t,
      vividPeakLabel: vividBest.label,
      perModel: perModel,
      level: levelOf(score),
      aodName: aodBand(m.aod).name,
      profLabel: prof ? prof.label : '',
      hues: layers.map((l) => hueByLevel.get(l.level) ?? '无'),
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
