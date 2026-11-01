/**
 * 太阳光路 / 照明几何引擎（阶段七 P1，界面「太阳几何卡」的计算核心）。
 *
 * 全部公式的条件、单位、来源都在函数注释里写清楚；这里**没有**任何辐射传输、
 * 没有云微物理、没有气溶胶垂直分布假设 —— 只有球面几何 + Beer-Lambert 直射削弱。
 *
 * 坐标与符号约定（与剖面图一致）：
 *   · 水平距离 l（km）：沿剖面方位，从机位向远处为正；
 *   · 高度 h（m，MSL 海拔）；
 *   · dSun（km）：某点在**太阳方位方向**上的水平分距离，向太阳那侧为正；
 *     剖面内的点 dSun = l · cos(Δ)，Δ = 太阳方位 − 剖面方位（°）。
 *   · el（°）：机位处太阳高度角（含大气折射的常用定义这里不含，见下）。
 *
 * 核心判据（球面几何，太阳视为无穷远点光源）：
 *   机位处太阳高度角 el；地球阴影边界在距机位 dSun 处的高度 h_b 满足
 *       el + dSun/R = −dip(h_b),   dip(h) = acos(R/(R+h))
 *   ⇒ 点 (dSun, h) 受直射光 ⇔ el + dSun/R > −dip(h)
 *     （h_b 展开到一阶即原文 h = l²/(2R)：el=0 时 h_b = dSun²/(2R)，与
 *      docs/阶段六-03 的 image76/image86 公式一致，单元测试里有回归。）
 *
 * 已知局限（页面必须同步展示，不能藏着）：
 *   1. 太阳高度角用现有 `sunPosition()`（NOAA 低精度，±0.01° 量级），未含大气折射
 *      （真实折射会把日出日落抬升约 0.5°，本项目一律用 −0.833° 的日落判据）。
 *   2. 二维剖面只能表达太阳方位与剖面方位重合时的光路；Δ 大时以 cos Δ 投影，
 *      垂直剖面的分量画不出来，卡里会写"太阳不在剖面平面内"。
 *   3. 地形遮挡用「沿太阳方位 0–200 km 的 DEM 剖面」近似，未做三维地形求交。
 *   4. 受光判据只是几何：云是否真的烧起来还取决于云量、厚度、液/冰、气溶胶谱、
 *      观测方向等，本文件**不预测火烧云**。
 */
import { sunPosition } from '@/lib/forecast/sun'

export const R_KM = 6371.0088
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/* ================= 1. 球面几何 ================= */

/** 高度 h（m）处的视地平俯角（°）。h≤0 返回 0。 */
export function dipDeg(hM: number): number {
  if (!Number.isFinite(hM) || hM <= 0) return 0
  const r = R_KM / (R_KM + hM / 1000)
  return Math.acos(Math.min(1, Math.max(-1, r))) * R2D
}

/** 某点在太阳方位方向距离 dSun（km）后的「当地太阳高度角」（°）。
 *  推导：沿太阳方位走 d，当地水平面相对机位水平面转过 d/R 弧度（朝太阳侧抬高）。
 *  只用球面几何，不含折射。 */
export function localSunElDeg(elObsDeg: number, dSunKm: number): number {
  return elObsDeg + (dSunKm / R_KM) * R2D
}

/**
 * 地球阴影边界高度 h_b（km）在剖面内距离 l（km）处。
 * 返回 0 表示「该处地面上方没有阴影」（全部受光）；否则阴影区域为 h < h_b。
 *   u = el + l·cosΔ/R；u ≥ 0 ⇒ 0；u < 0 ⇒ h_b = R·u²/2
 * 与原文 image76 的 h_f = (l−vt)²/(2R) 在 el=0、Δ=0 时同形（t=0 即 l²/2R）。
 */
export function boundaryHeightKm(lKm: number, elObsDeg: number, deviationDeg: number): number {
  const u = elObsDeg * D2R + (lKm * Math.cos(deviationDeg * D2R)) / R_KM
  if (u >= 0) return 0
  return 0.5 * R_KM * u * u
}

/** 点 (l, h) 是否处于几何直射光中（不含地形遮挡与气溶胶）。 */
export function litAt(hM: number, dSunKm: number, elObsDeg: number): boolean {
  return localSunElDeg(elObsDeg, dSunKm) > -dipDeg(hM)
}

/** 地面日落线（阴影边界与地面交点）在剖面方向上的距离（km），正 = 前方（太阳侧）。
 *  |cosΔ| 很小时边界几乎平行剖面，位置不可判 → null。 */
