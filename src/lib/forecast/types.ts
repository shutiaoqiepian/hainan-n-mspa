/* ============================================================
   霞光预报：类型定义
   数据来自 Open-Meteo（免费、无需 key），字段结构与旧版一致
   ============================================================ */

/** 时段：日出 / 日落 */
export type KindKey = 'sunrise' | 'sunset'

export interface Kind {
  key: KindKey
  word: string
  name: string
}

export interface Level {
  min: number
  name: string
  color: string
}

/**
 * 分数对应的**区间档位**（2026-11-06 新增，见 levels.ts 的 gradeRangeOf）。
 * 分数是确定数，但压在等级分界上的时候，只报一个档次会显得过于肯定，
 * 所以按 ±RANGE_DELTA 分算出「小烧到中烧」这种区间写法。
 */
export interface GradeRange {
  /** 区间下沿的等级 */
  low: Level
  /** 区间上沿的等级 */
  high: Level
  /** 「小烧到中烧」；不在分界附近时就是等级名本身 */
  text: string
  isRange: boolean
  /** 区间跨过的那条分界（isRange 时有效），给提示文字用 */
  boundary: number
  /** 「为什么写成区间」的解释，给悬停提示用；不是区间时是空串 */
  why: string
}

/** AOD 通透度分级（参照 SunsetBot 团队的对照表） */
export interface AodBand {
  max: number
  name: string
  v: number
}

/** 省份 key（hn=海南、gd=广东、bj=北京……见 data/forecast/spots.ts 的 PROVINCES） */
export type ProvKey = string

/** 机位 */
export interface Spot {
  n: string
  lat: number
  lon: number
  face: string
  /** 省内分区，用于筛选（如「广州」「粤东」） */
  area: string
  /** 所属省份 */
  prov: ProvKey
  /**
   * 观测互补点位：机场 ICAO 四字码。
   * 有这一项说明这个「机位」就是机场本身 —— 它存在的意义是拿机场 METAR 实况
   * 与同一地点的预报分做校验（tools/check-accuracy.mjs）。
   * 它不是拍摄机位：face 为 "—"，默认不展示，只在「观测点」模式下出现。
   */
  obs?: string
}

export interface ModelInfo {
  id: string
  name: string
  tag: string
}

/** Open-Meteo 的逐小时/逐日字段：数字数组（缺测为 null），time 是 ISO 字符串数组 */
export type RawSeries = Array<number | string | null>

export interface RawPoint {
  /** 响应里回传的（已吸附到格点的）中心坐标 */
  latitude?: number
  longitude?: number
  elevation?: number
  hourly?: Record<string, RawSeries>
  daily?: Record<string, RawSeries>
}

export type RawData = RawPoint[]

/** 某一小时的观测集合（多模式时已取平均） */
export interface Measure {
  high: number | null
  mid: number | null
  low: number | null
  rh: number | null
  pop: number | null
  t2m: number | null
  td2m: number | null
  /**
   * 10 m 风速（m/s）。
   * 数据源本来就有 `wind_speed_10m`（`prof[]` 里，42/72 小时非空），
   * 但 2026-11-05 之前从没被提取进 Measure —— 雾判据要用它才补上。
   * ⚠️ 同一批数据里 `boundary_layer_height` 和 `visibility` 虽然请求了，
   *    但**全部返回 null**（0/72），所以这两个不能拿来当判据。
   */
  wind10: number | null
  vis: number | null
  /** ⚠ 缺测时这里是**计算用的默认值**（0.2），不是观测值；真实与否看 aodMissing */
  aod: number
  /** AOD 缺测时填的是默认值，不是真实观测 */
  aodMissing?: boolean
  /** AOD 实测值（缺测为 null）。影子分数与展示优先用这个，避免把默认值当真值 */
  aodReal?: number | null
  /** 单位时间降水量（mm，该小时）——用于「雨停转好」判断，不是降水概率 */
  precipMm?: number | null
  /** 该小时的 HH:MM，compute 里补上 */
  time?: string
}

/** 高空湿度剖面 → 云层结构判断（旧版兜底，只有四层湿度） */
export interface Profile {
  label: string
  mod: number
  cape: number | null
}

export interface SunPos {
  el: number
  az: number
}

