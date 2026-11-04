<script setup lang="ts">
/**
 * 大气水平—垂直剖面页。
 *
 * 定位：**解释层**，不是新的评分系统。
 *   · 不读 forecast 的缓存、不改 scoreOf()、不参与排名；
 *   · 主数据源是 CI 生成好的 GFS 剖面（data/cross/*.json）；
 *   · 对照数据源是 Open-Meteo 多点实时请求（只有确诊云量，没有云水云冰，图上会明说）。
 *
 * 从预报页进来时带 ?spot=&t=&az=，这样「看哪个机位、哪个时刻、哪个方向」能接上。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CrossSectionChart from '@/components/xsec/CrossSectionChart.vue'
import { ageHours, loadNationalContext, loadNationalIndex, loadXsecContext, loadXsecIndex, loadXsecSpot } from '@/lib/xsec/api'
import { Y_RANGES, beijingDateTime, beijingTime, cloudBands, expandPoints, sectionAt } from '@/lib/xsec/model'
import { CHART_GUIDE, QUICK_STEPS, TOOLBAR_GUIDE } from '@/lib/xsec/guide'
import { fetchOpenMeteoSection } from '@/lib/xsec/openmeteo'
import { sunInPlane, sunsetMs } from '@/lib/xsec/sun'
import {
  airmass, bandLightWindow, boundaryHeightKm, describeMin, terminatorKm,
  terminatorSpeedKmMin, terrainHorizonDeg, transmittance
} from '@/lib/xsec/light'
import type { BandLight } from '@/lib/xsec/light'
import type { XsecContext, XsecIndex, XsecNationalIndex, XsecSpotFile } from '@/lib/xsec/types'
const index = ref<XsecIndex | null>(null)
/** 全国 224 机位索引（3 时次 × 1 方位）；缺测时页面仍可用海南试点 */
const national = ref<XsecNationalIndex | null>(null)
/** 全国机位的 DEM/AOD 上下文（与试点分开两个文件，互不影响） */
const nationalCtx = ref<XsecContext | null>(null)
/** 当前选的是全国机位而不是海南试点 */
const nationalSpotId = ref('')
/** GFS 缓存（主数据源，4 个时次 × 5 个方位） */
const gfsFile = ref<XsecSpotFile | null>(null)
/** Open-Meteo 实时结果（对照数据源，单个时次） */
const omFile = ref<XsecSpotFile | null>(null)
const loading = ref(true)
const error = ref('')
const omLoading = ref(false)
const omError = ref('')
const source = ref<'gfs' | 'om'>('gfs')
const spotId = ref('')
const tIdx = ref(0)
const az = ref(265)
const yMaxKm = ref(16)
const layers = ref({ rh: false, temp: false, wind: false, w: false })
/** 渲染模式：综合 / 云水 / 云冰 / 总云量 —— 四种变量绝不混画 */
const mode = ref<'photo' | 'water' | 'ice' | 'total'>('photo')
/** 纵轴：海拔 MSL / 离地 AGL */
const heightAxis = ref<'msl' | 'agl'>('msl')
/** RH 诊断「潜在云区」阈值（%）；null = 不画。默认关，避免和真实云场混淆 */
const rhSat = ref<number | null>(null)
const RH_THRESHOLDS = [80, 85, 90, 95]
/** 降水圆点：默认开（任务书 P4 要求主图能看出哪里在下雨） */
const showRain = ref(true)
const full = ref(false)
const card = ref<HTMLElement | null>(null)
/** 从预报页点进来时带的机位（可能不在 8 个代表机位里） */
const fromName = ref('')
const fromNote = ref('')
/** 环境上下文：真实 DEM 地形 + AOD（独立缓存，失败不影响云场） */
const xctx = ref<XsecContext | null>(null)
/** 环境上下文（DEM/AOD）加载失败时的提示 */
const ctxWarn = ref('')

/* ---- 「怎么看」说明 ----
 * 为什么用按钮而不是纯 title：title 只有桌面端悬浮才出现，手机完全没有；
 * 摄影爱好者第一眼看到这一排按钮不知道点哪个，需要能主动展开、能一次看全。
 */
const showGuide = ref(false)

const AZ_CHOICES = [240, 255, 265, 280, 295]
const LAYER_ITEMS = [
  { key: 'rh' as const, name: '湿度等值线', hint: '50 / 70 / 85 / 95 %' },
  { key: 'temp' as const, name: '温度等值线', hint: '每 10 °C' },
  { key: 'wind' as const, name: '风矢量', hint: 'U/V 分量' },
  { key: 'w' as const, name: '垂直速度', hint: '▲上升 ▼下沉 · Pa/s' }
]

/* ---------------- 派生数据 ---------------- */

const spotMeta = computed(() => {
  const idx = index.value
  if (!idx) return null
  return idx.spots.find((s) => s.id === spotId.value) ?? idx.spots[0] ?? null
})

/** 全国索引里按机位 id 查文件；没有返回 null */
function nationalFile(id: string): string | null {
  if (!id) return null
  return national.value?.spots.find((s) => s.id === id)?.file ?? null
}

function pickNational(id: string): void {
  const f = nationalFile(id)
  if (!f) return
  nationalSpotId.value = id
  void pickSpotById(id, f)
}

const isOm = computed(() => source.value === 'om')
const activeFile = computed<XsecSpotFile | null>(() => (isOm.value ? omFile.value : gfsFile.value))

const section = computed(() => {
  const f = activeFile.value
  if (!f) return null
  return sectionAt(f, isOm.value ? 0 : tIdx.value, az.value)
})

/** 时次列表始终用 GFS 缓存的（Open-Meteo 只拉当前选中的那一个时刻） */
const times = computed(() => gfsFile.value?.times ?? [])

const validIso = computed(() => {
  const f = activeFile.value
  if (!f) return ''
  const t = isOm.value ? f.times[0] : f.times.find((x) => x.t === tIdx.value) ?? f.times[0]
  return t ? t.utc : ''
})

const validMs = computed(() => new Date(validIso.value).getTime())

/**
 * 太阳时间偏移（分钟，相对当地地面日落）。
 * 为什么单独一个滑杆：太阳位置可以逐分钟算，但气象场只有逐小时 ——
 * 拿"分钟级太阳位置 + 小时级云场"做动画是合理的，但必须标明云场没跟着变。
 */
