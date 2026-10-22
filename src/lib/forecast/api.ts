import { KINDS, aodBand, levelOf } from '@/data/forecast/levels'
import { MULTI_MODELS } from '@/data/forecast/models'
import { DETAIL_SPOT, SPOTS } from '@/data/forecast/spots'
import {
  clarityOf, clamp, lclMeters, profileOf, rainbowHint, rainbowOf, raysOf, scoreOf
} from './scoring'
import { state } from './state'
import { faceMatch, sunPosition } from './sun'
import type {
  CacheData, Detail, Measure, RawData, RawPoint, RawSeries, Row, Spot, SunPos
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

/* ---------- 取数 ---------- */
export function buildUrl(host: string, params: string, models: string[] | null): string {
  const lats = SPOTS.map((s) => s.lat).join(',')
  const lons = SPOTS.map((s) => s.lon).join(',')
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

  let aod = 0.2
  if (airObj && airObj.hourly && airObj.hourly.aerosol_optical_depth) {
    const v2 = airObj.hourly.aerosol_optical_depth[k]
    if (typeof v2 === 'number') aod = v2
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
    aod: aod
  }
}

/* ---------- 一次取数的缓存 ---------- */
let CACHE: CacheData | null = null
const CACHE_MS = 10 * 60 * 1000

/** 切换模式时丢弃缓存（旧版直接 CACHE = null） */
export function clearCache(): void {
  CACHE = null
}

/* 一次取数，缓存起来：切换今天/明天/日出/日落不再重新请求 */
export function load(force = false): void {
  if (!force && CACHE && Date.now() - CACHE.at < CACHE_MS) {
    compute(CACHE.weather, CACHE.air, CACHE.profs)
    return
  }

  if (!force && state.model === 'multi') {
    loadStatic()
    return
  }
  loadLive()
}

/* 优先读预生成的静态缓存（一天更新 6 次），读不到再现场请求 */
function loadStatic(): void {
  state.loading = true
  state.error = null

  fetch('data/forecast.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then((j: StaticFile) => {
      if (!j || !j.weather || !j.weather.length) throw new Error('缓存为空')
      const at = j.generatedAt ? Date.parse(j.generatedAt) : NaN
      if (!isNaN(at) && Date.now() - at > 14 * 3600 * 1000) throw new Error('缓存过期')

      CACHE = {
        weather: j.weather,
        air: j.air ?? null,
        profs: j.prof ?? null,
        at: isNaN(at) ? Date.now() : at,
        fromStatic: true
      }
      state.fromStatic = true
      compute(CACHE.weather, CACHE.air, CACHE.profs)
    })
    .catch(() => {
      state.fromStatic = false
      loadLive()
    })
}

function loadLive(): void {
  state.fromStatic = false
  state.loading = true
  state.error = null

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

  /* 高空剖面只用 ECMWF：变量多，全模式取会太大 */
  const pUrl = buildUrl(
    'https://api.open-meteo.com/v1/forecast',
    'hourly=relative_humidity_850hPa,relative_humidity_700hPa,' +
    'relative_humidity_500hPa,relative_humidity_400hPa,' +
    'temperature_850hPa,dew_point_850hPa,temperature_700hPa,dew_point_700hPa,' +
    'geopotential_height_850hPa,geopotential_height_700hPa,' +
    'temperature_2m,dew_point_2m,visibility,' +
    'boundary_layer_height,cape',
    ['ecmwf_ifs025']
  )

  Promise.all([
    fetchJson(fUrl),
    fetchJson(aUrl).catch(() => null),
    fetchJson(pUrl).catch(() => null)
  ]).then((res) => {
    let weather = res[0] as RawData | RawPoint
    const airRaw = res[1] as RawData | RawPoint | null
    const profRaw = res[2] as RawData | RawPoint | null

    /* 单点时返回对象，多点时返回数组 */
    if (!Array.isArray(weather)) weather = [weather]

    const air = airRaw ? (Array.isArray(airRaw) ? airRaw : [airRaw]) : null
    const profs = profRaw ? (Array.isArray(profRaw) ? profRaw : [profRaw]) : null

    CACHE = { weather: weather, air: air, profs: profs, at: Date.now(), fromStatic: false }
    compute(weather, air, profs)
  }).catch((e: unknown) => {
    state.loading = false
    state.error = '取不到数据：' + (e instanceof Error && e.message ? e.message : '网络错误')
  })
}

