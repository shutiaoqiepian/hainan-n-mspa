/**
 * 太阳在「剖面平面」里的投影。
 *
 * ⚠ 太阳方位角 ≠ 剖面方位角。直接拿高度角画光线是错的：
 *   真实太阳方向是一个三维单位向量，只有投影到剖面上的那部分才属于这张二维图。
 *
 * 坐标约定（与图表一致）：
 *   x 轴 = 沿剖面方位、离观察者的水平距离（km，向远处为正）
 *   y 轴 = 海拔高度（km）
 *
 * 太阳单位向量（东, 北, 天顶）= (cos el · sin az, cos el · cos az, sin el)
 * 剖面水平方向单位向量 p̂ = (sin φ, cos φ)，φ = 剖面方位角
 *   s‖ = s · p̂ = cos el · cos(az − φ)      ← 平面内水平分量
 *   s⊥ = cos el · sin(az − φ)              ← 垂直于剖面的分量（图上画不出来）
 * 平面内「视高度角」= atan2(sin el, s‖) —— 这才是图上光线该有的斜率。
 * 当 s‖ < 0 时太阳在观察者背后，图上不能画成正前方。
 *
 * 复用现有 sun.ts 的太阳位置算法，不重写。
 */
import { sunPosition } from '@/lib/forecast/sun'

export interface SunInPlane {
  /** 真实太阳高度角（度） */
  el: number
  /** 真实太阳方位角（度，正北 0°，顺时针） */
  az: number
  /** 太阳方位 − 剖面方位，归一化到 (−180, 180]；正 = 太阳在剖面右侧（方位角更大） */
  deviationDeg: number
  /** 投影到剖面平面内的高度角（度）；inFront=false 时表示「在背后」的视方向 */
  inPlaneEl: number
  /** 太阳是否在剖面正前方（s‖ > 0） */
  inFront: boolean
  /** 平面内分量占单位向量的比例（1 = 完全在剖面内，0 = 完全垂直剖面） */
  inPlaneFraction: number
  /** 平面内指向太阳的单位向量（x 沿路径，y 向上） */
  toward: { x: number; y: number }
  /** 垂直于剖面的分量（画不出来，但用来提示「太阳不在剖面平面内」） */
  outOfPlane: number
}

const RAD = Math.PI / 180

export function normalizeDeg(a: number): number {
  let v = ((a + 180) % 360 + 360) % 360 - 180
  if (v === -180) v = 180
  return v
}

export function sunInPlane(timeMs: number, lat: number, lon: number, pathAzDeg: number): SunInPlane {
  const { el, az } = sunPosition(timeMs, lat, lon)
  const deviationDeg = normalizeDeg(az - pathAzDeg)
  const cosEl = Math.cos(el * RAD)
  const sinEl = Math.sin(el * RAD)
  const sPar = cosEl * Math.cos(deviationDeg * RAD)
  const sPerp = cosEl * Math.sin(deviationDeg * RAD)
  const inPlaneFraction = Math.hypot(sPar, sinEl)
  /* inPlaneEl 用 atan2 —— 当 sPar 为负（太阳在背后）时它会给出 >90° 或负角，
     调用方必须同时看 inFront，别只取角度。 */
  const inPlaneEl = Math.atan2(sinEl, sPar) / RAD
  const len = Math.hypot(sPar, sinEl) || 1
  return {
    el,
    az,
    deviationDeg,
    inPlaneEl,
    inFront: sPar > 0,
    inPlaneFraction: Math.min(1, inPlaneFraction),
    toward: { x: sPar, y: sinEl },
    /* sPerp 图上画不出来，但它证明了「太阳不在剖面平面内」；
       之后若做体积云阴影投影，会用到这个分量。 */
    outOfPlane: sPerp
  }
}

/** 观察者位置的太阳高度角（用于判断是否已日落） */
export function sunAboveHorizon(timeMs: number, lat: number, lon: number): boolean {
  return sunPosition(timeMs, lat, lon).el > 0
}

/**
 * 当地某一天的日落时刻（毫秒）。搜索 08:00–14:00 UTC，1 分钟精度，
 * 与 tools/xsec/build_cross.py 的 sunset_utc_for_local_date 同一套判据（el 下穿 -0.833°）。
 */
export function sunsetMs(lat: number, lon: number, utcDateIso: string): number {
  const d = new Date(utcDateIso)
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0)
  let prev: number | null = null
  for (let k = 0; k <= 6 * 60; k++) {
    const t = base + k * 60000
    const el = sunPosition(t, lat, lon).el
    if (prev !== null && prev > -0.833 && el <= -0.833) return t
    prev = el
  }
  return NaN
}