/** 一层云：按气压层聚合，对应 SunsetBot「大气截面图」里的一层 */
export interface CloudLayer {
  /** 气压层，hPa */
  level: number
  /** 该层位势高度，m */
  height: number
  /** 云量 % */
  cover: number
  /** 相对湿度 % */
  rh: number
  /** 温度 ℃ */
  t: number | null
  /** 露点 ℃ */
  td: number | null
  /** 云属代码：Ci / Cs / Cc / Ac / As / Ns / Sc / St / Cu / Cb / Cl / -- */
  code: string
  /** 云属中文名，如「卷层云」 */
  genus: string
  /** 云种/俗称，如「透光高积云」「钩卷云」 */
  species: string
  /** 云底估算高度 m */
  base: number | null
  /** 云顶估算高度 m */
  top: number | null
  /** 是否薄云：能被低角度阳光从下方照亮（火烧云的关键） */
  lit: boolean
  /** 一句话说明，直接显示给用户 */
  note: string
}

/** 连成一片的云层（从下往上） */
export interface CloudSheet {
  base: number
  top: number
  cover: number
  genera: string[]
  lit: boolean
  text: string
}

/** 雾判据里的一条依据 */
export interface FogBasis {
  /** 这一条叫什么 */
  label: string
  /** ✓ 满足 / ✗ 不满足 / ? 数据不足 / — 不适用 */
  state: 'ok' | 'no' | 'na' | 'missing'
  /** 实测值，如「1.0 K」 */
  value: string
  /** 要求，如「≤ 1.5 K」 */
  need: string
  /** 一句人话解释为什么这条重要 */
  why: string
}

/**
 * 雾的「环境符合度」结果。
 *
 * ★ 这不是概率，是「5 条判据满足了几条」的除法。
 *   我们没有雾的观测数据，算不了真正的概率（用户 2026-11-05 拍板选 A 方案）。
 *   详见交接文档第 36 节。
 */
export interface FogResult {
  /** 环境符合度 0–100；可用条数为 0 时为 null */
  pct: number | null
  /** 满足了 n 条 / 共 m 条可用 */
  hit: number
  total: number
  /** 逐条依据 */
  basis: FogBasis[]
  /**
   * 硬门槛状态：平流雾的「冷面条件」（露点 > 海温）。
   * 'no' 时这一类雾物理上基本不可能 —— 卡片要明确说出来，
   * 不能拿「4/5 项」去掩盖一个必要条件不满足。
   */
  gate: 'ok' | 'no' | 'missing'
  /** 数据状态：ok 齐全 / partial 缺海温 / missing 缺关键字段 */
  dataStatus: 'ok' | 'partial' | 'missing'
  /** 怎么结合别的数据判断（指导） */
  guide: string[]
}

/** 天象的稀有度评级 —— 词库、当次卡片、名片共用同一套词 */
export type PhenoRarity = '每天' | '常见' | '少见' | '罕见' | '几乎不可能'

/** 一条天象词条（原先叫「拍摄题材」，2026-11-05 全部改为「天象」） */
export interface Phototip {
  key: string
  name: string
  alias: string
  /** 稀有度评级 */
  rarity: PhenoRarity
  /** 为什么现在可能出现 */
  why: string
  /** 怎么拍 */
  shoot: string
}

/** 一个模式与平均值打架的说明 */
export interface Conflict {
  /** 云层：高 / 中 / 低 */
  band: '高云' | '中云' | '低云'
  /** ECMWF 的值 */
  ecmwf: number
  /** 多模式平均 */
  avg: number
  /** 差值 */
  diff: number
  /** 人话描述 */
  text: string
}

/** 自动生成的气象解读 */
export interface Interpretation {
  /** 一句话结论 */
  headline: string
  /** 加分项 */
  pros: string[]
  /** 减分项 */
  cons: string[]
  /** 出发建议 */
  advice: string
}

export interface DetailHour {
  t: string
  high: number | null
  mid: number | null
  low: number | null
  aod: number
  pop: number | null
  score: number
  /** 该小时的太阳高度角（同一个机位，随时间变化） */
  sunEl: number | null
  /** 该小时的通透度与文字档 */
  clarity: number
  clarityLabel: string
  /** 该小时的鲜亮度（本站 0–100 口径，不是 SunsetBot 的 0–2.5） */
  vivid: number
  vividLabel: string
  /** 该小时 AOD 的档位名 */
  aodName: string
}

