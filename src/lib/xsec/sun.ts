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
 * 把一个「瞬时」换成本站口径的**北京本地日期**（年/月/日三个整数）。
 *
 * ★ 为什么必须用北京日期，而不是传进来那个 ISO 的 UTC 日期：
 *   东八区比 UTC 早 8 小时，**北京时间凌晨 0–8 点这一段的 UTC 日期是前一天**。
 *   日出正好落在这个区间（北京 06:00 左右 = UTC 前一天 22:00 左右）。
 *   2026-11-05 实测：日出剖面默认时次选成了 04:00，比日出早 2 小时 42 分 ——
 *   根因就是 sunriseMs 拿 UTC 日期当北京日期用，算出来的是**前一天**的日出，
 *   于是「离日出最近的时次」变成第一个时次。
 *   （交接文档 §29 记过同类跨零点 bug，这次是同一类问题的第二处。）
 */
function beijingDateParts(utcDateIso: string): { y: number; m: number; d: number } {
  const bj = new Date(new Date(utcDateIso).getTime() + 8 * 3600 * 1000)
  return { y: bj.getUTCFullYear(), m: bj.getUTCMonth(), d: bj.getUTCDate() }
}

/**
 * 北京本地日期为 D 的那一天，当地地面的日落时刻（毫秒）。
 * 搜索 UTC [D 08:00, D 14:00)，1 分钟精度（即北京 16:00–22:00，
 * 覆盖东八区含喀什夏季最晚的日落），
 * 与 tools/xsec/build_cross.py 的 sunset_utc_for_local_date 同一套判据（el 下穿 -0.833°）。
 *
 * @param utcDateIso 该日落所属那一天的**任一时刻**（通常传剖面某个时次的 ISO）。
 *   内部先换算成北京日期再来找，所以传 UTC 日期的早晨时次也不会差一天。
 */
export function sunsetMs(lat: number, lon: number, utcDateIso: string): number {
  const { y, m, d } = beijingDateParts(utcDateIso)
  const base = Date.UTC(y, m, d, 8, 0, 0)
  let prev: number | null = null
  for (let k = 0; k <= 6 * 60; k++) {
    const t = base + k * 60000
    const el = sunPosition(t, lat, lon).el
    if (prev !== null && prev > -0.833 && el <= -0.833) return t
    prev = el
  }
  return NaN
}

/**
 * 北京本地日期为 D 的那一天，当地地面的日出时刻（返回 epoch ms）。
 *
 * 和 sunsetMs 是一对：那个扫「上穿 → 下穿」找日落，这个扫「下穿 → 上穿」找日出。
 * 扫描区间是**北京当天 00:00 起 14 小时**（即 UTC 前一天 16:00 → 当天 06:00），
 * 覆盖东八区全部纬度：喀什冬季日出可晚到北京 09:30 左右，14 小时窗口仍有余量；
 * 而北京 00:00 之后第一次上穿就是当天的日出，不会误取到第二天的。
 *
 * @param utcDateIso 该日出所属那一天的**任一时刻**（通常传剖面某个时次的 ISO）。
 *   ★ 内部先换算成北京日期，不直接用 ISO 里的 UTC 日期 —— 见 beijingDateParts 的说明。
 *
 * 用途：/cross 每个全国机位都有日出（朝霞）剖面。用户从「朝霞」卡片点进来时，
 * 我们得算出朝霞在东边多少度、几点，才能把话说清楚。
 */
export function sunriseMs(lat: number, lon: number, utcDateIso: string): number {
  const { y, m, d } = beijingDateParts(utcDateIso)
  /* 北京 D 日 00:00 = UTC (D−1) 16:00 */
  const base = Date.UTC(y, m, d, 0, 0, 0) - 8 * 3600 * 1000
  let prev: number | null = null
  for (let k = 0; k <= 14 * 60; k++) {
    const t = base + k * 60000
    const el = sunPosition(t, lat, lon).el
    if (prev !== null && prev < -0.833 && el >= -0.833) return t
    prev = el
  }
  return NaN
}
