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

/** AOD 通透度分级（参照 SunsetBot 团队的对照表） */
export interface AodBand {
  max: number
  name: string
  v: number
}

/** 机位 */
export interface Spot {
  n: string
  lat: number
  lon: number
  face: string
  area: string
}

export interface ModelInfo {
  id: string
  name: string
  tag: string
}

/** Open-Meteo 的逐小时/逐日字段：数字数组（缺测为 null），time 是 ISO 字符串数组 */
export type RawSeries = Array<number | string | null>

export interface RawPoint {
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
  vis: number | null
  aod: number
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

/** 一条拍摄提示词条 */
export interface Phototip {
  key: string
  name: string
  alias: string
  /** 为什么现在可能出现 */
  why: string
  /** 怎么拍 */
  shoot: string
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
  /** 匹配到的拍摄题材/黑话 */
  tips: Phototip[]
  /** 逐小时（只有 DETAIL_SPOT 会填） */
  hourly: DetailHour[]
}

/** 兼容旧引用：Detail 就是 SpotDetail */
export type Detail = SpotDetail

/** 列表里的一行 = 一个机位的一次预报 */
export interface Row {
  spot: Spot
  m: Measure
  score: number
  level: Level
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
  /** 这个机位目标时刻的完整详情 */
  detail: SpotDetail
}

/** 一次取数的缓存（10 分钟） */
export interface CacheData {
  weather: RawData
  air: RawData | null
  profs: RawData | null
  at: number
  fromStatic: boolean
}

export interface ForecastState {
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
}

/* ---------- 静态缓存文件 schema ---------- */
export interface StaticFile {
  generatedAt?: string
  models?: string[]
  spots?: number
  weather?: RawData
  air?: RawData | null
  prof?: RawData | null
}