export function terminatorKm(elObsDeg: number, deviationDeg: number): number | null {
  const c = Math.cos(deviationDeg * D2R)
  if (Math.abs(c) < 0.15) return null
  return (-elObsDeg * D2R * R_KM) / c
}

/** 照明边界在地面的移动速度（km/min，沿剖面方向），由两次太阳位置数值差分得到。
 *  不用查表值：原文附录表的「日落线速度」口径与沿剖面方向的投影速度并不等价。 */
export function terminatorSpeedKmMin(
  timeMs: number,
  latDeg: number,
  lonDeg: number,
  deviationDeg: number
): number | null {
  const a = terminatorKm(sunPosition(timeMs, latDeg, lonDeg).el, deviationDeg)
  const b = terminatorKm(sunPosition(timeMs + 10 * 60000, latDeg, lonDeg).el, deviationDeg)
  if (a === null || b === null) return null
  return (b - a) / 10
}

/* ================= 2. 气溶胶直射削弱（Beer-Lambert） ================= */

/**
 * 大气质量（airmass，无量纲）。Kasten & Young (1989) 的常用近似，
 * 与 src/lib/forecast/scoring.ts 的 `airmass()` 同一式子（那边参与评分，这里只读不改）。
 * 太阳在地平线下时封顶 38（斜程最长约 38 个大气质量）。
 * ⚠ 接近地平线时真实的天空亮度很大一部分来自多次散射与折射，
 *   单次散射的 exp(−τ·m) 会明显偏暗（透过率可低到 1% 以下），
 *   因此这个数值只用于**相对比较**（低太阳 vs 高太阳、AOD 大 vs 小），
 *   不能当作"天空还剩多少光"的定量答案。
 */
export function airmass(elDeg: number): number {
  const el = elDeg > 0 ? elDeg : 0
  const m = 1 / (Math.sin(el * D2R) + 0.50572 * Math.pow(el + 6.07995, -1.6364))
  return Math.min(38, Math.max(1, m))
}

/**
 * 直射光透过率 I/I₀ = exp(−τ·m)，τ = AOD（550 nm 柱总量），m = airmass。
 * ⚠ 这是**宽带近似**：AOD 是单一波长柱总量，真实消光随波长变化（Ångström 指数），
 * 且没有把云、水汽、臭氧分开 —— 只用来解释「低太阳 + 高 AOD 时直射光明显变弱」。
 */
export function transmittance(aod: number | null, elDeg: number): number | null {
  if (aod === null || !Number.isFinite(aod) || aod < 0) return null
  return Math.exp(-aod * airmass(elDeg))
}

/* ================= 3. 地形 ================= */

/**
 * 沿某个方位的地形「视线高度角」（°，从机位看出去的最高地形仰角，含曲率修正）。
 * elev[i] = 距机位 i·stepKm 处的 DEM 高度（m）；缺测跳过。
 * 公式：atan2(Δh, d) − d/(2R)（docs/阶段六-03 的 image136 公式）。
 */
export function terrainHorizonDeg(
  elev: Array<number | null>,
  stepKm: number
): number | null {
  const base = elev[0]
  if (base === null || base === undefined || elev.length < 2) return null
  let best = -90
  let seen = 0
  for (let i = 1; i < elev.length; i++) {
    const e = elev[i]
    if (e === null || e === undefined) continue
    seen++
    const d = i * stepKm
    if (d < 0.5) continue
    /* atan2(Δh, d) 得几何仰角，减去曲率项 d/(2R)（rad → 度） */
    const corrected = Math.atan2(e - base, d * 1000) * R2D - (d / (2 * R_KM)) * R2D
    if (corrected > best) best = corrected
  }
  return seen ? best : null
}

/**
 * 地形是否挡住「云 → 太阳」的直射光路（二维近似）。
 * 光路高度（原文 image136 的逆式，含 l²/(2R) 曲率项）：
 *   h_ray(x) = h ± (x−d)·tan(el_local) + (x−d)²/(2R)
 * x 沿太阳方位，d = 该点在同一方位上的距离，el_local = 该点当地太阳高度角。
 * 返回 null = 地形剖面缺测（不能判定），false = 未被地形挡住，true = 被挡住。
 */
export function terrainBlocksRay(
  hM: number,
  dSunKm: number,
  elev: Array<number | null>,
  stepKm: number,
  elObsDeg: number
): boolean | null {
  if (!elev.length) return null
  const elLocal = localSunElDeg(elObsDeg, dSunKm) * D2R
  const maxIdx = elev.length - 1
  let seen = 0
  for (let i = Math.max(1, Math.ceil(dSunKm / stepKm) + 1); i <= maxIdx; i++) {
    const e = elev[i]
    if (e === null || e === undefined) continue
    seen++
    const dx = i * stepKm - dSunKm
    if (dx < 0.5) continue
    const rayM = hM + dx * 1000 * Math.tan(elLocal) + (dx * dx * 1000) / (2 * R_KM)
    if (e > rayM) return true
  }
  return seen ? false : null
}

