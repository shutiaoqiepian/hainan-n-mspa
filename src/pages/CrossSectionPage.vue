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
import { genusOfLevel, type CloudGenusInfo } from '@/lib/xsec/cloudgenus'
import { sunInPlane, sunriseMs, sunsetMs } from '@/lib/xsec/sun'
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

/* ---------- 窄屏图表的「看得全」问题 ----------
   图表最小宽度 680px，手机屏幕只有约 320–400px：
   不处理的话用户只看到左边 130 km（全程 320 km 的 40%），
   而且**没有任何线索告诉他右边还有**（实测截图确认过）。
   两个缓解手段：
     · narrowChart：窄屏时显示一条「左右滑动看全程」的提示
     · fitChart：一键把整张图缩到屏幕宽度看清全貌（字会变小，所以是可选） */
const narrowChart = ref(false)
const fitChart = ref(false)

function syncNarrow(): void {
  narrowChart.value = typeof window !== 'undefined' && window.innerWidth <= 900
}
const card = ref<HTMLElement | null>(null)
/** 从预报页点进来时带的机位（可能不在 8 个代表机位里） */
const fromName = ref('')
const fromNote = ref('')
/** 用户是从「朝霞」卡片点进来的吗？（URL 带 kind=sunrise）
 *  2026-11-04 起每个全国机位都有日出剖面，正常情况会直接显示朝霞剖面。
 *  只有当日出数据缺失（老索引 / 当轮生成失败）时，才退回日落并明确提示，
 *  绝不静默顶替 —— 用户报过「我选的是日出，图却是日落」，不能再犯。 */
const sunriseAsked = ref(false)
/** 想要日出但没拿到日出数据 → 退回了日落，需要提示 */
const sunriseFallback = ref(false)
/** 环境上下文：真实 DEM 地形 + AOD（独立缓存，失败不影响云场） */
const xctx = ref<XsecContext | null>(null)
/** 环境上下文（DEM/AOD）加载失败时的提示 */
const ctxWarn = ref('')

/* ---- 「怎么看」说明 ----
 * 为什么用按钮而不是纯 title：title 只有桌面端悬浮才出现，手机完全没有；
 * 摄影爱好者第一眼看到这一排按钮不知道点哪个，需要能主动展开、能一次看全。
 */
const showGuide = ref(false)

/**
 * 方位按钮。
 *
 * ★ 原来写死成 [240,255,265,280,295]（海南试点的 5 个方位）。
 * 但全国 224 机位是「按当天日落方位只生成 1 个剖面」——
 * 文件里只有 1 个方位，而 sectionAt() 找不到时会**回退到最接近的那个**。
 * 结果：点「240°」，按钮高亮 240°，图上画的却是 254.9° 的剖面。
 * 用户以为在看 240° 方向的空气，实际是 255° 的。
 *
 * 现在按「当前文件的 azimuths」渲染：全国只出现 1 个按钮，试点仍 5 个。
 */
const FALLBACK_AZ = [240, 255, 265, 280, 295]
const azChoices = computed<number[]>(() => {
  const f = gfsFile.value
  const list = f?.azimuths
  return list && list.length ? list : FALLBACK_AZ
})
/** 只有 1 个方位时不必显示按钮组，用一句话说明就够 */
const singleAz = computed(() => azChoices.value.length === 1)
const LAYER_ITEMS = [
  { key: 'rh' as const, name: '湿度等值线', hint: '50 / 70 / 85 / 95 %' },
  { key: 'temp' as const, name: '温度等值线', hint: '每 10 °C' },
  { key: 'wind' as const, name: '风矢量', hint: 'U/V 分量' },
  { key: 'w' as const, name: '垂直速度', hint: '▲上升 ▼下沉 · Pa/s' }
]

/* ---------------- 派生数据 ---------------- */

/** 全国索引里按机位 id 查文件；没有返回 null。
 *
 *  2026-11-04 起每个机位在索引里有**两条**（日落 / 日出），用 kind 区分。
 *  不传 kind 时优先日落（向后兼容老索引里只有一条的情况）。
 *  日出缺失（老数据、或当轮日出生成失败）时返回 null —— 调用方负责退回日落
 *  并明确告诉用户，绝不静默顶替。 */