const sunOffsetMin = ref(0)
/** URL 带的太阳时间偏移（等机位加载完再应用，避免被 syncSunOffset 覆盖） */
const pendingSunOffset = ref<number | null>(null)
/** 太阳时刻：日落 + 偏移；没有日落时刻时退回所选时次 */
const sunTimeMs = computed(() => {
  const setMs = sunsetAt.value
  if (!Number.isFinite(setMs)) return validMs.value
  return setMs + sunOffsetMin.value * 60000
})

const sun = computed(() => {
  const f = activeFile.value
  if (!f) return null
  return sunInPlane(sunTimeMs.value, f.spot.lat, f.spot.lon, az.value)
})

const sunsetAt = computed(() => {
  const f = activeFile.value
  if (!f || !validIso.value) return NaN
  return sunsetMs(f.spot.lat, f.spot.lon, validIso.value)
})

const sunDown = computed(() => Number.isFinite(sunsetAt.value) && sunTimeMs.value >= sunsetAt.value)

/**
 * 数据年龄。
 *
 * ★ 这里曾经用错源头：拿的是「海南试点索引 index.json」的 generatedAt，
 * 而页面上真正显示的是「全国索引 national-index.json + <省>/<id>.json」。
 * 两个索引各自更新，全国那份 2026-11-01 之后就没再刷新过，
 * 但试点索引每天在更新 → 全国模式下一页过期数据被判定成「新鲜」，
 * 过期警告永远不出现。用户看到的就是 4 天前的剖面 + Open-Meteo 报错。
 *
 * 现在按「当前真正在用的那份索引」算：
 *   来看全国机位 → 用 national.generatedAt
 *   看海南试点   → 用 index.generatedAt
 */
const dataAge = computed(() => {
  const idx = national.value ?? index.value
  return idx ? ageHours(idx.generatedAt) : NaN
})

/**
 * 过期判定。
 * 原来写成 `!isOm && ...`，等于「切到 Open-Meteo 模式就不提示过期」——
 * 但恰恰是 Open-Meteo 模式最需要这个提示：它只能查未来 3 天，
 * GFS 缓存一旦过期超过 3 天，请求必然失败。用户看到的却是一句
 * 「Open-Meteo 没有 xxxx 这一时刻的数据」，完全猜不到是本地缓存旧了。
 */
const stale = computed(() => Number.isFinite(dataAge.value) && dataAge.value > 12)

/** 与日落时刻最接近的那个时次高亮 */
const nearestSunsetIdx = computed(() => {
  const f = gfsFile.value
  if (!f || !Number.isFinite(sunsetAt.value)) return -1
  let best = -1
  let bd = Infinity
  f.times.forEach((t) => {
    const diff = Math.abs(new Date(t.utc).getTime() - sunsetAt.value)
    if (diff < bd) { bd = diff; best = t.t }
  })
  return best
})

/** 中心采样点上的云层分段（右侧列表用） */
const bandList = computed(() => {
  const f = activeFile.value
  const s = section.value
  if (!f || !s) return []
  const pts = expandPoints(f, s)
  const mid = pts[Math.floor(pts.length / 2)]
  return mid ? cloudBands(mid, 10) : []
})

/* ---------------- 光照几何（阶段七 P1：真实 DEM + AOD + 球面几何） ---------------- */

/** 当前机位的环境上下文（DEM 地形 + AOD） */
const spotCtx = computed(() =>
  xctx.value?.spots[spotId.value] ?? nationalCtx.value?.spots[spotId.value] ?? null
)
/** 当前剖面的 DEM 地形序列（缺测时图表退回模式地形并注明） */
const dem = computed(() => spotCtx.value?.profiles?.[String(az.value)] ?? null)
const demStepKm = computed(() => xctx.value?.sectionStepKm ?? 1.25)
/** 本机位实际使用的 DEM 来源（主源 Copernicus GLO-30，限额时回退 SRTM 90m） */
const demSourceLabel = computed(
  () => spotCtx.value?.demSource ?? xctx.value?.sources?.terrainUsed ?? 'DEM 来源未知'
)
/** 图例用短标签（去掉括号里的实现说明） */
const demSourceShort = computed(() => demSourceLabel.value.split('（')[0])
/** 当前时次的 AOD（GFS 模式与 Open-Meteo 对照都用同一份 CAMS 柱总量） */
const aodEntry = computed(() => spotCtx.value?.aod?.[isOm.value ? 0 : tIdx.value] ?? null)
const aod = computed(() => aodEntry.value?.v ?? null)
/** 沿「该时次日落方位」的 DEM 序列（光路被地形遮挡的判定用） */
const sunTerrain = computed(() => spotCtx.value?.sunProfiles?.[isOm.value ? 0 : tIdx.value] ?? null)
/** 该时次的地形序列是否复用了日落方位那份（全国机位只有一份，试点每时次各一份） */
const sunTerrainShared = computed(() => {
  const list = spotCtx.value?.sunProfiles ?? []
  if (list.length < 2) return false
  return list.every((p) => Math.abs(p.az - list[0].az) < 0.01)
})
const sunStepKm = computed(() => xctx.value?.sunStepKm ?? 2.5)

/** 剖面方向最高地形仰角（°，含曲率修正） */
const sectionHorizonDeg = computed(() =>
  dem.value ? terrainHorizonDeg(dem.value, demStepKm.value) : null
)
/** 太阳方向最高地形仰角（°） */
const sunHorizonDeg = computed(() =>
  sunTerrain.value ? terrainHorizonDeg(sunTerrain.value.elev, sunStepKm.value) : null
)
/** 太阳是否低于「太阳方向的地形视线」——低于就说明低空被山挡住 */
const sunBlockedByTerrain = computed(() => {
  const s = sun.value
  if (!s || sunHorizonDeg.value === null) return null
  return s.el < sunHorizonDeg.value
})

/** 直射光透过率 exp(−AOD·大气质量) */
const trans = computed(() => (sun.value ? transmittance(aod.value, sun.value.el) : null))
const airmassNow = computed(() => (sun.value ? airmass(sun.value.el) : null))
/** 地面日落线在剖面方向上的位置（km，正 = 前方） */
const terminator = computed(() =>
  sun.value ? terminatorKm(sun.value.el, sun.value.deviationDeg) : null
)
/** 照明边界沿剖面的移动速度（km/min） */
const termSpeed = computed(() => {
  const f = activeFile.value
  const s = sun.value
  if (!f || !s) return null
  return terminatorSpeedKmMin(validMs.value, f.spot.lat, f.spot.lon, s.deviationDeg)
})
/** 剖面 0 km 处的阴影上缘高度（km；0 = 无阴影） */
const boundaryAtOrigin = computed(() =>
  sun.value ? boundaryHeightKm(0, sun.value.el, sun.value.deviationDeg) : 0
)
/** 参考时刻相对当地地面日落的分钟数（负 = 日落前） */
const minutesFromSunset = computed(() => {
  const t = sunsetAt.value
  if (!Number.isFinite(t) || !Number.isFinite(validMs.value)) return null
  return (validMs.value - t) / 60000
})

