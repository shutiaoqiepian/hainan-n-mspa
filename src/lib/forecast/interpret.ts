/* ============================================================
   自动气象解读
   ------------------------------------------------------------
   参考 SunsetBot「详细预报」的写法：不只给一个分数，还要说清
   「为什么是这个分、哪一项在加分、哪一项在拖后腿」。
   全部由规则拼出，没有新的数据假设；数字都说清单位。
   ============================================================ */

import { aodBand } from '@/data/forecast/levels'
import type { CloudLayer, Interpretation, KindKey, Measure, SunPos } from './types'
import { clamp, fAod, fHigh, fLow, fWet } from './scoring'

export interface InterpretInput {
  kind: KindKey
  score: number
  levelName: string
  m: Measure
  sun: SunPos | null
  spread: number
  faceOff: boolean
  face: string
  cloudBaseLow: number | null
  layers: CloudLayer[]
  cape: number | null
  day: number
  /** 旧口径的云层结构判断（profileOf 的结论），可选：有就写进解读 */
  profileLabel?: string
  profileMod?: number
}

const pct = (v: number | null): string => Math.round(v ?? 0) + '%'

export function interpret(i: InterpretInput): Interpretation {
  const pros: string[] = []
  const cons: string[] = []
  const m = i.m
  const high = m.high ?? 0
  const mid = m.mid ?? 0
  const low = m.low ?? 0
  const aod = m.aod ?? 0.25
  const pop = m.pop ?? 0
  const ell = i.sun?.el ?? null

  /* ---- 高云：画布 ---- */
  if (high < 8) {
    cons.push('高云只有 ' + pct(high) + '，天上没有“画布”，太阳再低也烧不起来')
  } else if (high < 30) {
    pros.push('高云 ' + pct(high) + '，云量偏少但够薄，能烧出一角亮色')
  } else if (high <= 78) {
    pros.push('高云 ' + pct(high) + '，落在 40–80% 的理想区间，是火烧云最标准的画布')
  } else if (high <= 92) {
    cons.push('高云 ' + pct(high) + ' 偏多，容易糊成一整片，只剩边缘能烧')
  } else {
    cons.push('高云接近满云（' + pct(high) + '），太阳光被挡在外面')
  }

  /* ---- 低云：挡不挡地平线 ---- */
  if (low <= 15) {
    pros.push('低云只有 ' + pct(low) + '，地平线干净，能看到太阳完整落到海面')
  } else if (low <= 30) {
    pros.push('低云 ' + pct(low) + '，不挡太阳路径，只是地平线略毛')
  } else if (low <= 60) {
    cons.push('低云 ' + pct(low) + '，太阳有可能提前没入低云，要多留 10 分钟余量')
  } else {
    cons.push('低云 ' + pct(low) + '，太阳大概率还没落到海面就被云压住')
  }

  /* ---- 中云：厚不厚 ---- */
  if (mid > 70) {
    cons.push('中云 ' + pct(mid) + ' 偏厚，会挡住从云缝里洒下来的光')
  } else if (mid >= 35) {
    pros.push('中云 ' + pct(mid) + '，能形成块状结构，容易出金边和被切碎的光')
  }

  /* ---- 通透度 ---- */
  const band = aodBand(aod)
  if (aod <= 0.15) {
    pros.push('AOD ' + aod.toFixed(2) + '（' + band.name + '），空气很透，颜色不会被霾吃掉')
  } else if (aod <= 0.3) {
    pros.push('AOD ' + aod.toFixed(2) + '（' + band.name + '），通透度够用，颜色是正常的橙红')
  } else if (aod <= 0.5) {
    cons.push('AOD ' + aod.toFixed(2) + '（' + band.name + '），颜色会发浑、饱和度上不去')
  } else {
    cons.push('AOD ' + aod.toFixed(2) + '（' + band.name + '），大概率是“污烧”，实际观感比数值差')
  }

  /* ---- 降水 / 湿度 ---- */
  if (pop >= 70) {
    cons.push('降水概率 ' + pct(pop) + '，云底又厚又乱，很可能整片压住太阳')
  } else if (pop >= 40) {
    cons.push('降水概率 ' + pct(pop) + '，要防阵雨把机位浇了，也可能换来雨后的通透霞')
  } else if (pop >= 25 && (i.cape ?? 0) >= 900) {
    pros.push('有 ' + pct(pop) + ' 的阵性降水且对流旺盛（CAPE ' + Math.round(i.cape ?? 0) + ' J/kg），雨后常出一波猛霞')
  }

  const rh = m.rh
  if (rh != null && rh >= 93) {
    cons.push('2 米湿度 ' + pct(rh) + '，接近饱和，容易起雾把地平线糊掉')
  }

  /* ---- 云底高度 ---- */
  if (i.cloudBaseLow != null && i.cloudBaseLow < 400) {
    cons.push('低云云底只有约 ' + i.cloudBaseLow + ' 米，雾感重，远处海面会糊成一片')
  }

  /* ---- 能见度 ---- */
  if (m.vis != null && m.vis < 8) {
    cons.push('能见度 ' + Math.round(m.vis) + ' km 偏低，远景和地平线会发灰')
  }

  /* ---- 模式分歧 ---- */
  if (i.spread >= 18) {
    cons.push('模式分歧 ±' + i.spread + ' 分，这次数值本身不太可信，出发前最好再看一眼实时云图')
  }

  /* ---- 朝向 ---- */
  if (i.faceOff) {
    cons.push('机位朝' + i.face + '，与此刻太阳方位对不上，太阳可能不在画面里')
  }

  /* ---- 云种补充 ---- */
  const gen = genusPhrase(i.layers)
  if (gen) pros.push(gen)

  /* ---- 云层垂直结构（旧口径里最容易被忽略的一项）---- */
  if (i.profileMod != null && i.profileMod < 0.92 && i.profileLabel) {
    cons.push('云层结构不利于出霞：' + i.profileLabel + '（该项系数 ' + i.profileMod.toFixed(2) + '）')
  }

  /* ---- 时效 ---- */
  if (i.day === 1) {
    cons.push('这是明天的预报，时效越长越不准，分数已按 0.95 折过一次')
  }

  /* ---- 找主导因子：分数是乘法，最弱的一项决定结果 ----
     这样解读能解释“明明高云 53% 为什么还是低分”。 */
  const factors: Array<{ name: string; v: number; say: string }> = [
    { name: '高云画布', v: Math.max(0.05, fHigh(high)), say: '高云 ' + pct(high) + '，' + (high < 30 ? '面积不够' : '够铺开') },
    { name: '低云遮挡', v: 0.3 + 0.7 * fLow(low),
      say: '低云 ' + pct(low) + (low <= 15 ? '，地平线干净' : low <= 30 ? '，略毛但还行' : low <= 55 ? '，开始压住地平线' : '，明显压住地平线') },
    { name: '通透度', v: 0.55 + 0.45 * fAod(aod), say: 'AOD ' + aod.toFixed(2) + '（' + band.name + '）' },
    { name: '降水湿度', v: 0.55 + 0.45 * fWet(pop, rh ?? 80), say: '降水 ' + pct(pop) + '、湿度 ' + pct(rh) }
  ]
  if (i.profileMod != null) {
    factors.push({ name: '云层结构', v: i.profileMod, say: i.profileLabel ?? '云层结构' })
  }
  factors.sort((a, b) => a.v - b.v)
  const weakest = factors[0]
  const strongest = factors[factors.length - 1]

  /* ---- 结论 ---- */
  let headline: string
  if (i.score >= 82) {
    headline = '条件到顶了：' + strongest.say + '，各项都不拖后腿，值得专程跑一趟'
  } else if (i.score >= 66) {
    headline = '可以跑：' + strongest.say + '；最弱的是' + weakest.name + '（' + weakest.say + '，系数 ' + weakest.v.toFixed(2) + '）'
  } else if (i.score >= 48) {
    headline = '就近可以去：' + weakest.name + '是主要短板（' + weakest.say + '，系数 ' + weakest.v.toFixed(2) + '），重点赌云缝'
  } else {
    headline = '不太值得专门跑：几项相乘后只剩 ' + i.score + ' 分，最弱的是' + weakest.name + '（' + weakest.say + '，系数 ' + weakest.v.toFixed(2) + '）'
  }

  /* ---- 出发建议 ---- */
  const advice = adviceOf(i, low, pop, ell)

  return {
    headline,
    pros: pros.slice(0, 5),
    cons: cons.slice(0, 5),
    advice
  }
}