function nationalFile(id: string, kind: 'sunrise' | 'sunset' = 'sunset'): string | null {
  if (!id) return null
  const all = national.value?.spots.filter((s) => s.id === id) ?? []
  if (!all.length) return null
  // 老索引没有 kind 字段 → 全部视为日落
  const want = all.find((s) => (s.kind ?? 'sunset') === kind)
  if (want) return want.file
  return kind === 'sunset' ? all[0].file : null
}

/** 这个全国机位有没有日出剖面 */
function hasSunrise(id: string): boolean {
  return nationalFile(id, 'sunrise') !== null
}

/** 有多少全国机位带日出剖面（用于说明「每机位几个剖面」）。
 *  不能只看第一个机位 —— 老索引里排序靠前的那个可能恰好没有日出数据。 */
const sunriseCoverage = computed(() => {
  const all = national.value?.spots ?? []
  const ids = new Set(all.map((s) => s.id))
  const withSun = new Set(all.filter((s) => (s.kind ?? 'sunset') === 'sunrise').map((s) => s.id))
  return { total: ids.size, withSun: withSun.size }
})

/** 全国机位列表（按 id 去重）。
 *  2026-11-04 起索引里每个机位有日落 + 日出两条，
 *  直接渲染 national.spots 会把每个机位显示两遍（224 → 448 个按钮）。 */
const nationalSpotsUnique = computed(() => {
  const seen = new Set<string>()
  const out: NonNullable<typeof national.value>['spots'] = []
  for (const s of national.value?.spots ?? []) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out
})

/** 在同一机位的「朝霞 / 晚霞」两份剖面之间切换。
 *  只对全国机位有效（它们才有两份文件）；海南试点 8 机位只有日落。 */