/** 受光判断专用的云带：判据 ≥1 mg/kg（与图上着色起点一致；结构卡仍用 ≥10） */
const lightBands = computed(() => {
  const f = activeFile.value
  const sec = section.value
  if (!f || !sec) return []
  const pts = expandPoints(f, sec)
  const mid = pts[Math.floor(pts.length / 2)]
  return mid ? cloudBands(mid, 1) : []
})

/** 每段云（取路径中点）的几何受光窗口：云底高度 + 云中心距太阳方位投影距离 */
const bandLightList = computed<
  Array<{ band: (typeof bandList.value)[number]; light: BandLight }>
>(() => {
  const f = activeFile.value
  const s = section.value
  const sunV = sun.value
  if (!f || !s || !sunV) return []
  const mid = s.samples[Math.floor(s.samples.length / 2)]
  const midD = mid?.d ?? 25
  const dSun = midD * Math.cos((sunV.deviationDeg * Math.PI) / 180)
  return lightBands.value.map((b) => ({
    band: b,
    light: bandLightWindow({
      hM: b.fromKm * 1000,
      dSunKm: dSun,
      lat: f.spot.lat,
      lon: f.spot.lon,
      sunsetMs: sunsetAt.value,
      refMs: sunTimeMs.value,
      elevProfile: sunTerrain.value?.elev,
      stepKm: sunStepKm.value
    })
  }))
})

function fmtClock(ms: number): string {
  return Number.isFinite(ms) ? beijingTime(new Date(ms).toISOString()) : '—'
}

/** 一条云带的受光结论（中文短句，前台可读） */
function bandLightText(b: BandLight): string {
  if (b.lit === null) return '受光：无法判定'
  if (b.terrainBlocked === true) return '受光：被地形遮挡'
  const parts: string[] = []
  if (b.endMin !== null) {
    parts.push(`受光至 ${describeMin(b.endMin)}${Number.isFinite(sunsetAt.value) ? `（北京时间 ${fmtClock(sunsetAt.value + b.endMin * 60000)}）` : ''}`)
  } else {
    parts.push('扫描窗口内没有失去直射光')
  }
  if (b.durationMin !== null) parts.push(`时长 ${b.durationMin.toFixed(1)} 分`)
  if (!b.lit) parts.push('此刻已在阴影中')
  return parts.join(' · ')
}

/** 太阳偏离剖面方向太多时，图上要明确说「不在剖面平面内」 */
const sunWarning = computed(() => {
  const s = sun.value
  if (!s) return ''
  if (Math.abs(s.deviationDeg) > 25) {
    return `太阳方位与剖面方位相差 ${Math.abs(s.deviationDeg).toFixed(0)}°，图中光线只是投影，不代表真实三维光路。`
  }
  return ''
})

/* ---------------- 从预报页跳转过来 ---------------- */

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371.0
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((bLon - aLon) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** 预报页的机位不在 8 个代表机位里时，用最近的那个代替，并如实说明 */
function resolveIncoming(q: URLSearchParams): { id: string; note: string } {
  const idx = index.value
  if (!idx) return { id: '', note: '' }
  const name = q.get('name') ?? ''
  fromName.value = name
  const exact = idx.spots.find((s) => name && (s.name === name || s.name.includes(name) || name.includes(s.name)))
  if (exact) {
    return { id: exact.id, note: name && exact.name !== name ? `已定位到代表机位「${exact.name}」` : '' }
  }
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
    let best = idx.spots[0]
    let bd = Infinity
    for (const s of idx.spots) {
      const d = distanceKm(lat, lon, s.lat, s.lon)
      if (d < bd) { bd = d; best = s }
    }
    if (best) {
      return {
        id: best.id,
        note: `「${name}」不在 8 个代表机位里，这里显示距它最近的「${best.name}」（约 ${Math.round(bd)} km）`
      }
    }
  }
  return { id: '', note: name ? `「${name}」不在 8 个代表机位里，下面显示的是默认机位` : '' }
}

/* ---------------- 加载 ---------------- */

function readUrl(): { spot: string; t: number; az: number; sun: number | null } {
  const q = new URLSearchParams(location.search)
  const spot = q.get('spot') ?? ''
  const t = Number(q.get('t'))
  const a = Number(q.get('az'))
  const sun = Number(q.get('sun'))
  return {
    spot,
    t: Number.isFinite(t) ? t : 0,
    az: Number.isFinite(a) && a >= 0 ? a : 265,
    sun: q.has('sun') && Number.isFinite(sun) ? Math.round(sun) : null
  }
}