/** 一个机位在目标时刻的完整详情 */
export interface SpotDetail {
  spot: Spot
  /** 目标日期 YYYY-MM-DD */
  date: string
  /** 星期几，如「周五」 */
  weekday: string
  /** 目标时刻 HH:MM（日出/日落） */
  time: string
  /** 太阳高度角（度，负值表示已落到地平线下） */
  sunEl: number | null
  /** 太阳方位角（度） */
  sunAz: number | null
  /** 黄金时刻区间 */
  golden: string
  /** 蓝调时刻区间 */
  blue: string
  /** 逐层云（从低到高） */
  layers: CloudLayer[]
  /** 连成片的云层 */
  sheets: CloudSheet[]
  /** 一句话云况：高云卷层云、中云高积云、低云无 */
  genusText: string
  /** 自动解读 */
  interpret: Interpretation
  /** 各模式分歧说明：ECMWF 的高/中/低云与多模式平均差太大时为非空 */
  conflicts: Conflict[]
  /** 这个机位落到的模式格点（吸附后的中心坐标） */
  grid: string
  /** 匹配到的天象/黑话 */
  tips: Phototip[]
  /** 逐小时（只有 DETAIL_SPOT 会填） */
  hourly: DetailHour[]
}

/** 兼容旧引用：Detail 就是 SpotDetail */
export type Detail = SpotDetail

/**
 * 中云「云底照亮」几何 + 云种分类的结果（2026-11-05 新增）。
 *
 * 两个用途，别混：
 *   ① **界面**：告诉用户「几点几分到几点几分，中云的云底正在被低角度阳光从下方照亮」——
 *      这是摄影上真正决定「去早了还是去晚了」的那个数。
 *   ② **评分**：只有 lift 和 litMinutes 进算法（见 midcloud.ts 的保守参数）。
 *
 * ★ 不要把它叫「概率」。窗口是几何算出来的确定值，不是概率。
 */
export interface MidLight {
  /** 中云云底高度（m，估算）；用于算阴影角，缺测为 null */
  baseM: number | null
  /** 该高度的地球阴影角（度）：太阳低于地平线这么多，云底才进阴影 */
  shadowAngleDeg: number | null
  /** 云底被照亮的窗口起点（北京时间 HH:MM）；算不出为 null */
  litFrom: string | null
  /** 窗口终点（北京时间 HH:MM） */
  litTo: string | null
  /** 窗口长度（分钟） */
  litMinutes: number | null
  /** 云种标签，如「透光高积云」 */
  genus: string
  /** 透光系数 0–1 */
  translucency: number
  /**
   * 画布抬升量 0–1（0 = 没补，评分与历史口径完全一致）。
   * 评分的做法是 h' = h + (1 − h) × lift，只增不减、永远不超过 1。
   */
  lift: number
  /** 判据一句话 */
  why: string
}

/** 数据质量：把「天气不好」和「没有数据」分开 */
export interface DataQuality {
  /** 关键字段完整度 0–100 */
  completeness: number
  /** 缺了哪些字段的中文名 */
  missing: string[]
  /**
   * ok        = 关键字段齐
   * partial   = 缺 1–2 项，分数仅供参考
   * poor      = 缺 3 项以上，分数基本不可信
   */
  status: 'ok' | 'partial' | 'poor'
}