function switchKind(kind: 'sunrise' | 'sunset'): void {
  const id = nationalSpotId.value
  if (!id) return
  const f = nationalFile(id, kind)
  if (!f) return
  sunriseAsked.value = kind === 'sunrise'
  sunriseFallback.value = false
  /* 把时次重置成「最接近事件时刻」的那个。
     不重置的话，从晚霞 t=2（18:00）切到朝霞还停在 t=2（08:00），
     离日出 06:41 已经过去 1 个多小时，图上就看不到「日出那一刻」了。 */
  tIdx.value = -1
  void pickSpotById(id, f).then(() => {
    if (nearestEventIdx.value >= 0) tIdx.value = nearestEventIdx.value
    syncSunOffset()
  })
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
/** 太阳时刻：事件时刻（日出或日落，见 eventAt）+ 偏移；没有事件时刻时退回所选时次 */
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

/** 这份数据是日出剖面还是日落剖面？
 *  2026-11-04 起全国机位同时出两份（<id>.json / <id>-sunrise.json），
 *  老数据没有 kind 字段，一律按日落处理。
 *  整页的太阳几何都依赖「事件时刻」，所以必须按 kind 选对，否则
 *  拿日出剖面配日落时刻，算出来的太阳高度是负的、整张图像素全黑。 */
const fileKind = computed<'sunrise' | 'sunset'>(() => {
  const f = activeFile.value
  const k = (f as { kind?: string } | null)?.kind
  return k === 'sunrise' ? 'sunrise' : 'sunset'
})
const isSunriseFile = computed(() => fileKind.value === 'sunrise')

/** 事件时刻（日出或日落，取决于当前文件）。原名 sunsetAt，名字已不符，故改中性名。 */
const eventAt = computed(() => {
  const f = activeFile.value
  if (!f || !validIso.value) return NaN
  return isSunriseFile.value
    ? sunriseMs(f.spot.lat, f.spot.lon, validIso.value)
    : sunsetMs(f.spot.lat, f.spot.lon, validIso.value)
})
/** 向后兼容的别名（下面还有多处引用，语义一样） */
const sunsetAt = eventAt

/** 太阳是否已经落到地平线下（用于「此刻没有直射光」的提示）。
    日出剖面里太阳是**升上来**的方向：日出前才在地平线下，
    所以判据要反过来 —— 用「是否在地平线下」这个物理事实，而不是「是否过了某个时刻」。 */
const sunDown = computed(() => {
  const a = sun.value
  if (a) return a.el < 0
  return Number.isFinite(sunsetAt.value) && sunTimeMs.value >= sunsetAt.value
})

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

/** 与**事件时刻**（日出或日落）最接近的那个时次高亮 */
const nearestEventIdx = computed(() => {
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

/**
 * 每个「云层带」是什么云属。
 *
 * 用路径中点那一列的逐层数据判（和 bandList 同一个格点，保证两者对得上），
 * 取该带内**凝结水最浓的那一层**作代表：
 *   云属是「这团云」的属性，不是层平均的属性；平均会把浓云和薄纱拌成中间值，判错族。
 *
 * 判据走 src/lib/xsec/cloudgenus.ts（用 GFS 真三维云水/云冰的液冰比，
 * 比预报页那份只靠云量+湿度猜云属更硬）。
 */
const bandGenuses = computed<Array<CloudGenusInfo | null>>(() => {
  const f = activeFile.value
  const s = section.value
  if (!f || !s) return []
  const pts = expandPoints(f, s)
  const mid = pts[Math.floor(pts.length / 2)]
  if (!mid) return []
  return bandList.value.map((b) => {
    let best: CloudGenusInfo | null = null
    let bestQ = -Infinity
    for (const p of mid) {
      /* band 的 fromHpa 是低层、toHpa 是高层（levelsHpa 由低到高） */
      if (p.pressureHpa > b.fromHpa || p.pressureHpa < b.toHpa) continue
      if (p.belowGround) continue
      const q = (p.clwMgKg ?? 0) + (p.iciMgKg ?? 0)
      if (q <= bestQ) continue
      const info = genusOfLevel({
        hPa: p.pressureHpa,
        tC: p.tC, rhPct: p.rhPct,
        clwMgKg: p.clwMgKg, iciMgKg: p.iciMgKg,
        cfPct: p.cfPct, wPaS: p.wPaS, rainMmH: p.rainMmH ?? null
      })
      if (info) { bestQ = q; best = info }
    }
    return best
  })
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
/**
 * 模式格距（km）。
 * 数据文件里**没有** gridKm 这个字段（build_cross*.py 只写 sampleIntervalKm），
 * 所以只能按数据源自己给：GFS 0.25° 在中纬度约 27.8 km，Open-Meteo 同源。
 * 以前页面直接拼 activeFile.gridKm，实际显示「km」并在除法里得到 Infinity。
 */
const gridKmNow = computed<number>(() => activeFile.value?.gridKm ?? 27.8)

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
/**
 * 边界落在**后方**时补一句人话。
 *
 * 公式 terminatorKm = −el·R_km / cos(偏差)：太阳越高，值越负。
 * 日出后太阳已经高过地平线，从机位往东看，被照亮的低空云其实在**身后**（西侧）
 * 和头顶 —— 前方 320 km 整段都在直射光里，图上自然没有虚线。
 * 这时只写「（后方）」会让人以为图坏了，所以直接说明该看哪里。
 *
 * 太阳在地平线下（el<0）时值变正，是日出前的正常情况，不加这句。
 */
const terminatorLabel = computed(() => {
  const s = sun.value
  if (!s || terminator.value === null) return ''
  if (terminator.value >= 0 || s.el <= 0) return ''
  return '，即整段前方都在直射光里，图上不会有虚线'
})

/** 剖面 0 km 处的阴影上缘高度（km；0 = 无阴影） */
const boundaryAtOrigin = computed(() =>
  sun.value ? boundaryHeightKm(0, sun.value.el, sun.value.deviationDeg) : 0
)
/** 参考时刻（所选时次）相对事件时刻（日出/日落）的分钟数。
    负 = 事件前。
    ★ 日出剖面会给出 1000+ 分钟的巨大偏移（如 04:00 相对 06:41 是 -161 分），
      而滑杆只有 ±20 分；如果没有这个界限，滑杆显示的分钟数和实际太阳位置
      就会对不上（实测：日出图显示「日落后 1279 分」、太阳高度 -38°）。
      这里把超出 ±20 的值视为「时次不在事件附近」，返回 null 让滑杆归零。 */
const minutesFromEvent = computed(() => {
  const t = eventAt.value
  if (!Number.isFinite(t) || !Number.isFinite(validMs.value)) return null
  const m = (validMs.value - t) / 60000
  return Math.abs(m) <= 20 ? m : null
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
function resolveIncoming(q: URLSearchParams): { id: string; national: boolean; note: string } {
  const idx = index.value
  if (!idx) return { id: '', national: false, note: '' }
  const name = q.get('name') ?? ''
  fromName.value = name

  /* ★ 优先在全国 224 机位里按名字精确匹配。
     从霞光预报页的决策卡点「大气剖面」进来时带的就是机位名；
     那 224 个机位全都有剖面文件，能精确落到同一个点。
     以前只查海南试点 8 个 —— 全国机位一点过来就掉到默认机位去了。 */
  const natSpots = national.value?.spots ?? []
  const natExact = name ? natSpots.find((s) => s.name === name) : undefined
  if (natExact) return { id: natExact.id, national: true, note: '' }

  const exact = idx.spots.find((s) => name && (s.name === name || s.name.includes(name) || name.includes(s.name)))
  if (exact) {
    return { id: exact.id, national: false, note: name && exact.name !== name ? `已定位到代表机位「${exact.name}」` : '' }
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
        national: false,
        note: `「${name}」不在 8 个代表机位里，这里显示距它最近的「${best.name}」（约 ${Math.round(bd)} km）`
      }
    }
  }
  return { id: '', national: false, note: name ? `「${name}」不在 8 个代表机位里，下面显示的是默认机位` : '' }
}

/* ---------------- 加载 ---------------- */

function readUrl(): { spot: string; t: number; az: number; sun: number | null; kind: 'sunrise' | 'sunset' | '' } {
  const q = new URLSearchParams(location.search)
  const spot = q.get('spot') ?? ''
  const t = Number(q.get('t'))
  const a = Number(q.get('az'))
  const sun = Number(q.get('sun'))
  /* 从预报页「朝霞 / 晚霞」卡片点进来时会带 kind。
     2026-11-04 起全国机位同时有日出和日落两份剖面，kind 决定加载哪一份。
     详见 nationalFile() 的注释与 sunriseFallback 提示。 */
  const k = q.get('kind')
  const kind = k === 'sunrise' || k === 'sunset' ? k : ''
  return {
    spot,
    /* ★ 没带 t 时给 -1，而不是 0。
       0 会锁死在「第一个时次」（往往是下午偏早、离日落还远）。
       -1 不在 times 里，pickSpot* 会自动选「最接近日落」的那个时次 ——
       这才是从预报页点进来时用户真正想看的时刻。
       （Number(null) === 0，所以原来「没带参数」和「明确要第 0 个」分不开。） */
    t: q.has('t') && Number.isFinite(t) ? t : -1,
    az: Number.isFinite(a) && a >= 0 ? a : 265,
    sun: q.has('sun') && Number.isFinite(sun) ? Math.round(sun) : null,
    kind
  }
}

/**
 * 把当前状态写回地址栏。
 *
 * ★ 2026-11-04 精简过一轮。原则是：**URL 只放「内容标识」，不放「拖动状态」**。
 *
 *   保留：
 *     spot  哪个机位 —— 从预报页点进来、分享给别人，都靠它。真实需求。
 *     t     第几个时次 —— 「日落那一刻」是这个页面的核心视角，值得携带。
 *   不再写入：
 *     sun   相对日落的分钟偏移。这是**拖动太阳时间滑杆产生的交互状态**，
 *           原来 watch(sunOffsetMin) 每拖一下都 replaceState 一次，
 *           地址栏一直在抖。而且分享「日落后 13 分钟」对别人意义有限。
 *           （读取仍然保留：带 sun 的老链接照样能用。）
 *     az    方位。全国 224 机位按设计**只有 1 个方位**（当天日落方位，
 *           是数据算出来的，不是用户选的），写进 URL 纯属噪音。
 *           只有试点机位（5 个方位可选）才写。
 */
function writeUrl(): void {
  const q = new URLSearchParams()
  q.set('spot', spotId.value)
  q.set('t', String(tIdx.value))
  /* ★ 写上 kind，否则刷新 / 分享链接会丢掉「朝霞还是晚霞」，
     别人打开只看到晚霞，还以为自己点错了（用户报过这个）。
     只在真有日出剖面时才写，避免给没有日出数据的机位造出假参数。 */
  if (isSunriseFile.value) q.set('kind', 'sunrise')
  /* ★ 用「已加载文件的 azimuths」判断，不能用 azChoices：
     azChoices 在文件还没加载时回退成 5 个预设备选，会让全国机位也被写上 az。 */
  const azs = gfsFile.value?.azimuths ?? []
  if (azs.length > 1) q.set('az', String(az.value))
  const qs = q.toString()
  /* 状态没变就别动地址栏（避免无意义的 replaceState） */
  if (qs === location.search.replace(/^\?/, '')) return
  history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname)
}

function syncSunOffset(): void {
  const m = minutesFromEvent.value
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
      tIdx.value = nearestEventIdx.value >= 0 ? nearestEventIdx.value : 0
    }
    /* 和 pickSpot 保持一致：Open-Meteo 模式下换了机位要重新拉一次，
       否则图上还是上一个机位的空气。 */
    if (isOm.value) await loadOm()
    syncSunOffset()
    /* 数据到位后再写一次地址栏：上面那个 watch 在 spotId 一改就触发，
       那时 gfsFile 还是空的，写出来的 URL 会带不该有的参数。 */
    writeUrl()
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
      tIdx.value = nearestEventIdx.value >= 0 ? nearestEventIdx.value : 0
    }
    if (isOm.value) await loadOm()
    syncSunOffset()
    /* 数据到位后再写一次地址栏：上面那个 watch 在 spotId 一改就触发，
       那时 gfsFile 还是空的，写出来的 URL 会带不该有的参数。 */
    writeUrl()
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
    sunriseAsked.value = u.kind === 'sunrise'

    /* 先看这个 id 是不是全国机位 */
    const nat = await nationalReady
    if (u.spot && nat?.spots.some((s) => s.id === u.spot)) {
      nationalSpotId.value = u.spot
      // 从「朝霞」卡片点进来就加载日出剖面；没有日出数据时退回日落并说明。
      const wantKind: 'sunrise' | 'sunset' = sunriseAsked.value ? 'sunrise' : 'sunset'
      const srFile = nationalFile(u.spot, 'sunrise')
      const f = (wantKind === 'sunrise' ? srFile : null) ?? nationalFile(u.spot, 'sunset')
      // 想要日出但没有日出数据 → 退回日落，并明确告知（不静默顶替）
      sunriseFallback.value = wantKind === 'sunrise' && !srFile
      if (f) await pickSpotById(u.spot, f)
      applyPendingSun()
      return
    }

    const q = new URLSearchParams(location.search)
    const incoming = resolveIncoming(q)
    if (incoming.note) fromNote.value = incoming.note
    /* 从预报页带名字进来、且名字命中全国机位时，走全国分支 */
    if (!u.spot && incoming.national && incoming.id) {
      nationalSpotId.value = incoming.id
      const wantKind: 'sunrise' | 'sunset' = sunriseAsked.value ? 'sunrise' : 'sunset'
      const srFile = nationalFile(incoming.id, 'sunrise')
      const f = (wantKind === 'sunrise' ? srFile : null) ?? nationalFile(incoming.id, 'sunset')
      sunriseFallback.value = wantKind === 'sunrise' && !srFile
      if (f) await pickSpotById(incoming.id, f)
      applyPendingSun()
      return
    }
    /* 无参访问（导航栏点进来）→ 默认落到「全国机位」第一个，与决策卡进的那套一致
       （单方位、3 时次）。海南试点 8 机位不再作为默认入口，仅在全国索引缺失时兜底。 */
    const defaultNational = national.value?.spots[0]?.id ?? ''
    if (u.spot || incoming.id) {
      await pickSpot(u.spot || incoming.id)
    } else if (defaultNational) {
      nationalSpotId.value = defaultNational
      const f = nationalFile(defaultNational)
      if (f) await pickSpotById(defaultNational, f)
      else await pickSpot(index.value.spots[0]?.id ?? '')
    } else {
      await pickSpot(index.value.spots[0]?.id ?? '')
    }
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
  syncNarrow()
  window.addEventListener('resize', syncNarrow)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
  window.removeEventListener('resize', syncNarrow)
})

watch([spotId, tIdx, az], () => {
  if (spotId.value) writeUrl()
  if (isOm.value) void loadOm()
  /* 换时次时把太阳时间滑杆同步到该时次相对日落的分钟数 */
  const m = minutesFromEvent.value
  sunOffsetMin.value = m !== null && Number.isFinite(m) ? Math.round(m) : 0
})

/* 太阳时间滑杆**不**写 URL：它是拖动状态，不是内容标识。
   原来这里有一句 writeUrl()，导致每拖一像素就 replaceState 一次、地址栏抖动。
   带 sun 参数的老链接仍能正常打开（readUrl 还在读）。 */

watch(source, (v) => {
  if (v === 'om' && !omFile.value) void loadOm()
})

/* ---------------- 交互 ---------------- */

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

/** 事件时刻文案（日出或日落，跟随当前文件）。原名 SUNSET_TEXT，见 eventAt 说明。 */
const EVENT_TEXT = computed(() => {
  const t = eventAt.value
  if (!Number.isFinite(t)) return '—'
  return beijingTime(new Date(t).toISOString())
})
/** 「日出」/「日落」两个字，界面文案里到处要用 */
const EVENT_WORD = computed(() => (isSunriseFile.value ? '日出' : '日落'))

/**
 * 照明边界那条橙色虚线叫什么。
 *
 * 物理上它是同一个东西 —— 地球阴影的边缘（晨昏线）在剖面方向上的位置，
 * 太阳在它另一边就照不到云。但「夕阳照明边界」是黄昏的说法：
 * 日出时太阳从东边升起来，被照亮的是**东侧**的低空云，
 * 同一根线应该叫「朝阳光边界」，否则用户会以为看的是日落的图。
 * 图例、dl 词条、脚注三处必须同时跟着变，不能只改一处。
 */
const lightBoundaryWord = computed(() => (isSunriseFile.value ? '朝阳光照明边界' : '夕阳照明边界'))
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
        <!-- 想要朝霞、但这一份没有日出数据 → 退回日落，必须说清楚 -->
        <p v-if="sunriseFallback" class="xsec-from-note xsec-rise-fallback">
          <b>⚠ 这份数据里没有日出剖面</b>，下面显示的是<b>日落</b>剖面（西面）。
          日出剖面需要等下一次数据更新生成。
        </p>

        <!-- 海南试点 8 机位（代表机位）2026-11-08 起移除：
             主入口统一为全国 224 机位（单方位，与决策卡点进来那套一致），
             试点 5 方位数据仅在全国索引缺测时兜底，不再作为可点选的入口。 -->

        <!-- 机位选择（全国 224 机位 · 每机位按当天日落方位生成 1 个剖面） -->
        <div v-if="national" class="xsec-national">
          <div class="xsec-national-head">
            <span class="xsec-group-label">机位</span>
            <span class="xsec-hint">
              {{ nationalSpotsUnique.length }} 个 ·
              <template v-if="sunriseCoverage.withSun === sunriseCoverage.total">
                每机位两套剖面（晚霞 + 朝霞）
              </template>
              <template v-else-if="sunriseCoverage.withSun > 0">
                其中 {{ sunriseCoverage.withSun }} 个有朝霞剖面
              </template>
              <template v-else>只有晚霞剖面</template>
              · {{ national.times.length }} 个时次 · 起报 {{ beijingDateTime(national.cycle) }}
            </span>
          </div>
          <div class="xsec-spots xsec-spots-national" role="tablist" aria-label="全国机位">
            <button
              v-for="s in nationalSpotsUnique"
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
          <!-- 朝霞 / 晚霞：页面内直接切换，不必回预报页重进 -->
          <div v-if="hasSunrise(nationalSpotId) || isSunriseFile" class="xsec-group">
            <span class="xsec-group-label">剖面</span>
            <div class="xsec-seg">
              <button
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': !isSunriseFile }"
                @click="switchKind('sunset')"
              >晚霞（日落）</button>
              <button
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': isSunriseFile }"
                :disabled="!hasSunrise(nationalSpotId)"
                @click="switchKind('sunrise')"
              >朝霞（日出）</button>
            </div>
          </div>

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
                :class="{ 'is-on': t.t === tIdx, 'is-sunset': t.t === nearestEventIdx }"
                @click="selectTime(t.t)"
              >
                {{ beijingTime(t.utc) }}
              </button>
            </div>
            <span class="xsec-hint">{{ EVENT_WORD }}约 {{ EVENT_TEXT }}</span>
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
                aria-label="太阳时间相对日出/日落的分钟数"
              />
              <span class="xsec-hint">
                {{ EVENT_WORD }}{{ sunOffsetMin >= 0 ? '后' : '前' }} {{ Math.abs(sunOffsetMin) }} 分
              </span>
            </div>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">方位</span>
            <!-- 全国机位只有 1 个方位（当天事件方位）：不显示按钮，直接说明，
                 免得用户以为能切、点了却发现是高亮的假按钮。 -->
            <span v-if="singleAz" class="xsec-hint xsec-az-single">
              {{ azChoices[0] }}°（当天{{ EVENT_WORD }}方位，这份剖面只生成这个方位）
            </span>
            <div v-else class="xsec-seg">
              <button
                v-for="a in azChoices"
                :key="a"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': Math.abs(a - az) < 0.5 }"
                @click="selectAz(a)"
              >
                {{ Math.round(a) }}°
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
                <!-- 朝霞 / 晚霞：一眼看出这份剖面是哪个方向、哪个事件 -->
                <span
                  class="xsec-kind-tag"
                  :title="isSunriseFile ? '日出（朝霞）剖面：太阳从东边升起' : '日落（晚霞）剖面：太阳从西边落下'"
                >{{ isSunriseFile ? '朝霞' : '晚霞' }}</span>
                <span class="xsec-sep">·</span>
                <span>{{ activeFile.spot.area }} / 朝 {{ activeFile.spot.face }}</span>
                <span class="xsec-sep">·</span>
                <span>{{ beijingDateTime(validIso) }}（北京）</span>
              </div>
              <div class="xsec-card-meta">
                <span>方位 {{ az }}°</span>
                <span>太阳 {{ sun.el.toFixed(0) }}° / {{ sun.az.toFixed(0) }}°</span>
                <!-- ★ 这里原来写的是 index.cycle —— 那是「海南试点索引」的起报时刻，
                     而页面显示的可能是「全国机位」的文件，两者各自更新。
                     结果就是同一个界面上出现「起报 11月4日 02:00 / 时刻 11月1日 18:00」
                     这种物理上不可能的组合（11-04 的起报不会有 11-01 的预报时刻）。
                     起报必须取自「当前真正显示的这份文件」。 -->
                <span v-if="!isOm">起报 {{ beijingDateTime(activeFile.cycle) }}</span>
                <span v-else>Open-Meteo 实时请求</span>
              </div>
            </div>

            <!-- 窄屏图表是 680px 宽、横向滚动。必须告诉用户「可以滑」，
                 否则他只看到左边 130 km，以为整张图就是这样（实测踩过）。 -->
            <p v-if="narrowChart" class="xsec-swipe-hint">
              <span class="sx-ico" aria-hidden="true">↔</span>
              <span class="sx-tx">左右滑动看全程 · 共 {{ activeFile.lengthKm }} km</span>
              <button type="button" class="xsec-swipe-fit" @click="fitChart = !fitChart">
                {{ fitChart ? '恢复完整尺寸' : '先看全图' }}
              </button>
            </p>
            <div class="xsec-scroll" :class="{ 'is-fit': fitChart }">
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
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-boundary" />{{ lightBoundaryWord }}（虚线以下在地球阴影里）</span>
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
              <dt>距{{ EVENT_WORD }}</dt>
              <dd>
                {{ EVENT_WORD }} {{ EVENT_TEXT }}（北京）·
                太阳时间 {{ sunOffsetMin >= 0 ? EVENT_WORD + '后' : EVENT_WORD + '前' }} {{ Math.abs(sunOffsetMin) }} 分
                <span class="xsec-dim">（太阳位置按分钟计算，云场仍取所选时次）</span>
              </dd>
              <dt>地形视线</dt>
              <dd>
                剖面方向 {{ sectionHorizonDeg === null ? '缺测' : sectionHorizonDeg.toFixed(1) + '°' }} ·
                太阳方向 {{ sunHorizonDeg === null ? '缺测' : sunHorizonDeg.toFixed(1) + '°' }}
                <template v-if="sun.el <= 0">→ {{ isSunriseFile ? '太阳还在地平线下（还没升上来，此刻没有直射光）' : '太阳已落到地平线下（此刻没有直射光）' }}</template>
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
              <dt>{{ lightBoundaryWord }}（橙色虚线）</dt>
              <dd>
                <template v-if="terminator === null">
                  太阳方位与剖面近乎垂直，边界位置在二维图里不可判
                </template>
                <template v-else>
                  {{ isSunriseFile ? '地面日出线' : '地面日落线' }}在剖面方向 <b>{{ terminator.toFixed(0) }} km</b>{{ terminator >= 0 ? '（前方）' : '（后方）' }}{{ terminatorLabel }}；
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
              剖面只有 {{ activeFile.lengthKm }} km，而{{ lightBoundaryWord }}通常在数十到数百 km 外，
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
                <template v-else>按「总凝结水 ≥ 10 mg/kg（0.01 g/kg）」判为有云；云底/云顶取中段采样点的最低/最高有云层，厚度 = 云顶 − 云底。
                云属按该带内<b>凝结水最浓那层</b>的液冰比例判定（冰晶为主→卷云族，液态为主→层积云族；把鼠标放到云上也能看到单点云属）。</template>
                <span v-if="!bandList.length">这一时刻路径中段没有达到该阈值的云。</span>
              </p>
              <ul v-if="bandList.length" class="xsec-bands">
                <li v-for="(b, i) in bandList" :key="i">
                  <span
                    class="xsec-band-dot"
                    :class="b.estimated ? 'is-est' : (b.liquid ? 'is-liquid' : 'is-ice')"
                  />
                  {{ b.toHpa === b.fromHpa ? b.fromHpa : b.toHpa + '–' + b.fromHpa }} hPa
                  <span class="xsec-band-h">（{{ b.toKm.toFixed(1) }}–{{ b.fromKm.toFixed(1) }} km）</span>
                  <span class="xsec-band-kind">
                    {{ b.estimated ? '湿度诊断云量' : (b.liquid ? '含液水' : '冰云为主') }}
                  </span>
                  <!-- 云属：用 GFS 真三维云水/云冰的液冰比判，比只看云量+湿度更硬 -->
                  <span
                    v-if="bandGenuses[i]"
                    class="xsec-band-genus"
                    :title="(bandGenuses[i]!.codeEn || '') + (bandGenuses[i]!.speciesEn ? ' · ' + bandGenuses[i]!.speciesEn : '') + '\n' + bandGenuses[i]!.note"
                  >
                    {{ bandGenuses[i]!.familyName }} ·
                    {{ bandGenuses[i]!.genus }}<b>（{{ bandGenuses[i]!.code }}）</b>
                    <template v-if="bandGenuses[i]!.species">· {{ bandGenuses[i]!.species }}</template>
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
                  <!-- 同上：必须用当前文件的 cycle/generatedAt，不能用试点索引 -->
                  <dd>
                    {{ beijingDateTime(activeFile.cycle) }} → {{ beijingDateTime(activeFile.generatedAt) }}（北京）
                  </dd>
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
                <dt>水平分辨率</dt><dd>{{ gridKmNow }} km（0.25°，{{ activeFile.lengthKm }} km 内只有约 {{ Math.max(1, Math.round(activeFile.lengthKm / gridKmNow)) }} 个真实格点）</dd>
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
