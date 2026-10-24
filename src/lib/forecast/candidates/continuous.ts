/**
 * 候选实现（**未接入生产**）：把 fAod / fWet 的分段常数改成单调连续曲线。
 * ------------------------------------------------------------
 * 为什么要改：现有实现是阶梯函数，输入跨过阈值时分母突变。
 * 实测（同一组输入只挪阈值）：
 *   降水概率 39.9 → 40.1：86 分 → 61 分（−25）
 *   相对湿度 92.9 → 93.1：71 分 → 54 分（−17）
 *   AOD 0.299 → 0.301：   82 分 → 74 分（−8）
 * 模式每次更新都会让输入小幅抖动，分数就跟着跳，用户看到的是"预报在乱变"。
 *
 * 怎么改：用单调三次插值（PCHIP，不会过冲）穿过原阶梯的"档位中心"，
 * 再乘一个**全局校准系数**，让新曲线在一批参考输入上的平均值与原阶梯一致。
 * 这样做的目的不是"更准"（没有标签，谈不上准），而是**同样的天气给同样的分**，
 * 不再因为输入抖动 0.2 个百分点而跳 20 分。
 *
 * ⚠ 这个文件不参与生产构建。要启用必须：
 *   1. 跑 `node tools/compare-candidates.mjs` 看排序变化率；
 *   2. 与基线并列展示一段时间（A/B），确认没有系统性偏移；
 *   3. 再由人决定是否替换 scoring.ts 里的 fAod / fWet。
 */

import { clamp } from '@/lib/forecast/scoring'

/* ---------- 单调三次 Hermite 插值（PCHIP） ----------
   相比普通三次样条，PCHIP 不会在档位之间冲出上下界，
   这对"因子必须落在 0–1"的约束是硬要求。 */
function pchip(xs: number[], ys: number[], x: number): number {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]

  /* 斜率 */
  const h: number[] = []
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i])
    d.push((ys[i + 1] - ys[i]) / h[i])
  }

  /* PCHIP 端点与内部斜率 */
  const m: number[] = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    }
  }

  /* 找区间 */
  let i = 0
  while (i < n - 2 && x > xs[i + 1]) i++
  const t = (x - xs[i]) / h[i]
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]
}

/* ---------- AOD ----------
   原档位（levels.ts）：
     ≤0.1 →1.00   ≤0.2 →0.97   ≤0.3 →0.92   ≤0.5 →0.80   ≤0.8 →0.55   ∞ →0.30
   前五档取几何中点做节点；最后一档额外在 0.8 处压一个 0.30 的节点，
   这样"重霾"不会被平滑成"中等透明度"——那一档是摄影上最要命的区别。 */
const AOD_X = [0.05, 0.15, 0.25, 0.4, 0.65, 0.8, 1.0]
const AOD_Y = [1.0, 0.97, 0.92, 0.8, 0.55, 0.3, 0.3]

export function fAodContinuousUncalibrated(a: number): number {
  if (!isFinite(a)) return 0.8
  return clamp(pchip(AOD_X, AOD_Y, a), 0, 1)
}

/* 参考输入：对数均匀铺 0.02–1.5，覆盖实际见到的整个范围 */
const AOD_REF: number[] = (() => {
  const out: number[] = []
  const lo = Math.log(0.02)
  const hi = Math.log(1.5)
  for (let i = 0; i <= 400; i++) out.push(Math.exp(lo + (hi - lo) * i / 400))
  return out
})()

/** 原阶梯在参考输入上的均值 */
function bandMeanAod(): number {
  const v = AOD_REF.map((a) =>
    a <= 0.1 ? 1.0 : a <= 0.2 ? 0.97 : a <= 0.3 ? 0.92 : a <= 0.5 ? 0.8 : a <= 0.8 ? 0.55 : 0.3)
  return v.reduce((s, x) => s + x, 0) / v.length
}

/** 校准系数：让连续曲线与原阶梯**同均值**，避免整体分数平移 */
export const K_AOD: number =
  bandMeanAod() / (AOD_REF.map(fAodContinuousUncalibrated).reduce((s, x) => s + x, 0) / AOD_REF.length)

export function fAodContinuous(a: number): number {
  return clamp(fAodContinuousUncalibrated(a) * K_AOD, 0, 1)
}

/* ---------- 降水概率 ----------
   原档位：<40 →1   [40,70) →0.62   ≥70 →0.22
   插入两个"过渡节点"，把突变摊开成一段斜坡 */
const POP_X = [0, 40, 55, 70, 85, 100]
const POP_Y = [1, 0.95, 0.62, 0.30, 0.22, 0.22]

