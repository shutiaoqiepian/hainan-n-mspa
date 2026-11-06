/* ============================================================
   中云能不能当画布 —— C 方案（云种三分类）的落地
   ------------------------------------------------------------
   背景：原来的评分里，高云是唯一的「画布」（fHigh），而 fHigh 在
   高云 < 8% 时直接返回 0 → **整条分数归零**，中云再多也救不回来。
   实测（data/forecast 全部省份 × 全部时次，2026-11-05）：
     16 128 个样本里有 2 813 个（17.4%）是「高云 < 8% 且中云 ≥ 25%」，
     这些样本原来一律 0 分，其中相当一部分其实是能烧的透光高积云。

   物理依据（WMO 国际云图 + 本仓库 docs/中云调研）：
     · 中云 2–6 km（热带云顶可到 8 km），云底被低角度阳光**从下方**照亮；
     · 透光高积云 / 透光高层云（translucidus）—— 光能透过去，是好画布；
     · 蔽光高积云 / 厚高层云（opacus）—— 太阳被挡在云后，只出暗红，几乎不能当画布；
     · 雨层云（nimbostratus）—— 连续降水、整片压暗，0。

   ★ 关键取舍：**云量不用 9 层气压剖面，用多模式聚合的那个值。**
     实测 2026-11-05：Open-Meteo 的聚合 `cloud_cover_mid` 报 100% 时，
     同一时次 700/600/500 hPa 的逐层云量只有 38/32/0% —— 逐层值系统性地低得多
     （这正是仓库里那个「挂起决定 · profile-data-source」要解决的问题）。
     拿逐层云量当云量会大面积漏掉中云，所以：
       云量    ← 聚合值（多模式平均）
       厚薄    ← 700/600/500 hPa 的**相对湿度**做代理（湿度饱和 = 云厚不透光）
     这个分工是有意的，不是随手取。

   ★ B 方案的保守思维（用户 2026-11-05 拍板「加入一定 b 的保守思维」）：
     ① 只在高云画布不够时补，绝不把已经很好的高云拉差 → 数学上只增不减；
     ② 中云量按 α = 0.8 折算，不是 1:1 加成；
     ③ 补到甜区顶点 78% 就封顶（>78% 的「太厚挡光」语义只对高云自身成立，
        合成画布不适用，硬套会把好天扣下去）；
     ④ 中云 < 25% 一律不补（漏报优于误报）；
     ⑤ 窗口越窄补得越少（见 baselit.ts 的 litWindowFactor）。

   验算方式：node tools/test-midcloud.mjs
   ============================================================ */

import { baseLitWindow, litWindowFactor, type BaseLitWindow } from './baselit'
import type { KindKey } from './types'

/** 中云的三个探测层（hPa）。中云 2–6 km ≈ 800–500 hPa */
export const MID_RH_LEVELS = [700, 600, 500] as const

/** 补画布的保守参数（改这里的任何一个都必须重跑 tools/ab-midcloud.mjs 看影响面） */
export const MID_CANVAS = {
  /** 中云折算成「画布抬升」的折扣（B 方案的保守思维）。
   *  0.6 是实测选的：tools/ab-midcloud.mjs 扫 0.4/0.6/0.8 三个值，
   *  0.8 的全站平均上浮 +1.12 分、单条最大 +39，超出硬约束 2 的门槛；
   *  0.6 平均 +0.75、最大 +26，而且救起的 123 条全部是原来 0 分的漏报。 */
  alpha: 0.6,
  /** 低于这个中云量不补 */
  minCover: 25,
  /** 中云量到这里算「铺满天空」，再往上不额外加成 */
  fullCover: 55
} as const

export type MidOpacityKey =
  | 'clear' /* 中云太少，不参与 */
  | 'Ac-trans' /* 透光高积云 */
  | 'Ac' /* 高积云（未细分） */
  | 'As-trans' /* 透光高层云 */
  | 'As-opacus' /* 厚高层云 */
  | 'Ns' /* 雨层云 */

export interface MidOpacity {
  key: MidOpacityKey
  /** 界面用云种名 */
  label: string
  /** 透光系数 0–1：中云里有几成能当「被照亮的画布」。0 = 完全挡光 */
  translucency: number
  /** 判据一句话（直接显示给用户） */
  why: string
}