/* ================= 4. 逐云带的受光时间窗 ================= */

export interface BandLight {
  /** 参考时刻（剖面时次）是否在几何直射光中；null = 无法判定 */
  lit: boolean | null
  /** 相对当地地面日落的分钟数：开始/失去直射光（负 = 日落前）。null = 扫描窗口内没有变化 */
  startMin: number | null
  endMin: number | null
  /** 受光持续分钟（只有 start/end 都拿到才有；否则 null） */
  durationMin: number | null
  /** 地形遮挡（二维近似）；null = 地形缺测 */
  terrainBlocked: boolean | null
  /** 参考时刻 = 日落 + 多少分钟（>0 = 日落后） */
  atMin: number | null
}

/**
 * 扫描日落前后窗口，求某点几何直射光的起止时刻。
 * @param hM 该点海拔（m，取云底 = 最早失光的一侧）
 * @param dSunKm 该点在太阳方位方向上的距离（km）
 * @param sunsetMs 当地地面日落时刻（ms；el 下穿 −0.833°）
 * @param refMs 剖面时次的时刻（用来给"现在是否受光"）
 * 判据见文件头；扫描步长 15 s，边界不确定性 ≤15 s。
 */
/**
 * 远场光路：主图只到 320 km，但照明边界常在更远处。
 * 这里算「从机位沿太阳方位、0 到 maxKm，哪些距离段被直射光照到」，
 * 用作主图底部的「光路带」（纯几何，不依赖气象数据，因此远处也有值）。
 * 返回按 stepKm 采样的数组，true = 该距离处的**地面/云底**受光。
 */
export function farFieldLit(
  maxKm: number,
  stepKm: number,
  elObsDeg: number
): Array<{ d: number; lit: boolean }> {
  const out: Array<{ d: number; lit: boolean }> = []
  for (let d = 0; d <= maxKm + 1e-9; d += stepKm) {
    /* 地面（h=0）在该距离是否受光：dip(0)=0，判据变成 el + d/R > 0 */
    out.push({ d, lit: litAt(0, d, elObsDeg) })
  }
  return out
}

export function bandLightWindow(opts: {
  hM: number
  dSunKm: number
  lat: number
  lon: number
  sunsetMs: number
  refMs: number
  elevProfile?: Array<number | null>
  stepKm?: number
}): BandLight {
  const { hM, dSunKm, lat, lon, sunsetMs, refMs, elevProfile, stepKm } = opts
  const beforeMin = 60
  const afterMin = 90
  const stepMin = 0.25
  const elAt = (ms: number): number => sunPosition(ms, lat, lon).el
  let prev: boolean | null = null
  let startMin: number | null = null
  let endMin: number | null = null
  for (let min = -beforeMin; min <= afterMin + 1e-9; min += stepMin) {
    const lit = litAt(hM, dSunKm, elAt(sunsetMs + min * 60000))
    if (prev !== null && lit !== prev) {
      if (lit) startMin = min
      else endMin = min
    }
    prev = lit
  }
  const elRef = Number.isFinite(refMs) ? elAt(refMs) : sunPosition(sunsetMs, lat, lon).el
  const lit0 = litAt(hM, dSunKm, elRef)
  /* 只有"几何上本该受光"时，地形遮挡才有意义；几何已在地球阴影里就记 false（不是缺测）。 */
  const terrainBlocked = !lit0
    ? false
    : elevProfile && stepKm && elevProfile.length > 1
      ? terrainBlocksRay(hM, dSunKm, elevProfile, stepKm, elRef)
      : null
  const durationMin =
    startMin !== null && endMin !== null && endMin > startMin ? endMin - startMin : null
  return {
    lit: terrainBlocked === true ? false : lit0,
    startMin,
    endMin,
    durationMin,
    terrainBlocked,
    atMin: Number.isFinite(refMs) ? (refMs - sunsetMs) / 60000 : null
  }
}

/* ================= 5. 小工具 ================= */

/** 把相对日落的分钟数变成「日落后 X 分」的中文说法（负 = 日落前）。 */
export function describeMin(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '窗口内无变化'
  const abs = Math.abs(min)
  const m = Math.floor(abs)
  const s = Math.round((abs - m) * 60)
  const tail = s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`
  return min >= 0 ? `日落后 ${tail}` : `日落前 ${tail}`
}