/* 静态缓存文件的字段（旧版 tools/build-cache.mjs 生成） */
interface StaticFile {
  generatedAt?: string
  weather?: RawData
  air?: RawData | null
  prof?: RawData | null
}

/* 剖面里的单点值：多模式时键名带后缀，优先取不带后缀的 */
function profField(pr: RawPoint, name: string, idx: number): number | null {
  const ph = pr.hourly
  if (!ph) return null
  const a = ph[name] || ph[name + '_ecmwf_ifs025']
  if (!a) return null
  const v = a[idx]
  return typeof v === 'number' ? v : null
}

/* 海口详细：日落前后逐小时 */
function buildDetail(
  w: RawPoint,
  air: RawPoint | null | undefined,
  idx: number,
  iso: string,
  spot: Spot,
  mids: string[]
): Detail {
  const times = hourTimes(w)
  const hours: Detail['hours'] = []
  const start = Math.max(0, idx - 2)
  const end = Math.min(times.length - 1, idx + 2)

  for (let k = start; k <= end; k++) {
    const m = measureAt(w, air, k, mids)
    hours.push({
      t: times[k].slice(11, 16),
      high: m.high,
      mid: m.mid,
      low: m.low,
      aod: m.aod,
      pop: m.pop,
      score: scoreOf(m)
    })
  }

  const t = iso.slice(11, 16)
  return {
    spot: spot,
    time: t,
    golden: addMin(t, -30) + ' – ' + t,
    blue: addMin(t, 14) + ' – ' + addMin(t, 34),
    hours: hours
  }
}

function compute(weather: RawData, air: RawData | null, profs: RawData | null): void {
  state.detail = null
  const cfg = KINDS[state.kind]
  const rows: Row[] = []
  const mids = modelsForRequest()

  SPOTS.forEach((spot, i) => {
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
    let sun: SunPos | null = null
    let face = 1
    const ms = Date.parse(iso + ':00+08:00')
    if (!isNaN(ms)) sun = sunPosition(ms, spot.lat, spot.lon)
    if (sun) {
      face = faceMatch(spot, sun.az)
      score = Math.round(score * face)
    }

    /* 高空湿度剖面 */
    const prof = profileOf(pr, idx)
    if (prof) {
      score = clamp(Math.round(score * prof.mod), 0, 100)
    }

    /* 时效折扣 */
    if (state.day === 1) {
      score = Math.round(score * 0.95)
    }
    score = clamp(score, 0, 96)

    /* ---- 其它三种“值得跑”的条件 ---- */
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

    const rainNear = rainbowHint(spot, times, idx, prof, (k) => measureAt(w, null, k, mids).pop)
    const clarity = clarityOf(m)
    const rays = raysOf(m, sun)
    const rainbow = rainbowOf(m, sun, cape, rainNear)

    /* 云底：地面 LCL 当中低云底；850hPa 层推中层云底 */
    const cbLow = lclMeters(m.t2m, m.td2m)
    let cbMid: number | null = null
    if (z850 != null && t850 != null && td850 != null) {
      const lcl850 = lclMeters(t850, td850)
      cbMid = lcl850 != null ? Math.round(z850 - lcl850) : null
    }

    if (spot.n === DETAIL_SPOT) {
      state.detail = buildDetail(w, air && air[i], idx, iso, spot, mids)
    }

    rows.push({
      spot: spot,
      m: m,
      score: score,
      level: levelOf(score),
      aodName: aodBand(m.aod).name,
      profLabel: prof ? prof.label : '',
      rainbow: rainbow >= 35,
      rainbowScore: rainbow,
      clarity: clarity,
      rays: rays,
      spread: spread,
      models: perModel.length,
      cloudBaseLow: cbLow,
      cloudBaseMid: cbMid,
      sunAz: sun ? Math.round(sun.az) : null,
      faceOff: face < 0.85,
      date: iso.slice(0, 10),
      ms: ms
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
}