export interface MidOpacityInput {
  /** 多模式平均的中云量 %（缺测传 null） */
  mid: number | null
  /** 700/600/500 hPa 里**最大**的相对湿度 %；缺测传 null。
   *  取最大值是有意的保守选择：只要有一层饱和，就按厚云处理。 */
  rhMid: number | null
  /** 该小时降水量 mm（不是概率）；缺测传 null */
  precipMm?: number | null
  /** 降水概率 % */
  pop?: number | null
}

/**
 * 中云「挡不挡光」的分类。
 * 阈值不是拍脑袋：RH ≥ 92% 在气压层上意味着接近饱和、云体厚实不透明，
 * 这是气象上判「透光 / 蔽光」最常用的替代指标（没有云光学厚度时的标准做法）。
 * 每一档都往**不透明**方向取整 —— 宁可少补，不可多补。
 */
export function midOpacityOf(i: MidOpacityInput): MidOpacity {
  const mid = typeof i.mid === 'number' && Number.isFinite(i.mid) ? i.mid : null
  const pop = typeof i.pop === 'number' && Number.isFinite(i.pop) ? i.pop : null
  const precip = typeof i.precipMm === 'number' && Number.isFinite(i.precipMm) ? i.precipMm : null
  const rh = typeof i.rhMid === 'number' && Number.isFinite(i.rhMid) ? i.rhMid : null

  if (mid == null || mid < MID_CANVAS.minCover) {
    return {
      key: 'clear',
      label: '中云偏少',
      translucency: 0,
      why: mid == null
        ? '中云量缺测，不参与画布判断'
        : '中云只有 ' + Math.round(mid) + '%，不到 ' + MID_CANVAS.minCover + '% 的门槛，不补画布'
    }
  }

  /* ① 雨层云：真的在下雨，或降水概率很高 + 中云铺满 → 整片压暗，0 */
  if (precip != null && precip >= 0.5) {
    return {
      key: 'Ns',
      label: '雨层云',
      translucency: 0,
      why: '该小时实测降水 ' + precip.toFixed(1) + ' mm，雨层云会把整片天压暗，基本无霞'
    }
  }
  if (pop != null && pop >= 80 && mid >= 80) {
    return {
      key: 'Ns',
      label: '雨层云（按降水概率判）',
      translucency: 0.1,
      why: '降水概率 ' + Math.round(pop) + '%、中云 ' + Math.round(mid) + '%，大概率是雨层云，几乎不透光'
    }
  }

  /* ② 没有湿度剖面 → 只能按云量保守估（云越多越可能连成厚幕） */
  if (rh == null) {
    if (mid >= 85) {
      return {
        key: 'As-opacus',
        label: '中云（无湿度剖面，偏厚）',
        translucency: 0.15,
        why: '中云 ' + Math.round(mid) + '%、缺少 700–500 hPa 湿度剖面，按偏厚保守估'
      }
    }
    if (mid >= 70) {
      return {
        key: 'As-opacus',
        label: '中云（无湿度剖面）',
        translucency: 0.3,
        why: '中云 ' + Math.round(mid) + '%、缺少湿度剖面，按「可能偏厚」保守估'
      }
    }
    return {
      key: 'Ac',
      label: '中云（无湿度剖面）',
      translucency: 0.5,
      why: '中云 ' + Math.round(mid) + '%、缺少湿度剖面，只按一半折算'
    }
  }

  /* ③ 有湿度剖面：湿度越高 → 云越厚 → 越不透明 */
  if (rh >= 92) {
    return {
      key: 'As-opacus',
      label: '厚高层云',
      translucency: 0.15,
      why: '700–500 hPa 最高湿度 ' + Math.round(rh) + '%（接近饱和），云体厚、太阳多半被挡在后面'
    }
  }
  if (rh >= 85) {
    return {
      key: 'As-opacus',
      label: '高层云（偏厚）',
      translucency: 0.35,
      why: '700–500 hPa 最高湿度 ' + Math.round(rh) + '%，云层较厚，只能透出低饱和的暗霞'
    }
  }
  if (rh >= 76) {
    return {
      key: 'As-trans',
      label: '透光高层云',
      translucency: 0.55,
      why: '700–500 hPa 最高湿度 ' + Math.round(rh) + '%，薄幕状，能整片被点亮但容易糊成一片'
    }
  }
  if (rh >= 66) {
    return {
      key: 'Ac-trans',
      label: '透光高积云',
      translucency: 0.75,
      why: '700–500 hPa 最高湿度 ' + Math.round(rh) + '%，块状薄云，云底容易被夕阳点成金边'
    }
  }
  return {
    key: 'Ac',
    label: '高积云',
    translucency: 0.85,
    why: '700–500 hPa 最高湿度 ' + Math.round(rh) + '%，云层薄、透光好'
  }
}

