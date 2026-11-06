/**
 * 影子分数 scoreShadow —— 只评估用，**不改 scoreOf()、不影响页面显示**。
 *
 * 为什么要有它：
 *   `scoreOf()` 是线上评分，按硬约束不许随便改。但「修正预测效果」总得先有依据。
 *   所以另立一个独立函数：同输入、不同的物理处理，产出的分数存进每日快照，
 *   30 天后用 METAR A 级样本直接比「谁误报少」。**验证通过才谈进公式。**
 *
 * 设计原则（踩过的坑）：**影子分数不允许比线上更容易报"能烧"**。
 *   首版实测 275 条 A 级样本后误报从 7 涨到 19 —— 原因是所有修正都是纯乘法，
 *   对"正好卡在 45–47 分"的样本，任何一个 >1 的系数都能把它推过 48 的误报阈值。
 *   现在的规则：把三个系数里 ≤1 的（扣分方向）全部乘上，>1 的（加分方向）
 *   **先打折成 (1 + 0.5×(f−1))**，并且整体再加一道「不得高于基线」的封顶。
 *   宁可少加分，也不许凭空制造误报。
 *
 * 与 scoreOf 的差异只有三处（每一处都能单独开关，便于归因）：
 *   ① 垂直连续云（cloudContinuity）：scoreOf 用的是 Open-Meteo 聚合的
 *      高/中/低三层云量；这里用 9 层气压云量里**高云连续层**的厚度来判断
 *      「薄卷云」还是「厚层云」。厚层云挡光，薄层云才是好画布。
 *   ② 地形遮挡（terrainBlock）：scoreOf 的 horizonBlock 只看太阳方向的
 *      低/中云（云），完全不看山。这里用 DEM 视线角判断太阳是否被地形挡住。
 *   ③ 降水强度（precipRelief）：scoreOf 只看降水概率 pop；
 *      这里用**实际降水量**判断「雨已停」，给一点点回补（上限与 scoreOf 的 rainRelief 同量级）。
 *
 * 诚实边界（这份文件里不许有虚构）：
 *   · 输入缺测就不启用对应修正，绝不替用户"猜"一个更好的分数；
 *   · 地形 0–9 层云量只在 ECMWF 剖面上有，GFS/多模式平均里没有；
 *   · 本项目尚未有足够样本证明影子分数更准 —— 在 `tools/score-shadow.mjs` 出对照结论前，
 *     它**只出现在快照里，不出现在任何页面**。
 */
import { clamp, scoreOfAt } from './scoring'
import type { Measure } from './types'

/** 一层气压云量（0–100）与它的高度（m） */
export interface LevelCloud {
  hPa: number
  coverPct: number | null
  heightM: number | null
}

export interface ShadowInput {
  /** 与 scoreOf 相同的观测集合 */
  m: Measure
  sunEl?: number
  /** 9 层气压云量（来自剖面请求）；没有就不启用 ① */
  levels?: LevelCloud[] | null
  /** 太阳方向最高地形仰角（°，来自 data/cross/context.json）；null = 没数据 */
  terrainHorizonDeg?: number | null
  /** 太阳是否在视线以下（由调用方按 DEM 算好） */
  terrainBlocks?: boolean | null
  /** 与线上一致的 AOD 参考光程（快照里的 aodRefMass / aodRefEl） */
  aodRefEl?: number | null
  aodRefMass?: number | null
  /** 与线上一致的地平线遮挡系数 */
  horizonBlock?: number | null
  /** 与线上一致的雨停回补系数 */
  rainRelief?: number | null
  /** 该小时降水量（mm） */
  precipMm?: number | null
  /**
   * 中云画布抬升量 0–1（2026-11-06 新增，见 midcloud.ts）。
   * 它进的是**线上第一层**的分数，所以影子分数的基线必须同样带上它，
   * 否则「线上第一层有中云救援、影子基线没有」—— 两边口径又不一致，
   * 会重演首版「拿裸分当基线」那个坑。
   * 老快照没有这个字段 → 传 null，等于不启用（与当时的线上口径一致）。
   */
  midLift?: number | null
  /** 前 3 小时累计降水量（mm）；没有就只用当前小时 */
  precipPrev3hMm?: number | null
}

export interface ShadowResult {
  /** 影子分数 0–96（与 scoreOf 同一值域，便于直接比较） */
  score: number
  /** 基线（= 线上 scoreOfAt 的结果），便于逐条差份 */
  base: number
  /** 各修正项的系数与是否真的生效（1 = 未启用/无影响） */
  factors: {
    continuity: number
    continuityOn: boolean
    terrain: number
    terrainOn: boolean
    precip: number
    precipOn: boolean
  }
  /** 说明文字（进快照，便于事后解释某一条为什么变了） */
  notes: string[]
}

/**
 * ① 垂直连续高云：找出 500 hPa 及以上（>≈5.5 km）里连续有云的层，
 *    用「连续层数 × 层厚」近似云厚。
 *    薄卷云（1 层、云量不高）→ 好画布，轻微加分；
 *    厚层云（≥3 层连续且有层接近满云）→ 挡光，扣分。
 *    没有任何高云 → 不加不减（这一点交给 scoreOf 的 fHigh 去处理，避免双重计算）。
 */
