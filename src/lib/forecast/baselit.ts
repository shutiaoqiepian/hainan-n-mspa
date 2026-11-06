/* ============================================================
   云底照亮几何 —— 「中云为什么会烧」的可计算部分
   ------------------------------------------------------------
   物理事实（三段，每段都能验算）：

   ① 太阳在地平线以上时，光线是**向下**走的，先打到云顶；
      云底在云自己的阴影里，从地面看是灰的。
   ② 太阳刚落到地平线以下、但还没低过该高度的「地球阴影角」θ 时，
      光线**向上掠过地球边缘**，从下方打在云底上 —— 这才是火烧云。
   ③ 太阳再低下去，云底进地球阴影，变暗。

   所以「云底被照亮」的窗口是 |太阳高度| ≤ θ，θ = arccos(R / (R + h))：

       云底高度     θ        窗口长度
        1 km      1.02°      ≈ 4.3 分钟
        2 km      1.44°      ≈ 6.1 分钟
        3 km      1.76°      ≈ 7.5 分钟
        5 km      2.27°      ≈ 9.7 分钟
        6 km      2.49°      ≈ 10.6 分钟
       10 km      3.21°      ≈ 13.7 分钟

   ★ 这个窗口**不是**「什么时候能烧」的判据 —— 日出/日落那一刻本身
     必然落在窗口内（那一刻 |太阳高度| ≈ 0）。它真正告诉我们的是
     「这个窗口有多窄」，也就是：一个只持续 4–7 分钟的短暂现象，
     小时级的模式云量有多大把握担保它。窗口越窄 → 越不敢补分。
     这是本文件唯一进入评分的地方，而且方向是**更保守**（只会让分数更低）。

   验算方式：node tools/test-baselit.mjs
   ============================================================ */

import { sunElevation } from './sun'
import type { KindKey } from './types'

/** 地球平均半径（km）。用平均半径而不是赤道半径，是为了让 θ 对全国都取同一个保守值 */
export const EARTH_R_KM = 6371

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

/**
 * 高度 h 处的「地球阴影角」θ（度）。
 * 太阳低于地平线超过 θ 时，该高度的物体进入地球阴影。
 * h ≤ 0 返回 0（地面本身没有阴影角）。
 */
export function earthShadowAngleDeg(heightM: number): number {
  if (!Number.isFinite(heightM) || heightM <= 0) return 0
  const r = EARTH_R_KM
  const h = heightM / 1000
  const c = clamp(r / (r + h), -1, 1)
  return (Math.acos(c) * 180) / Math.PI
}

export interface BaseLitWindow {
  /** 窗口起点（ms） */
  startMs: number
  /** 窗口终点（ms） */
  endMs: number
  /** 窗口长度（分钟，四舍五入，至少 1） */
  minutes: number
  /** 该云底高度对应的地球阴影角（度） */
  shadowAngleDeg: number
}

/**
 * 某高度的云底在目标日出/日落前后「被低角度阳光从下方照亮」的时间窗口。
 *
 * 做法：从事件时刻出发，向外二分找「太阳高度 = −θ」的那一刻。
 * 不用「θ ÷ 0.235°/分」的近似，是因为那个速率随纬度和季节变化
 * （哈尔滨冬天日落时太阳几乎贴着地平线横着走，速率差一倍以上）。
 *
 * 返回 null 的情况（都必须如实报「算不出」，不能编一个窗口）：
 *   · 云底高度缺测 / ≤ 0；
 *   · 事件时刻太阳已经低于 −θ（说明传入的不是真实日出日落时刻）；
 *   · 90 分钟内太阳都没低到 −θ（极区极昼等）。
 */
export function baseLitWindow(o: {
  eventMs: number
  lat: number
  lon: number
  cloudBaseM: number | null | undefined
  kind: KindKey
}): BaseLitWindow | null {
  const theta = earthShadowAngleDeg(o.cloudBaseM ?? NaN)
  if (!(theta > 0)) return null
  if (!Number.isFinite(o.eventMs)) return null

  /* 日落 = 太阳继续下沉（向外 +t）；日出 = 倒推（向外 −t） */
  const dir = o.kind === 'sunset' ? 1 : -1
  const el = (dtMin: number): number => sunElevation(o.eventMs + dir * dtMin * 60000, o.lat, o.lon)

  if (!(el(0) > -theta)) return null

  const SPAN_MIN = 90
  if (el(SPAN_MIN) > -theta) return null

  let lo = 0
  let hi = SPAN_MIN
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (el(mid) > -theta) lo = mid
    else hi = mid
  }

  const edgeMs = o.eventMs + dir * hi * 60000
  const startMs = Math.min(o.eventMs, edgeMs)
  const endMs = Math.max(o.eventMs, edgeMs)
  return {
    startMs,
    endMs,
    minutes: Math.max(1, Math.round((endMs - startMs) / 60000)),
    shadowAngleDeg: theta
  }
}

/**
 * 窗口长度 → 置信度 0–1。
 *
 * 为什么窗口长度能当置信度用：这是**本文件唯一进入评分的地方**，
 * 而且只用来说明「小时级模式数据对这个短暂现象的担保能力」。
 *   窗口 ≥ 10 分钟 → 1.00（中云顶部 6 km 以上，容错大）
 *   窗口  7 分钟 → 0.85（典型高层云 3 km）
 *   窗口  4 分钟 → 0.70（低云底 1 km，一闪就过）
 * 下限 0.65，避免把补画布压到没有。
 */
export function litWindowFactor(minutes: number | null | undefined): number {
  if (minutes == null || !Number.isFinite(minutes)) return 0.65
  return clamp(minutes / 10, 0.65, 1)
}

/** 某时刻（给定太阳高度）该高度云底的受光程度 0–1，带 0.25° 软边。
 *  只用于解释文案与校验，不参与主评分 —— 因为事件时刻必然是 1。 */
export function baseLitFactor(elDeg: number, heightM: number): number {
  const theta = earthShadowAngleDeg(heightM)
  if (!(theta > 0)) return 0
  const a = Math.abs(elDeg)
  if (a <= theta - 0.25) return 1
  if (a >= theta + 0.25) return 0
  return (theta + 0.25 - a) / 0.5
}