/** 列表里的一行 = 一个机位的一次预报 */
export interface Row {
  spot: Spot
  m: Measure
  score: number
  level: Level
  /** 区间档位：「小烧到中烧」/「小烧」——界面上形容一次预报用这个，而不是 level.name */
  grade: GradeRange
  aodName: string
  profLabel: string
  rainbow: boolean
  rainbowScore: number
  clarity: number
  /** 云隙光 / 丁达尔（旧字段名保留，含义已明确为“云隙光”） */
  rays: number
  /** 太阳光柱（日柱）指数 */
  pillar: number
  spread: number
  models: number
  cloudBaseLow: number | null
  cloudBaseMid: number | null
  sunAz: number | null
  faceOff: boolean
  date: string
  ms: number
  /** 流水线第一层的原始分（未平滑、未打折），详情里和最终分并列显示 */
  rawScore: number
  /* ---- 线上评分实际用到的修正项（只读观察值，供影子分数用同一口径做基线）---- */
  /** 太阳方向上游柱的遮挡系数（1 = 不挡） */
  horizonBlock?: number
  /** 雨停回补系数（0 或 1） */
  rainRelief?: number
  /** 窗口内平均大气质量（AOD 斜程换算的参考光程） */
  aodRefMass?: number | null
  /** 该时次的 9 层气压云量（%），供影子分数做「垂直连续云」判断；缺测为 null */
  levelCover?: Array<{ hPa: number; coverPct: number | null; heightM: number | null }> | null
  /**
   * 中云「云底照亮」窗口 + 云种分类（2026-11-05 新增）。
   * 只有在能算出中云云底高度时才给；缺测保持 undefined，
   * 界面必须显示「数据不足」而不是「不烧」。
   */
  midLight?: MidLight
  /** 正点前后一小时里「平滑值最高」的那个小时的分数与时刻（最佳时刻） */
  peakScore: number
  peakTime: string
  /** 目标时刻的鲜亮度（本站 0–100） */
  vivid: number
  vividLabel: string
  /** 窗口内最鲜艳的那一小时（和 peakTime 是两个不同判断） */
  vividPeak: number
  vividPeakTime: string
  vividPeakLabel: string
  /**
   * 每一层云「如果被照亮会染成什么色」，与 detail.layers 同序同长。
   * 用和 vividLabel 完全相同的档位（火烧 / 橙金 / 粉紫 / 湛蓝 / 淡彩 / 近灰 / 无），
   * 所以决策卡剖面条的颜色和顶部的「鲜亮度 75 橙金」说的是同一件事。
   */
  hues?: string[]
  /** 每个模式自己的一份粗分（只换逐层云量），用来摊开各家怎么看 */
  perModel: ModelScore[]
  /** 数据质量：0–100 的完整度 + 缺了哪几项 */
  quality: DataQuality
  /** 这个机位目标时刻的完整详情 */
  detail: SpotDetail
}

/** 单个模式的粗分：只把逐层云量换成该模式的，其它量共用 */
export interface ModelScore {
  id: string
  name: string
  tag: string
  /** 这个模式有没有给出云量数据 */
  ok: boolean
  high: number | null
  mid: number | null
  low: number | null
  score: number | null
}

/** 一次取数的缓存（10 分钟） */
/** 太阳方向上的「上游柱」：日出看东边、日落看西边。
    只取三层云量，用来判断太阳落下那一路有没有被低云挡住。 */
export interface HorizonCols {
  west: RawPoint | null
  east: RawPoint | null
}

export interface CacheData {
  weather: RawData
  air: RawData | null
  profs: RawData | null
  /** 地平线柱（缺口 1）；旧缓存没有这个字段，读取时要有兜底 */
  horizon?: Array<HorizonCols | null> | null
  at: number
  fromStatic: boolean
}

export interface ForecastState {
  /** 当前省份：hn=海南 / gd=广东 */
  prov: ProvKey
  day: number
  kind: KindKey
  model: string
  area: string
  rows: Row[]
  detail: Detail | null
  shareSpot: string
  /** 展开详情的机位名，空字符串 = 全部收起 */
  openSpot: string
  error: string | null
  loading: boolean
  updatedAt: number
  fromStatic: boolean
  /** 目标日期 YYYY-MM-DD */
  targetDate: string
  /** 目标时刻 HH:MM */
  targetTime: string
  /** 下一次数据更新的大致时间（ms） */
  nextUpdateAt: number
  /** 动态测到的模式格点，如「约 0.05 度（≈6 km）」 */
  gridNote: string
  /**
   * 观测点模式：URL 带 ?obs=1 时为真。
   * 打开后，机位列表里额外出现「XX机场观测点」——
   * 它们是机场本身，用来和 METAR 实况做同地点校验，不是给人去拍的机位，
   * 所以默认隐藏，避免把 224 个点全塞给用户。
   */
  obsMode: boolean
}

/* ---------- 静态缓存文件 schema ---------- */
export interface StaticFile {
  generatedAt?: string
  models?: string[]
  prov?: string
  spots?: number
  /** 机位清单（与下面几个数组逐行对齐）。
      前端只用来做长度校验：两者对不上说明缓存是旧的，宁可当过期也别错位。 */
  place?: Array<Pick<Spot, 'n' | 'area' | 'lat' | 'lon' | 'face'> & { obs?: string }>
  weather?: RawData
  air?: RawData | null
  prof?: RawData | null
  /** 每个机位一条：朝西/朝东各一根柱（缺口 1） */
  horizon?: Array<HorizonCols | null> | null
}