export function continuityFactor(levels: LevelCloud[] | null | undefined): { f: number; on: boolean; note: string } {
  if (!levels || !levels.length) return { f: 1, on: false, note: '无 9 层云量' }
  const highSet = levels.filter((l) => l.hPa <= 500 && l.coverPct != null && l.heightM != null)
  if (!highSet.length) return { f: 1, on: false, note: '高层云量缺测' }

  /* 按高度从高到低排，找「连续有云」（≥20% 视为有云）的最大连续段 */
  const sorted = [...highSet].sort((a, b) => (b.heightM as number) - (a.heightM as number))
  let run = 0
  let best = 0
  let bestLayers: LevelCloud[] = []
  let cur: LevelCloud[] = []
  for (const l of sorted) {
    if ((l.coverPct as number) >= 20) {
      cur.push(l)
      run++
      if (run > best) { best = run; bestLayers = [...cur] }
    } else {
      run = 0
      cur = []
    }
  }
  if (!best) return { f: 1, on: true, note: '高层没有 ≥20% 的连续云' }

  /* 云厚近似：首尾层高度差（单层时按 600 m 计，约一个模式层距） */
  const top = bestLayers[0].heightM as number
  const bottom = bestLayers[bestLayers.length - 1].heightM as number
  const thickM = best >= 2 ? top - bottom : 600
  const maxCover = Math.max(...bestLayers.map((l) => l.coverPct as number))

  let f = 1
  if (best >= 3 && maxCover >= 75) f = 0.88          /* 厚且密：挡光 */
  else if (thickM >= 4000 && maxCover >= 60) f = 0.92
  else if (best <= 2 && maxCover < 55) f = 1.06      /* 薄卷云：好画布，轻微加分 */
  return {
    f,
    on: true,
    note: `高云连续 ${best} 层（≥20%），厚度≈${Math.round(thickM / 100) / 10} km，最大覆盖 ${Math.round(maxCover)}% → ×${f}`
  }
}

/**
 * ② 地形遮挡：太阳方向的地形仰角高于太阳高度角 → 光路被山挡住。
 *    只在确有用数据时生效（没有 DEM 就给 1，并标注）。
 */
export function terrainFactor(blocks: boolean | null | undefined): { f: number; on: boolean; note: string } {
  if (blocks == null) return { f: 1, on: false, note: '无 DEM 数据' }
  return blocks
    ? { f: 0.55, on: true, note: '太阳低于地形视线 → ×0.55' }
    : { f: 1, on: true, note: '太阳高于地形视线' }
}

/**
 * ③ 降水强度：只看"现在还在不在下"，不看概率。
 *    过去 3 小时累计 >1 mm 且当前小时 <0.2 mm → 雨已停，回补一点点（×1.03，与 scoreOf 的 rainRelief 同量级）。
 *    当前小时明显在下（>1 mm）→ 额外再压一点（scoreOf 用 pop 已经压过，这里只在强度明显时补一手）。
 */
export function precipFactor(
  nowMm: number | null | undefined,
  prev3hMm: number | null | undefined
): { f: number; on: boolean; note: string } {
  if (nowMm == null && prev3hMm == null) return { f: 1, on: false, note: '无降水量数据' }
  const now = nowMm ?? null
  const prev = prev3hMm ?? null
  if (now != null && now >= 1) return { f: 0.85, on: true, note: `当前小时降水 ${now.toFixed(1)} mm → ×0.85` }
  if (prev != null && prev >= 1 && (now == null || now < 0.2)) {
    return { f: 1.03, on: true, note: `过去 3 小时降水 ${prev.toFixed(1)} mm、当前已停 → ×1.03` }
  }
  return { f: 1, on: true, note: '无有效降水' }
}

/**
 * 影子分数。**不写回任何地方**，由调用方决定是否存快照。
 * 结构与 scoreOf 一致：先算基线，再乘三个修正，最后 clamp 到 0–96。
 */
export function scoreShadow(input: ShadowInput): ShadowResult {
  /* 基线必须与线上"完全同一口径"：把 snapshot 里已有的 rawScore + 修正项原样传回，
     否则影子分数会拿一个"没加地形/横程/雨停修正"的裸分当基线 ——
     首版就是因为这一点，把线上 7 个误报涨成了 19 个。 */
  const base = scoreOfAt(input.m, {
    sunEl: input.sunEl,
    aodRefEl: input.aodRefEl,
    aodRefMass: input.aodRefMass,
    horizonBlock: input.horizonBlock,
    rainRelief: input.rainRelief,
    midLift: input.midLift ?? null
  })
  const c = continuityFactor(input.levels)
  const t = terrainFactor(input.terrainBlocks)
  const p = precipFactor(input.precipMm, input.precipPrev3hMm)

  /* 加分方向一律打折：乘数 >1 时改成 1 + 0.5×(f−1)，避免把一个"差一点就报能烧"的样本推过线 */
  const damp = (f: number): number => (f <= 1 ? f : 1 + 0.5 * (f - 1))
  const factor = damp(c.f) * damp(t.f) * damp(p.f)

  /* 基线为 0 就不要靠乘法修正"修出"分数：火烧云的前提是高云本身有戏 */
  const adjusted = base === 0 ? 0 : clamp(base * factor, 0, Math.min(base, 96))
  return {
    score: Math.round(adjusted),
    base,
    factors: {
      continuity: damp(c.f), continuityOn: c.on,
      terrain: damp(t.f), terrainOn: t.on,
      precip: damp(p.f), precipOn: p.on
    },
    notes: [c.note, t.note, p.note]
  }
}
