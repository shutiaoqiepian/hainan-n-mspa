/**
 * 大气水平—垂直截面（atmospheric cross section）数据模型。
 *
 * 数据由 tools/xsec/build_cross.py 在 CI 里从 NOAA GFS 0.25° pgrb2 生成，
 * 前端只读静态 JSON，**绝不在浏览器里解 GRIB**。
 *
 * 与 forecast 模块完全解耦：这里的任何字段都不参与 scoreOf()。
 */

/** 单层里每个数值对应的字段名，顺序由 JSON 的 levelFields 决定（不要写死下标） */
export type XsecField =
  | 'hgtM'
  | 'tC'
  | 'rhPct'
  | 'clwMgKg'
  | 'iciMgKg'
  | 'uMs'
  | 'vMs'
  | 'wPaS'
  | 'cfPct'
  | 'belowGround'
  /** 地面降水率 mm/h（GFS PRATE×3600）；缺测为 null */
  | 'rainMmH'

export interface XsecTime {
  /** sections[].t 用的下标 */
  t: number
  /** 预报有效时刻（UTC，ISO） */
  utc: string
  /** 相对起报时刻的预报时效（小时） */
  leadHours: number
}

export interface XsecSpotMeta {
  id: string
  name: string
  lat: number
  lon: number
  terrainM: number
  defaultAzimuth: number
  tag: string
  area: string
  face: string
  /** 机位文件名（相对 data/cross/） */
  file: string
  bytes: number
}

export interface XsecThresholds {
  /** 阈值参考的是什么（写清楚，别让人误以为是真实云） */
  reference: string
  variable: string
  /** 显示分级（kg/kg）：有凝结水 / 可辨识云 / 厚云 */
  displayBandsKgKg: number[]
}

export interface XsecIndex {
  version: number
  source: string
  model: string
  license: string
  /** 模式起报时刻（UTC，ISO） */
  cycle: string
  generatedAt: string
  gridKm: number
  gridApproxKm: number
  lengthKm: number
  sampleIntervalKm: number
  levelsHpa: number[]
  levelFields: XsecField[]
  levelFieldUnits: Record<string, string>
  azimuths: number[]
  times: XsecTime[]
  thresholds: XsecThresholds
  notes: string[]
  spots: XsecSpotMeta[]
}

/** 一层的一行数值，顺序与 levelFields 一致；null = 缺测，绝不能当 0 */
export type XsecLevelRow = Array<number | null>

export interface XsecSample {
  /** 沿路径水平距离 km */
  d: number
  lat: number
  lon: number
  terrainM: number
  /** 与 levelsHpa 同序（1000 → 200 hPa，从低到高） */
  levels: XsecLevelRow[]
}

/** 真实模式格点投影到路径上的位置：[沿路径 km, 纬度, 经度] */
export type XsecGridNode = [number, number, number]

export interface XsecSection {
  /** 剖面方位角（正北 0°，顺时针） */
  az: number
  /** 时间下标，对应 times[].t */
  t: number
  leadHours: number
  gridNodes: XsecGridNode[]
  samples: XsecSample[]
}

export interface XsecDomain {
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

export interface XsecSpotFile {
  version: number
  source: string
  model: string
  cycle: string
  generatedAt: string
  domain: XsecDomain
  gridKm: number
  lengthKm: number
  sampleIntervalKm: number
  levelsHpa: number[]
  levelFields: XsecField[]
  azimuths: number[]
  times: XsecTime[]
  spot: XsecSpotMeta
  sections: XsecSection[]
}

/** 一个层在某个水平采样点上的全部数值（已按字段名展开） */
export interface XsecPoint {
  /** 海拔高度 m（数据源逐格点位势高度，不是压高公式换算） */
  hgtM: number | null
  tC: number | null
  rhPct: number | null
  clwMgKg: number | null
  iciMgKg: number | null
  uMs: number | null
  vMs: number | null
  wPaS: number | null
  cfPct: number | null
  belowGround: boolean
  /** 地面降水率 mm/h；null = 缺测（不是"没下雨"） */
  rainMmH?: number | null
  pressureHpa: number
}

/** 全国机位索引（data/cross/national-index.json），与海南 8 机位索引分开 */
export interface XsecNationalIndex {
  version: number
  source: string
  model: string
  cycle: string
  generatedAt: string
  lengthKm: number
  sampleIntervalKm: number
  levelsHpa: number[]
  levelFields: XsecField[]
  azimuthPolicy: string
  times: XsecTime[]
  spots: Array<{
    prov: string
    id: string
    name: string
    /** 相对 data/cross/ 的路径，如 "hn/hn-000.json" */
    file: string
    bytes: number
    azimuth: number
  }>
  errors: Array<Record<string, string>>
  note: string
}

/* ================= 环境上下文（DEM 地形 + AOD，独立于 GFS 剖面缓存） ================= */

/** 一段 DEM 地形序列：从机位沿某方位等间距取的高程（m）；null = 该点缺测 */
export type XsecDemSeries = Array<number | null>

export interface XsecSunTerrainProfile {
  /** 该时次的日落方位（°） */
  az: number
  /** 0, sunStepKm, 2·sunStepKm, … 的 DEM 高程（m） */
  elev: XsecDemSeries
}

export interface XsecSpotContext {
  /** 机位 DEM 海拔（m）；null = 缺测 */
  elevationM: number | null
  /** 实际使用的 DEM 来源（Copernicus GLO-30 / SRTM 90m 回退等） */
  demSource?: string
  /** 沿剖面各方位（key 为方位角字符串）的地形序列，步长 sectionStepKm */
  profiles: Record<string, XsecDemSeries>
  /** 各时次沿日落方位的地形序列（用于光路被地形遮挡的判定） */
  sunProfiles: XsecSunTerrainProfile[]
  /** 各时次的 AOD（550 nm 柱总量，无量纲）；null = 缺测 */
  aod: Array<{ utc: string; v: number; nearest?: boolean } | null>
}

export interface XsecContext {
  version: number
  generatedAt: string
  sources: Record<string, string>
  sectionStepKm: number
  sunStepKm: number
  spots: Record<string, XsecSpotContext>
  errors: string[]
}