/** 某小时的中云判据输入。云量来自多模式平均，湿度/降水来自 ECMWF 剖面。 */
export interface MidHourSample {
  mid: number | null
  rhMid: number | null
  precipMm: number | null
  pop: number | null
}

export interface MidEvaluation {
  opacity: MidOpacity
  /**
   * 画布抬升量 0–1（0 = 不补）。
   *
   * ★ 这里返回「抬升量」而不是「加几个百分点的云量」，是有意的：
   *   高云画布走 fHigh 那条曲线（8–55% 陡坡、55–78% 平台）。若把中云直接加进
   *   云量再走 fHigh，一旦跨过 55% 平台就跳一个台阶 —— 首版实测最大一次 +61 分
   *   （10 → 71），对预报来说太猛。改成「向 1 靠拢」：
   *       h' = h + (1 − h) × lift
   *   ① 平滑、单调、永远不超过 1；
   *   ② 高云本来就好时抬不动（1 − h 已经很小）；
   *   ③ 抬幅上界就是 lift ≤ α = 0.8，不会凭空造出大烧。
   */
  lift: number
}

export interface MidCanvasPlan {
  /** 云底被照亮的窗口；null = 算不出（云底缺测 / 极区），界面必须显示「数据不足」 */
  window: BaseLitWindow | null
  /** 窗口长度折算的置信度 0.65–1 */
  litFactor: number
  /** 某小时的中云分类 + 画布抬升量 */
  evaluate(sample: MidHourSample): MidEvaluation
}

/**
 * 一个机位在一个日出/日落时次的「中云补画布」计划。
 *
 * 窗口（只看几何：事件时刻 + 纬度 + 云底高度）只算一次；
 * 逐小时的分类和抬升量由 `evaluate` 算。
 *
 * ★ 为什么窗口不直接拿来"卡"每个小时：云底照亮窗口只有 4–11 分钟，
 *   而模式数据是逐小时的 —— 拿窗口去卡的话，窗口内三个小时没有一小时落在其中，
 *   中云会被一律判成"没光"。所以窗口在这里只折算成**置信度**
 *   （窗口越窄，小时级数据越担保不了这个短暂现象 → 补得越少），
 *   方向只会让分数更低，符合"宁可漏报"。
 */
export function midCanvasPlan(o: {
  eventMs: number
  lat: number
  lon: number
  kind: KindKey
  /** 中云云底高度（m）；缺测传 null */
  midBaseM: number | null
}): MidCanvasPlan {
  const window = baseLitWindow({
    eventMs: o.eventMs,
    lat: o.lat,
    lon: o.lon,
    cloudBaseM: o.midBaseM,
    kind: o.kind
  })
  const litFactor = litWindowFactor(window ? window.minutes : null)
  return {
    window,
    litFactor,
    evaluate(sample: MidHourSample): MidEvaluation {
      const opacity = midOpacityOf(sample)
      const mid = sample.mid
      if (mid == null || !Number.isFinite(mid) || mid < MID_CANVAS.minCover || !(opacity.translucency > 0)) {
        return { opacity, lift: 0 }
      }
      /* 云量越接近铺满，抬升越接近名义值；到 fullCover 就封顶，不再额外加成 */
      const coverWeight = Math.min(1, mid / MID_CANVAS.fullCover)
      const lift = MID_CANVAS.alpha * opacity.translucency * litFactor * coverWeight
      return { opacity, lift: Math.min(0.8, Math.max(0, lift)) }
    }
  }
}
