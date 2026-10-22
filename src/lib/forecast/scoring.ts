import { aodBand } from '@/data/forecast/levels'
import type { Measure, Profile, RawPoint, Spot, SunPos } from '@/lib/forecast/types'
import { sunElevation } from './sun'

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

/* ---------- 评分 ---------- */

/* 高云是火烧云的“画布”。
   最佳区间 55–78%；低于 8% 基本没得烧；高于 78% 多为厚层云，反而挡光。
   注：模式对薄卷云常有漏报，所以低端做了缓坡而不是一刀切 */
export function fHigh(h: number): number {
  if (h < 8) return 0
  if (h <= 55) return (h - 8) / 47
  if (h <= 78) return 1
  return 0.25 + 0.75 * (100 - h) / 22
}

/* 低云挡地平线，越少越好 */
export function fLow(l: number): number {
  return clamp(1 - l / 82, 0, 1)
}

/* 中云适中最好，太厚会盖住 */
export function fMid(m: number): number {
  if (m <= 55) return 1
  return clamp(1 - (m - 55) / 40, 0, 1)
}

export function fAod(a: number): number {
  return aodBand(a).v
}

/* 下雨、起雾都不利 */
export function fWet(pop: number, rh: number): number {
  const p = pop < 40 ? 1 : pop < 70 ? 0.62 : 0.22
  const r = rh > 93 ? 0.5 : rh > 88 ? 0.78 : 1
  return p * r
}

/* 评分：乘法结构，任何一项差都会被放大，而不是被别的项补回来。
   再用 1.8 次方整体压缩——“条件好”不等于“一定烧”，
   误差总云量预报的 TCC 只有 0.47（1 天时效），所以必须保守。 */
export function scoreOf(m: Measure): number {
  /* 缺数据时按“最不利”处理：宁可低估，也不虚高 */
  const high = m.high == null ? 90 : m.high
  const mid = m.mid == null ? 60 : m.mid
  const low = m.low == null ? 70 : m.low
  const pop = m.pop == null ? 60 : m.pop
  const rh = m.rh == null ? 90 : m.rh

  const h = clamp(fHigh(high), 0, 1)
  if (h <= 0) return 0

  const lowF = 0.3 + 0.7 * fLow(low)
  const midF = 0.72 + 0.28 * fMid(mid)

  /* 气溶胶对色彩饱和度影响很大，权重比原来更重 */
  const aodF = 0.55 + 0.45 * fAod(m.aod ?? 0.4)

  /* 下雨/起雾基本没戏，惩罚也要更重 */
  const wetF = 0.55 + 0.45 * fWet(pop, rh)

  const raw = h * lowF * midF * aodF * wetF
  const score = 100 * Math.pow(clamp(raw, 0, 1), 1.8)

  return Math.round(Math.min(96, score))
}

/* ---------- 云底高度 ----------
   抬升凝结高度 LCL ≈ 125 × (气温 − 露点)，单位米。
   这是气象上最常用的估算式，误差在几百米量级，但足够判断“低云会不会挡住地平线”。 */
export function lclMeters(t: number | null, td: number | null): number | null {
  if (t == null || td == null) return null
  return Math.max(0, Math.round(125 * (t - td)))
}

/* ---------- 通透度 ----------
   摄影里的“水晶天 / 玻璃天”：气溶胶低、能见度高、云量少。 */
export function clarityOf(m: Measure): number {
  const aod = m.aod ?? 0.25
  const aodF = aod <= 0.12 ? 1 : aod <= 0.2 ? 0.92 : aod <= 0.3 ? 0.8 :
               aod <= 0.5 ? 0.6 : aod <= 0.8 ? 0.36 : 0.18

  const vis = m.vis
  const visF = vis == null ? 0.8 : vis >= 25 ? 1 : vis >= 15 ? 0.85 : vis >= 8 ? 0.65 : 0.4

  const total = clamp((m.high || 0) + (m.mid || 0) + (m.low || 0), 0, 100)
  const cloudF = total <= 20 ? 1 : total <= 45 ? 0.88 : total <= 70 ? 0.68 : 0.45

  const lowF = 1 - clamp((m.low || 0) / 100, 0, 1) * 0.35

  return Math.round(clamp(100 * aodF * visF * cloudF * lowF, 0, 100))
}

/* ---------- 曙暮光条（“耶稣光” / 丁达尔）----------
   条件：太阳贴近地平线（或刚落到地平线下），中高层云有缝隙，
   低云不封死地平线，空气里有一点散射颗粒但别太脏。 */