function stripPrefix(s: string): string {
  /* 去掉“高云 8%，天上没……”里的重复主语感，保持句子顺 */
  return s.replace(/^([^，,]{1,14})[，,]/, '$1，')
}

function genusPhrase(layers: CloudLayer[]): string {
  if (!layers.length) return ''
  const hi = layers.filter((l) => l.height >= 6000 && l.code !== '--').pop()
  if (!hi) return ''
  if (hi.code === 'Ci') return '高空是卷云（丝缕状），落日会把它们一根根点成金线'
  if (hi.code === 'Cc') return '高空是卷积云（鱼鳞/排骨状），容易被夕阳点成一片碎金'
  if (hi.code === 'Cs') return '高空是卷层云（薄幕状），能整片点亮，但要注意会不会太厚'
  return ''
}

function adviceOf(i: InterpretInput, low: number, pop: number, ell: number | null): string {
  const kind = i.kind === 'sunrise' ? '日出' : '日落'
  const timing = i.kind === 'sunrise'
    ? '建议提前 30–40 分钟到位，日出后 10 分钟内的回光也别急着走'
    : '建议提前 40 分钟到位，太阳落到海面后 10–15 分钟常有二次爆发'

  if (i.score >= 82) {
    return '这是一年里排得上号的条件，' + timing + '。' + (pop >= 40 ? '带好雨具，阵雨可能打乱计划但也可能加成。' : '机位会很挤，早点去占位置。')
  }
  if (i.score >= 66) {
    return '条件不错，' + timing + '。' + (low > 40 ? '低云偏多，优先选能看到完整地平线的位置（高一点或靠海）。' : '正常发挥就有片子。')
  }
  if (i.score >= 48) {
    return '值得顺路看看，' + timing + '。重点赌云缝：太阳钻进低云缝隙的那一刻，才有像样的颜色。'
  }
  if (ell != null && ell > 8) {
    return '现在太阳还高，' + kind + '还早；分数低主要是云和通透度不行，可以改天再看。'
  }
  return '这一次不建议专程跑。如果本来就在海边，拍蓝调时刻或维纳斯带（背对太阳那条粉蓝带）更稳。'
}

/** 把解读压成一句给分享用的短话 */
export function interpretOneLine(it: Interpretation): string {
  return it.headline + '。' + it.advice
}

/** 供别处检查：分数和文案口径别打架 */
export function scoreBandOf(score: number): 'top' | 'good' | 'ok' | 'low' {
  return score >= 82 ? 'top' : score >= 66 ? 'good' : score >= 48 ? 'ok' : 'low'
}

export function clampScore(v: number): number {
  return clamp(Math.round(v), 0, 96)
}
