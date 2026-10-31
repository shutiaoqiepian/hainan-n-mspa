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
  pressureHpa: number
}