function writeUrl(): void {
  const q = new URLSearchParams()
  q.set('spot', spotId.value)
  q.set('t', String(tIdx.value))
  q.set('az', String(az.value))
  const m = minutesFromSunset.value
  const def = m !== null && Number.isFinite(m) ? Math.round(m) : 0
  if (sunOffsetMin.value !== def) q.set('sun', String(sunOffsetMin.value))
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`)
}

function syncSunOffset(): void {
  const m = minutesFromSunset.value
  sunOffsetMin.value = m !== null && Number.isFinite(m) ? Math.round(m) : 0
}

async function pickSpotById(id: string, file: string): Promise<void> {
  spotId.value = id
  loading.value = true
  error.value = ''
  try {
    const f = await loadXsecSpot(file)
    gfsFile.value = f
    if (!f.azimuths.includes(az.value)) az.value = f.spot.defaultAzimuth
    if (!f.times.some((t) => t.t === tIdx.value)) {
      tIdx.value = nearestSunsetIdx.value >= 0 ? nearestSunsetIdx.value : 0
    }
    /* 和 pickSpot 保持一致：Open-Meteo 模式下换了机位要重新拉一次，
       否则图上还是上一个机位的空气。 */
    if (isOm.value) await loadOm()
    syncSunOffset()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    gfsFile.value = null
  } finally {
    loading.value = false
  }
}

async function pickSpot(id: string): Promise<void> {
  const idx = index.value
  if (!idx) return
  const meta = idx.spots.find((s) => s.id === id) ?? idx.spots[0]
  if (!meta) return
  spotId.value = meta.id
  loading.value = true
  error.value = ''
  try {
    const f = await loadXsecSpot(meta.file)
    gfsFile.value = f
    if (!f.azimuths.includes(az.value)) az.value = f.spot.defaultAzimuth
    if (!f.times.some((t) => t.t === tIdx.value)) {
      tIdx.value = nearestSunsetIdx.value >= 0 ? nearestSunsetIdx.value : 0
    }
    if (isOm.value) await loadOm()
    syncSunOffset()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    gfsFile.value = null
  } finally {
    loading.value = false
  }
}

/**
 * Open-Meteo 对照：目标时刻该取哪一个。
 *
 * ★ 原来直接拿 GFS 缓存里的 t.utc。问题在于 GFS 缓存可能已经过期好几天，
 * 而 Open-Meteo 的 forecast 接口**只覆盖未来 3 天**（forecast_days=3），
 * 拿 4 天前的时刻去请求 100% 失败，报错还只说「没有这一时刻的数据」，
 * 用户完全无从判断是本地数据旧了还是接口挂了。
 *
 * 现在：优先用缓存里的时刻（能和 GFS 同刻对比才有意义）；
 * 如果那一刻已经超出 Open-Meteo 的可查范围，就改用「今天的同一钟点」，
 * 并通过 omShifted 告诉界面发生了什么（不静默改）。
 */
const omTargetIso = computed(() => {
  const g = gfsFile.value
  if (!g) return ''
  const t = g.times.find((x) => x.t === tIdx.value) ?? g.times[0]
  if (!t) return ''
  const want = new Date(t.utc).getTime()
  if (!Number.isFinite(want)) return ''

  /* Open-Meteo 的 forecast_days=3 从现在算起，往前一整天都不保证有；
     留 6 小时余量，比它更早的时刻一律换算到今天同一钟点。 */
  const cutoff = Date.now() - 6 * 3600000
  if (want >= cutoff) return t.utc

  const d = new Date(want)
  const now = new Date()
  const shifted = new Date(now)
  shifted.setUTCHours(d.getUTCHours(), 0, 0, 0)
  return shifted.toISOString()
})

/** Open-Meteo 用了「不是缓存里那一刻」的时刻 → 界面要说明 */
const omShifted = computed(() => {
  const g = gfsFile.value
  if (!g) return null
  const t = g.times.find((x) => x.t === tIdx.value) ?? g.times[0]
  if (!t) return null
  const want = omTargetIso.value
  if (!want || want === t.utc) return null
  return { from: t.utc, to: want }
})

async function loadOm(): Promise<void> {
  const g = gfsFile.value
  if (!g) return
  const t = g.times.find((x) => x.t === tIdx.value) ?? g.times[0]
  if (!t) return
  const target = omTargetIso.value || t.utc
  omLoading.value = true
  omError.value = ''
  try {
    const distances = g.sections[0]?.samples.map((s) => s.d) ?? [0, 12.5, 25, 37.5, 50]
    omFile.value = await fetchOpenMeteoSection(g.spot, {
      levelsHpa: g.levelsHpa,
      sampleKm: distances,
      az: az.value,
      validIso: target
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    /* 把「为什么失败」说清楚：多半是本地 GFS 缓存太旧，不是 Open-Meteo 挂了 */
    omError.value = stale.value
      ? msg + '（本地剖面缓存已 ' + Math.round(dataAge.value) + ' 小时未更新，Open-Meteo 只能查未来 3 天，所以这条路走不通）'
      : msg
    omFile.value = null
  } finally {
    omLoading.value = false
  }
}

async function init(): Promise<void> {
  /* 全国索引要先等一等：URL 里的 ?spot= 可能是全国机位 id（如 hn-003），
     而海南试点索引里只有 8 个 id（hk-xihai 这种）。
     以前是「发出去不管」，pickSpot 只查试点索引 → 全国 id 查不到 →
     静默退回默认机位，用户在预报页点进某个机位，打开却是另一个地方。 */
  const nationalReady = loadNationalIndex()
    .then((n) => { national.value = n; return n })
    .catch(() => null)
  loadNationalContext()
    .then((c) => { nationalCtx.value = c })
    .catch(() => { /* 全国 DEM/AOD 缺失：退回模式地形，页面已注明 */ })
  loadXsecContext()
    .then((c) => { xctx.value = c })
    .catch((e) => { ctxWarn.value = e instanceof Error ? e.message : String(e) })
  try {
    index.value = await loadXsecIndex()
    const u = readUrl()
    tIdx.value = u.t
    az.value = u.az
    pendingSunOffset.value = u.sun

    /* 先看这个 id 是不是全国机位 */
    const nat = await nationalReady
    if (u.spot && nat?.spots.some((s) => s.id === u.spot)) {
      nationalSpotId.value = u.spot
      const f = nationalFile(u.spot)
      if (f) await pickSpotById(u.spot, f)
      applyPendingSun()
      return
    }

    const q = new URLSearchParams(location.search)
    const incoming = resolveIncoming(q)
    if (incoming.note) fromNote.value = incoming.note
    await pickSpot(u.spot || incoming.id || (index.value.spots[0]?.id ?? ''))
    applyPendingSun()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

/** URL 带了「太阳时间偏移」的话，等机位加载完再应用，避免被 syncSunOffset 覆盖 */
function applyPendingSun(): void {
  if (pendingSunOffset.value !== null) {
    sunOffsetMin.value = pendingSunOffset.value
    pendingSunOffset.value = null
  }
}

onMounted(() => {
  void init()
  document.addEventListener('fullscreenchange', onFsChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
})

watch([spotId, tIdx, az], () => {
  if (spotId.value) writeUrl()
  if (isOm.value) void loadOm()
  /* 换时次时把太阳时间滑杆同步到该时次相对日落的分钟数 */
  const m = minutesFromSunset.value
  if (m !== null && Number.isFinite(m)) {
    sunOffsetMin.value = Math.round(m)
  }
})

watch(sunOffsetMin, () => {
  if (spotId.value) writeUrl()
})

watch(source, (v) => {
  if (v === 'om' && !omFile.value) void loadOm()
})

/* ---------------- 交互 ---------------- */

function selectSpot(id: string): void {
  if (id === spotId.value) return
  void pickSpot(id)
}

function selectTime(t: number): void {
  tIdx.value = t
}

function selectAz(a: number): void {
  az.value = a
}

function selectSource(s: 'gfs' | 'om'): void {
  source.value = s
}

function toggleLayer(key: 'rh' | 'temp' | 'wind' | 'w'): void {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
}

function onFsChange(): void {
  full.value = document.fullscreenElement === card.value
}

async function toggleFull(): Promise<void> {
  const el = card.value
  if (!el) return
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return
  }
  try {
    await el.requestFullscreen()
  } catch {
    full.value = !full.value
  }
}

/* ---------------- 文案工具 ---------------- */

const SUNSET_TEXT = computed(() => {
  const t = sunsetAt.value
  if (!Number.isFinite(t)) return '—'
  return beijingTime(new Date(t).toISOString())
})
</script>

<template>
  <section class="page-head xsec-head">
    <div class="wrap">
      <p class="eyebrow">Cross Section · 大气剖面</p>
      <h1 class="xsec-h1">云在哪一层，<b>光从哪里来</b></h1>
      <p class="xsec-lede">
        沿你镜头朝向切开大气：横轴是距离（试点机位 0–320 km，全国机位同样几何），纵轴是海拔，
        颜色是模式算出来的云水与云冰。这张图解释的是「云层结构」，
        不参与霞光评分的计算，也不比评分更准。
      </p>
    </div>
  </section>

  <section class="section xsec-section">
    <div class="wrap">
      <div v-if="loading" class="fc-empty">正在读取剖面数据…</div>
      <div v-else-if="error" class="fc-empty">
        {{ error }}<br /><br />剖面缓存由 GitHub Actions 定时生成，可能需要等下一次更新。
      </div>

      <template v-else-if="index && gfsFile">
        <p v-if="fromNote" class="xsec-from-note">{{ fromNote }}</p>

        <!-- 机位切换 -->
        <div class="xsec-spots" role="tablist" aria-label="代表机位">
          <button
            v-for="s in index.spots"
            :key="s.id"
            type="button"
            class="xsec-spot"
            :class="{ 'is-on': s.id === spotId }"
            role="tab"
            :aria-selected="s.id === spotId"
            @click="selectSpot(s.id)"
          >
            <span class="xsec-spot-name">{{ s.name }}</span>
            <span class="xsec-spot-tag">{{ s.tag }}</span>
          </button>
        </div>

        <!-- 全国 224 机位（3 时次 × 1 方位；口径与试点不同，单独一段） -->
        <div v-if="national" class="xsec-national">
          <div class="xsec-national-head">
            <span class="xsec-group-label">全国机位</span>
            <span class="xsec-hint">
              {{ national.spots.length }} 个 · 按当天日落方位生成 1 个剖面 ·
              {{ national.times.length }} 个时次 · 起报 {{ beijingDateTime(national.cycle) }}
            </span>
          </div>
          <div class="xsec-spots xsec-spots-national" role="tablist" aria-label="全国机位">
            <button
              v-for="s in national.spots"
              :key="s.id"
              type="button"
              class="xsec-spot xsec-spot-small"
              :class="{ 'is-on': s.id === nationalSpotId }"
              role="tab"
              :aria-selected="s.id === nationalSpotId"
              @click="pickNational(s.id)"
            >
              <span class="xsec-spot-name">{{ s.name }}</span>
              <span class="xsec-spot-tag">{{ s.prov }} · {{ s.azimuth.toFixed(0) }}°</span>
            </button>
          </div>
        </div>

        <!-- 怎么看：一排按钮的摄影师向解释（点开才展开，不打断默认浏览） -->
        <div class="xsec-guide">
          <button
            type="button"
            class="xsec-guide-toggle"
            :aria-expanded="showGuide"
            @click="showGuide = !showGuide"
          >
            <span class="xsec-guide-icon" aria-hidden="true">{{ showGuide ? '▾' : '▸' }}</span>
            怎么看这张图 · 每个按钮是干嘛的
            <span class="xsec-guide-meta">给摄影师的白话版 · 约 2 分钟读完</span>
          </button>

          <div v-if="showGuide" class="xsec-guide-body">
            <div class="xsec-guide-quick">
              <strong>三十秒上手</strong>
              <ol>
                <li v-for="(s, i) in QUICK_STEPS" :key="i">{{ s }}</li>
              </ol>
            </div>

            <div v-for="g in TOOLBAR_GUIDE" :key="g.title" class="xsec-guide-block">
              <h3 class="xsec-guide-title">{{ g.title }}</h3>
              <p class="xsec-guide-lead">{{ g.lead }}</p>
              <dl class="xsec-guide-dl">
                <template v-for="it in g.items" :key="it.name">
                  <dt>{{ it.name }}</dt>
                  <dd>
                    {{ it.what }}
                    <span class="xsec-guide-use">怎么用：{{ it.use }}</span>
                    <span v-if="it.caution" class="xsec-guide-caution">别误读：{{ it.caution }}</span>
                  </dd>
                </template>
              </dl>
            </div>

            <div class="xsec-guide-block">
              <h3 class="xsec-guide-title">图上那些东西是什么</h3>
              <p class="xsec-guide-lead">颜色和线条各自代表的量不同，认错颜色就会读错结论。</p>
              <dl class="xsec-guide-dl">
                <template v-for="it in CHART_GUIDE" :key="it.name">
                  <dt>{{ it.name }}</dt>
                  <dd>
                    {{ it.what }}
                    <span class="xsec-guide-use">怎么用：{{ it.use }}</span>
                    <span v-if="it.caution" class="xsec-guide-caution">别误读：{{ it.caution }}</span>
                  </dd>
                </template>
              </dl>
            </div>
          </div>
        </div>

        <!-- 工具条 -->
        <div class="xsec-toolbar">
          <div class="xsec-group">
            <span class="xsec-group-label">数据源</span>
            <div class="xsec-seg">
              <button
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': !isOm }"
                @click="selectSource('gfs')"
              >
                GFS 模式云水
              </button>
              <button
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': isOm }"
                @click="selectSource('om')"
              >
                Open-Meteo 估算
              </button>
            </div>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">时刻</span>
            <div class="xsec-seg">
              <button
                v-for="t in times"
                :key="t.t"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': t.t === tIdx, 'is-sunset': t.t === nearestSunsetIdx }"
                @click="selectTime(t.t)"
              >
                {{ beijingTime(t.utc) }}
              </button>
            </div>
            <span class="xsec-hint">日落约 {{ SUNSET_TEXT }}</span>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">太阳时间</span>
            <div class="xsec-sunslider">
              <input
                v-model.number="sunOffsetMin"
                type="range"
                min="-20"
                max="20"
                step="1"
                aria-label="太阳时间相对日落的分钟数"
              />
              <span class="xsec-hint">
                日落{{ sunOffsetMin >= 0 ? '后' : '前' }} {{ Math.abs(sunOffsetMin) }} 分
              </span>
            </div>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">方位</span>
            <div class="xsec-seg">
              <button
                v-for="a in AZ_CHOICES"
                :key="a"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': a === az }"
                @click="selectAz(a)"
              >
                {{ a }}°
              </button>
            </div>
            <span v-if="sun" class="xsec-hint">太阳方位 {{ sun.az.toFixed(0) }}°</span>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">视图</span>
            <div class="xsec-seg">
              <button
                v-for="m in [{ k: 'photo', n: '综合' }, { k: 'water', n: '云水' }, { k: 'ice', n: '云冰' }, { k: 'total', n: '总云量' }]"
                :key="m.k"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': mode === m.k }"
                @click="mode = m.k as 'photo' | 'water' | 'ice' | 'total'"
              >
                {{ m.n }}
              </button>
            </div>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">高度轴</span>
            <div class="xsec-seg">
              <button type="button" class="xsec-seg-btn" :class="{ 'is-on': heightAxis === 'msl' }" @click="heightAxis = 'msl'">海拔</button>
              <button type="button" class="xsec-seg-btn" :class="{ 'is-on': heightAxis === 'agl' }" @click="heightAxis = 'agl'">离地</button>
            </div>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">高度</span>
            <div class="xsec-seg">
              <button
                v-for="r in Y_RANGES"
                :key="r"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': r === yMaxKm }"
                @click="yMaxKm = r"
              >
                0–{{ r }} km
              </button>
            </div>
          </div>

          <div class="xsec-group xsec-group-layers">
            <span class="xsec-group-label">图层</span>
            <button
              v-for="l in LAYER_ITEMS"
              :key="l.key"
              type="button"
              class="xsec-chip"
              :class="{ 'is-on': layers[l.key] }"
              :title="l.hint + '｜详细解释见上方「怎么看这张图」'"
              @click="toggleLayer(l.key)"
            >
              {{ l.name }}
            </button>
            <!-- RH 诊断「潜在云区」：默认关，避免和真实云水混淆（任务书 P2） -->
            <span class="xsec-chip-split">
              <button
                type="button"
                class="xsec-chip"
                :class="{ 'is-on': rhSat !== null }"
                :title="'相对湿度 ≥ 阈值就标为潜在云区；这是湿度诊断，不是模式云水'"
                @click="rhSat = rhSat === null ? 90 : null"
              >
                潜在云区 RH≥{{ rhSat ?? 90 }}%
              </button>
              <select
                v-if="rhSat !== null"
                v-model.number="rhSat"
                class="xsec-mini-select"
                aria-label="潜在云区阈值"
              >
                <option v-for="t in RH_THRESHOLDS" :key="t" :value="t">{{ t }}%</option>
              </select>
            </span>
            <button
              type="button"
              class="xsec-chip"
              :class="{ 'is-on': showRain }"
              title="地面降水率（mm/h），不是降水概率；空心 ? = 缺测"
              @click="showRain = !showRain"
            >降水</button>
          </div>

          <button type="button" class="xsec-full" @click="toggleFull">
            {{ full ? '退出全屏' : '全屏' }}
          </button>
        </div>

        <div v-if="isOm && omLoading" class="fc-empty">正在向 Open-Meteo 请求 5 个点的气压层数据…</div>
        <div v-else-if="isOm && omError" class="fc-empty">
          Open-Meteo 请求失败：{{ omError }}<br /><br />可以切回 GFS 模式云水查看缓存数据。
        </div>

        <!-- ★ 注意：这里不能插一个独立的 v-if —— 它会把下面 <template v-else-if>
             的 v-if/v-else-if 链从中间断开，图表就永远不显示了（实际踩过）。
             提示条放到图表卡片内部去（见下方 v-if="isOm && omShifted"）。 -->
        <template v-else-if="activeFile && section && sun">
          <!-- 图表卡片 -->
          <div ref="card" class="card xsec-card" :class="{ 'is-full': full }">

            <!-- Open-Meteo 用了「不是缓存里那一刻」的时刻：必须说出来，不能静默改 -->
            <div v-if="isOm && omShifted" class="xsec-warn xsec-om-shift">
              ⚠ 本地剖面缓存里的时刻（{{ beijingDateTime(omShifted.from) }}）已经超出 Open-Meteo 的可查范围
              （它只有未来 3 天），这里改为按 <b>{{ beijingDateTime(omShifted.to) }}</b> 的同一钟点查询。
              因此这张图<b>不能</b>和 GFS 缓存逐时刻对照，只能看「今天的空气大致长什么样」。
            </div>
            <div class="xsec-card-head">
              <div>
                <strong>{{ activeFile.spot.name }}</strong>
                <span class="xsec-sep">·</span>
                <span>{{ activeFile.spot.area }} / 朝 {{ activeFile.spot.face }}</span>
                <span class="xsec-sep">·</span>
                <span>{{ beijingDateTime(validIso) }}（北京）</span>
              </div>
              <div class="xsec-card-meta">
                <span>方位 {{ az }}°</span>
                <span>太阳 {{ sun.el.toFixed(0) }}° / {{ sun.az.toFixed(0) }}°</span>
                <span v-if="!isOm">起报 {{ beijingDateTime(index.cycle) }}</span>
                <span v-else>Open-Meteo 实时请求</span>
              </div>
            </div>

            <div class="xsec-scroll">
              <CrossSectionChart
                :file="activeFile"
                :section="section"
                :y-max-km="yMaxKm"
                :layers="layers"
                :sun="sun"
                :sun-down="sunDown"
                :mode="mode"
                :height-axis="heightAxis"
                :dem="dem"
                :dem-step-km="demStepKm"
                :aod="aod"
                :rh-sat="rhSat"
                :show-rain="showRain"
              />
            </div>

            <div class="xsec-legend">
              <template v-if="mode === 'water'">
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-liquid" />云水 CLWMR（只画液态水）</span>
              </template>
              <template v-else-if="mode === 'ice'">
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-ice" />云冰 ICMR（只画冰晶）</span>
              </template>
              <template v-else-if="mode === 'total'">
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-est" />总云量 TCDC（模式云分数，不是水物质）</span>
              </template>
              <template v-else-if="!isOm">
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-liquid" />云水（液）</span>
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-ice" />云冰</span>
              </template>
              <span v-else class="xsec-lg">
                <i class="xsec-sw xsec-sw-est" />RH 诊断云量（非模式云水，不能区分液/冰）
              </span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-terrain" />模式地形</span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-grid" />真实格点</span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-sun" />太阳投影</span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-boundary" />夕阳照明边界（虚线以下在地球阴影里）</span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-lit" />暖色叠加 = 几何受光</span>
              <span v-if="rhSat !== null" class="xsec-lg"><i class="xsec-sw xsec-sw-rhsat" />RH≥{{ rhSat }}% 诊断潜在云区（不是模式云水）</span>
              <span v-if="showRain" class="xsec-lg"><i class="xsec-sw xsec-sw-rain" />降水率（地面 mm/h，不是概率；? = 缺测）</span>
              <span v-if="dem" class="xsec-lg"><i class="xsec-sw xsec-sw-terrain" />地形 = {{ demSourceShort }}</span>
              <span v-else class="xsec-lg"><i class="xsec-sw xsec-sw-terrain" />地形 = GFS 模式地形（DEM 缺测）</span>
              <span class="xsec-lg xsec-lg-note">
                {{ isOm ? 'Open-Meteo 气压层 · ECMWF IFS 0.25°' : `GFS 0.25°` }} ·
                水平网格约 {{ index.gridApproxKm }} km · 采样 {{ index.sampleIntervalKm }} km ·
                虚线处是模式原始格点，格点之间为双线性插值
              </span>
            </div>

            <p class="xsec-disclaimer">
              本图展示太阳几何关系与模式云场，<b>未进行完整辐射传输计算</b>。
              地形为 {{ demSourceLabel }} 真实高程，不再是 GFS 平滑模式地形；
              太阳光线只按球面几何传播，并按 AOD 做了 Beer-Lambert 直射削弱（虚线以下 = 地球阴影）。
              「太阳时间」滑杆只移动太阳/照明边界（分钟级几何），<b>不会</b>改变云场时次——
              云场仍是所选 GFS 逐小时时次，图上不会把分钟级变化伪装成分钟级预报。
              <template v-if="isOm">
                Open-Meteo 的云量由相对湿度诊断估算，<b>不是模式原生云水/云冰</b>，
                高湿无云时可能误判，不能用来证明真实云体微物理结构。
              </template>
              <template v-else>
                云水/云冰是 GFS 预报变量而非观测。
              </template>
              <span v-if="rhSat !== null">
                「潜在云区」是按 RH≥{{ rhSat }}% 诊断出来的湿度区域，<b>不是云水/云冰</b>；
                高湿无云、低湿有云都会发生，它只提示"这里湿度够高、可能成云"。
              </span>
              <template v-if="dem">地形为真实 DEM（{{ demSourceShort }}），地形以下的模式层已遮罩。</template>
              <template v-else>DEM 缺测，地形退回 GFS 模式地形（平滑值，非真实 DEM），地形以下的层已遮罩。</template>
            </p>
            <p v-if="sunWarning" class="xsec-warn">⚠ {{ sunWarning }}</p>
            <p v-if="stale" class="xsec-warn">
              ⚠ 这份剖面数据已经 {{ Math.round(dataAge) }} 小时没有更新，可能不是最新起报。
            </p>
          </div>

          <!-- 太阳与照明几何（阶段七 P1） -->
          <div class="card xsec-panel xsec-panel-sun">
            <h2 class="xsec-panel-title">太阳与照明几何</h2>
            <p class="xsec-panel-sub">
              真实太阳位置 + DEM 地形 + AOD 的球面几何结果，<b>只判「能否被直射光照到」与直射削弱</b>，
              不做辐射传输、不预测火烧云。
            </p>
            <dl class="xsec-dl">
              <dt>此刻太阳</dt>
              <dd>
                高度角 {{ sun.el.toFixed(1) }}° · 方位 {{ sun.az.toFixed(0) }}° ·
                与剖面相差 {{ sun.deviationDeg.toFixed(0) }}°（剖面内投影 {{ sun.inPlaneEl.toFixed(0) }}°）
              </dd>
              <dt>距日落</dt>
              <dd>
                日落 {{ SUNSET_TEXT }}（北京）·
                太阳时间 {{ sunOffsetMin >= 0 ? '日落后' : '日落前' }} {{ Math.abs(sunOffsetMin) }} 分
                <span class="xsec-dim">（太阳位置按分钟计算，云场仍取所选时次）</span>
              </dd>
              <dt>地形视线</dt>
              <dd>
                剖面方向 {{ sectionHorizonDeg === null ? '缺测' : sectionHorizonDeg.toFixed(1) + '°' }} ·
                太阳方向 {{ sunHorizonDeg === null ? '缺测' : sunHorizonDeg.toFixed(1) + '°' }}
                <template v-if="sun.el <= 0">→ 太阳已落到地平线下（此刻没有直射光）</template>
                <template v-else-if="sunBlockedByTerrain === true">
                  → <b>太阳低于地形视线，低空被山体遮挡</b>
                </template>
                <template v-else-if="sunBlockedByTerrain === false">→ 太阳在地形视线之上</template>
              </dd>
              <dt>气溶胶削弱</dt>
              <dd>
                <template v-if="aod !== null">
                  AOD {{ aod.toFixed(2) }}（CAMS 550 nm 柱总量，
                  {{ (aodEntry?.utc ?? '').slice(11, 16) }}Z）→ 直射透过率
                  <b>{{ trans === null ? '缺测' : trans < 0.01 ? '＜1' : Math.round(trans * 100) }}%</b>（大气质量 {{ (airmassNow ?? 0).toFixed(1) }}）
                </template>
                <template v-else>缺测（不推测，也不用默认值代替）</template>
              </dd>
              <dt>夕阳照明边界</dt>
              <dd>
                <template v-if="terminator === null">
                  太阳方位与剖面近乎垂直，边界位置在二维图里不可判
                </template>
                <template v-else>
                  地面日落线在剖面方向 <b>{{ terminator.toFixed(0) }} km</b>{{ terminator >= 0 ? '（前方）' : '（后方）' }}；
                  剖面内 0 km 处阴影上缘 {{ boundaryAtOrigin.toFixed(1) }} km
                  <template v-if="termSpeed !== null">
                    · 边界沿剖面移动约 {{ Math.abs(termSpeed).toFixed(1) }} km/min
                  </template>
                </template>
              </dd>
              <dt>受光的云带</dt>
              <dd>
                <ul v-if="bandLightList.length" class="xsec-known">
                  <li v-for="(it, i) in bandLightList" :key="i">
                    云底 {{ it.band.fromKm.toFixed(1) }} km（{{ it.band.toHpa }}–{{ it.band.fromHpa }} hPa）：
                    {{ bandLightText(it.light) }}
                  </li>
                </ul>
                <span v-else>这一时刻路径中段没有达到 1 mg/kg 的云层。</span>
                <p class="xsec-known xsec-known-p">
                  判据 ≥1 mg/kg（与图中着色起点一致）；上方「云层结构」卡用 ≥10 mg/kg，两处数字不同是阈值不同，不是数据矛盾。
                </p>
              </dd>
            </dl>
            <p class="xsec-known xsec-known-p">
              剖面只有 {{ activeFile.lengthKm }} km，而夕阳照明边界通常在数十到数百 km 外，
              图上只画进入视野的那一段；地形序列 0–{{ activeFile.lengthKm }} km 每 {{ demStepKm }} km 一个 DEM 点，
              光路遮挡用沿太阳方位的 0–150 km 地形序列近似<template v-if="sunTerrainShared">（全国机位只有日落方位那一份，其余时次复用）</template>。
            </p>
          </div>

          <!-- 云层清单 + 数据说明 -->
          <div class="xsec-panels">
            <div class="card xsec-panel">
              <h2 class="xsec-panel-title">这条路径上的云层结构</h2>
              <p class="xsec-panel-sub">
                取路径中点那一个格点，
                <template v-if="isOm">按「云量 ≥ 50%」判为有云（RH 诊断，估算）。</template>
                <template v-else>按「总凝结水 ≥ 10 mg/kg（0.01 g/kg）」判为有云；云底/云顶取中段采样点的最低/最高有云层，厚度 = 云顶 − 云底。</template>
                <span v-if="!bandList.length">这一时刻路径中段没有达到该阈值的云。</span>
              </p>
              <ul v-if="bandList.length" class="xsec-bands">
                <li v-for="(b, i) in bandList" :key="i">
                  <span
                    class="xsec-band-dot"
                    :class="b.estimated ? 'is-est' : (b.liquid ? 'is-liquid' : 'is-ice')"
                  />
                  {{ b.toHpa }}–{{ b.fromHpa }} hPa
                  <span class="xsec-band-h">（{{ b.toKm.toFixed(1) }}–{{ b.fromKm.toFixed(1) }} km）</span>
                  <span class="xsec-band-kind">
                    {{ b.estimated ? '湿度诊断云量' : (b.liquid ? '含液水' : '冰云为主') }}
                  </span>
                  <span v-if="!b.estimated" class="xsec-band-peak">
                    峰值 {{ Math.round(b.peakMgKg) }} mg/kg
                  </span>
                  <span
                    v-if="bandLightList[i]"
                    class="xsec-band-light"
                    :class="{
                      'is-lit': bandLightList[i].light.lit === true,
                      'is-dark': bandLightList[i].light.lit === false,
                      'is-blocked': bandLightList[i].light.terrainBlocked === true
                    }"
                  >{{ bandLightText(bandLightList[i].light) }}</span>
                </li>
              </ul>
            </div>

            <div class="card xsec-panel xsec-panel-data">
              <h2 class="xsec-panel-title">数据来源与已知误差</h2>
              <dl class="xsec-dl">
                <dt>数据源</dt>
                <dd>{{ activeFile.model }}</dd>
                <template v-if="!isOm">
                  <dt>起报 / 更新</dt>
                  <dd>{{ beijingDateTime(index.cycle) }} → {{ beijingDateTime(index.generatedAt) }}（北京）</dd>
                  <dt>有效时刻</dt>
                  <dd>
                    {{ times.map((t) => beijingTime(t.utc)).join(' / ') }}
                    （预报时效 {{ times[0]?.leadHours }}–{{ times[times.length - 1]?.leadHours }} h）
                  </dd>
                  <dt>云判据</dt>
                  <dd>{{ index.thresholds.variable }}，{{ index.thresholds.reference }}</dd>
                </template>
                <template v-else>
                  <dt>数据来源</dt>
                  <dd>Open-Meteo 气压层接口（模型 {{ activeFile.model }}），浏览器实时请求，未缓存</dd>
                  <dt>云量性质</dt>
                  <dd>由相对湿度诊断估算，无云水/云冰字段；不能与 GFS 云水直接比较数值</dd>
                </template>
                <dt>水平分辨率</dt><dd>{{ activeFile.gridKm }} km（0.25°，{{ activeFile.lengthKm }} km 内只有 {{ Math.max(1, Math.round(activeFile.lengthKm / activeFile.gridKm)) }} 个左右真实格点）</dd>
                <dt>垂直坐标</dt><dd>逐格点逐层位势高度（不是固定压高表换算）</dd>
                <dt>垂直速度</dt>
                <dd>
                  <template v-if="isOm">Open-Meteo 原生 m/s，已按 ω = −ρg·w 换算为 Pa/s（保留换算说明）</template>
                  <template v-else>GFS 原生 Pa/s，未换算成 m/s</template>
                </dd>
                <dt>地形</dt>
                <dd>
                  <template v-if="dem">
                    {{ demSourceLabel }}，沿剖面 0–{{ activeFile.lengthKm }} km 每
                    {{ demStepKm }} km 一个真实高程点；
                    <b>与 GFS 模式地形不同</b>（模式 orog 是 0.25° 平滑值，会削平小山与谷地）
                  </template>
                  <template v-else>DEM 缺测，退回 GFS 模式地形（平滑值，仅作轮廓参考）</template>
                </dd>
                <dt>气溶胶</dt>
                <dd>
                  <template v-if="aod !== null">
                    AOD {{ aod.toFixed(2) }}（CAMS global，550 nm 柱总量，{{ aodEntry?.utc }}）
                    → 仅用于 exp(−AOD·m) 的直射削弱估算，不区分波长、不含云与水汽
                  </template>
                  <template v-else>缺测：图上不画透过率，卡片写「缺测」</template>
                </dd>
                <dt>缺测</dt><dd>显示为缺测 / 遮罩，绝不按 0 处理</dd>
              </dl>
              <ul class="xsec-known">
                <li>模式预报有不确定性；插值不会提高原始分辨率。</li>
                <li>云是「模式认为云在哪」，不是卫星或雷达实测。</li>
                <li>太阳光线只是二维投影，不是三维光路，也不是辐射传输。</li>
              </ul>
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