/* ---------- 相对湿度 ----------
   原档位：≤88 →1   (88,93] →0.78   >93 →0.5 */
const RH_X = [50, 88, 90.5, 93, 96, 100]
const RH_Y = [1, 1, 0.9, 0.78, 0.6, 0.5]

function popCurve(pop: number): number {
  return clamp(pchip(POP_X, POP_Y, clamp(pop, 0, 100)), 0, 1)
}
function rhCurve(rh: number): number {
  return clamp(pchip(RH_X, RH_Y, clamp(rh, 0, 100)), 0, 1)
}

/** 原阶梯（与 scoring.ts 的 fWet 完全一致，用于校准比对） */
function popStep(pop: number): number {
  return pop < 40 ? 1 : pop < 70 ? 0.62 : 0.22
}
function rhStep(rh: number): number {
  return rh > 93 ? 0.5 : rh > 88 ? 0.78 : 1
}

const POP_REF = Array.from({ length: 101 }, (_, i) => i)          // 0–100
const RH_REF = Array.from({ length: 51 }, (_, i) => 50 + i)       // 50–100

export const K_POP: number =
  (POP_REF.map(popStep).reduce((s, x) => s + x, 0) / POP_REF.length) /
  (POP_REF.map(popCurve).reduce((s, x) => s + x, 0) / POP_REF.length)

export const K_RH: number =
  (RH_REF.map(rhStep).reduce((s, x) => s + x, 0) / RH_REF.length) /
  (RH_REF.map(rhCurve).reduce((s, x) => s + x, 0) / RH_REF.length)

export function fWetContinuous(pop: number, rh: number): number {
  return clamp(popCurve(pop) * K_POP, 0, 1) * clamp(rhCurve(rh) * K_RH, 0, 1)
}

/* ---------- 候选评分（与 scoreOf 只差 fAod / fWet 两个因子） ---------- */
export interface MeasureLike {
  high: number | null
  mid: number | null
  low: number | null
  rh: number | null
  pop: number | null
  aod: number
}

function fHigh(h: number): number {
  if (h < 8) return 0
  if (h <= 55) return (h - 8) / 47
  if (h <= 78) return 1
  return 0.25 + 0.75 * (100 - h) / 22
}
function fLow(l: number): number {
  return clamp(1 - l / 82, 0, 1)
}
function fMid(m: number): number {
  return m <= 55 ? 1 : clamp(1 - (m - 55) / 40, 0, 1)
}

/** 连续版评分：除 AOD 与降水/湿度外，其余与生产版逐字一致 */
export function scoreOfContinuous(m: MeasureLike): number {
  const high = m.high == null ? 90 : m.high
  const mid = m.mid == null ? 60 : m.mid
  const low = m.low == null ? 70 : m.low
  const pop = m.pop == null ? 60 : m.pop
  const rh = m.rh == null ? 90 : m.rh

  const h = clamp(fHigh(high), 0, 1)
  if (h <= 0) return 0

  const lowF = 0.3 + 0.7 * fLow(low)
  const midF = 0.72 + 0.28 * fMid(mid)
  const aodF = 0.55 + 0.45 * fAodContinuous(m.aod)
  const wetF = 0.55 + 0.45 * fWetContinuous(pop, rh)

  const raw = h * lowF * midF * aodF * wetF
  return Math.round(Math.min(96, 100 * Math.pow(clamp(raw, 0, 1), 1.8)))
}

/** 阶梯版（仅用于对照，和生产实现一致） */
export function scoreOfStep(m: MeasureLike): number {
  const high = m.high == null ? 90 : m.high
  const mid = m.mid == null ? 60 : m.mid
  const low = m.low == null ? 70 : m.low
  const pop = m.pop == null ? 60 : m.pop
  const rh = m.rh == null ? 90 : m.rh

  const h = clamp(fHigh(high), 0, 1)
  if (h <= 0) return 0

  const lowF = 0.3 + 0.7 * fLow(low)
  const midF = 0.72 + 0.28 * fMid(mid)
  const aodStep = (a: number) =>
    a <= 0.1 ? 1.0 : a <= 0.2 ? 0.97 : a <= 0.3 ? 0.92 : a <= 0.5 ? 0.8 : a <= 0.8 ? 0.55 : 0.3
  const aodF = 0.55 + 0.45 * aodStep(m.aod)
  const wetF = 0.55 + 0.45 * (popStep(pop) * rhStep(rh))

  const raw = h * lowF * midF * aodF * wetF
  return Math.round(Math.min(96, 100 * Math.pow(clamp(raw, 0, 1), 1.8)))
}
