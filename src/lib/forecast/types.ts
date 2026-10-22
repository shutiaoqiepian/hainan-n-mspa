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

/** 高空湿度剖面 → 云层结构判断 */
export interface Profile {
  label: string
  mod: number
  cape: number | null
}

export interface SunPos {
  el: number
  az: number
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

/** 海口逐小时详细面板 */
export interface Detail {
  spot: Spot
  time: string
  golden: string
  blue: string
  hours: DetailHour[]
}

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
  rays: number
  spread: number
  models: number
  cloudBaseLow: number | null
  cloudBaseMid: number | null
  sunAz: number | null
  faceOff: boolean
  date: string
  ms: number
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
  error: string | null
  loading: boolean
  updatedAt: number
  fromStatic: boolean
}