export function raysOf(m: Measure, sun: SunPos | null): number {
  if (!sun) return 0
  const el = sun.el
  let sunF = 0
  if (el >= -6 && el <= 3) sunF = 1
  else if (el > 3 && el <= 10) sunF = 0.85
  else if (el > 10 && el <= 18) sunF = 0.5
  else if (el < -6 && el >= -10) sunF = 0.45
  else sunF = 0.15

  const gapSrc = Math.max(m.mid || 0, m.high || 0)
  const gapF = gapSrc < 10 ? 0.35 : gapSrc <= 80 ? 1 : 0.4

  const lowF = 1 - clamp(((m.low || 0) - 40) / 60, 0, 1) * 0.8

  const aod = m.aod ?? 0.25
  const aodF = aod < 0.1 ? 0.7 : aod <= 0.45 ? 1 : aod <= 0.8 ? 0.6 : 0.3

  const popF = (m.pop || 0) >= 60 ? 0.5 : 1

  return Math.round(clamp(100 * sunF * gapF * lowF * aodF * popF, 0, 100))
}

/* ---------- 彩虹 ----------
   几何：太阳高度必须在 3°–42° 之间（低于 42° 才会出现）；
   天气：附近要有阵性降水，同时太阳还得能照进来；
   对流：CAPE 高说明有对流单体，比“大范围降水概率”更有意义。 */
export function rainbowOf(m: Measure, sun: SunPos | null, cape: number | null, rainNear: boolean): number {
  if (!sun) return 0
  const el = sun.el
  if (el < 3 || el > 42) return 0

  const sunF = el <= 30 ? 1 : 1 - (el - 30) / 12 * 0.8

  const rainF = rainNear ? 1 : ((m.pop || 0) >= 40 ? 0.85 : (m.pop || 0) >= 25 ? 0.55 : 0.15)
  if (!rainNear && (m.pop || 0) < 15) return 0

  const convF = cape != null && cape >= 1200 ? 1 : cape != null && cape >= 600 ? 0.8 : 0.6

  const openF = 1 - clamp((((m.low || 0) + (m.mid || 0)) - 70) / 60, 0, 1) * 0.7

  return Math.round(clamp(100 * sunF * rainF * convF * openF, 0, 100))
}

export function clarityLabel(v: number): string {
  return v >= 85 ? '水晶天' : v >= 70 ? '玻璃天' : v >= 55 ? '通透' : v >= 40 ? '一般' : '发灰'
}
export function raysLabel(v: number): string {
  return v >= 70 ? '耶稣光预备' : v >= 45 ? '可能有光柱' : v >= 25 ? '碰运气' : '难'
}
export function rainbowLabel(v: number): string {
  return v >= 60 ? '彩虹窗口' : v >= 35 ? '可能有虹' : v >= 15 ? '概率低' : '无'
}

/* 彩虹：太阳高度 4–40°，且日落前两小时内有像样的降水概率
   教程要点：虹总在太阳对面，太阳低于 42° 才可能形成 */
export function rainbowHint(
  spot: Spot,
  times: string[],
  idx: number,
  prof: Profile | null,
  popAt: (k: number) => number | null
): boolean {
  /* 对流旺盛时降水概率会被低估，CAPE 作为补充判据 */
  const convective = !!prof && typeof prof.cape === 'number' && prof.cape >= 1500

  for (let back = 2; back >= 0; back--) {
    const k = idx - back
    if (k < 0) continue

    const popK = popAt(k)
    if (!(popK != null && popK >= 30) && !convective) continue

    const ms = Date.parse(times[k] + ':00+08:00')
    if (isNaN(ms)) continue

    const el = sunElevation(ms, spot.lat, spot.lon)
    if (el >= 4 && el <= 40) return true
  }
  return false
}

/* 高空湿度剖面 → 粗判云在哪个高度
   对应教程里的「斜温图」思路：湿度饱和的层次就是云层所在
   气压层高度：850≈1500m 700≈3000m 500≈5500m 400≈7200m */
export function profileOf(pr: RawPoint | null | undefined, idx: number): Profile | null {
  if (!pr || !pr.hourly) return null

  const h = pr.hourly
  function v(name: string): number | null {
    const arr = h[name]
    if (!arr) return null
    const x = arr[idx]
    return typeof x === 'number' ? x : null
  }

  const rh850 = v('relative_humidity_850hPa')
  const rh700 = v('relative_humidity_700hPa')
  const rh500 = v('relative_humidity_500hPa')
  const rh400 = v('relative_humidity_400hPa')
  const blh = v('boundary_layer_height')
  const cape = v('cape')

  const lowWet = rh850 != null && rh850 >= 80
  const midWet = rh700 != null && rh700 >= 80
  const highWet = (rh500 != null && rh500 >= 60) || (rh400 != null && rh400 >= 60)

  let label: string
  let mod: number

  if (lowWet && highWet) {
    label = '低云封挡，高云被遮'
    mod = 0.72
  } else if (lowWet) {
    label = '低层潮湿，地平线不清'
    mod = 0.82
  } else if (highWet) {
    label = '高层有云、低层干爽'
    mod = 1.1
  } else if (midWet) {
    label = '中层有云，高层偏干'
    mod = 0.95
  } else {
    label = '各层偏干，本就不易有霞'
    mod = 0.9
  }

  /* 边界层很浅：霾和雾贴着地面，低角度视野差 */
  if (blh != null && blh < 350 && mod > 0.7) {
    label += ' · 边界层浅'
    mod *= 0.94
  }

  return { label: label, mod: mod, cape: cape }
}
