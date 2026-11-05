/* ============================================================
   自动气象解读
   ------------------------------------------------------------
   参考 SunsetBot「详细预报」的写法：不只给一个分数，还要说清
   「为什么是这个分、哪一项在加分、哪一项在拖后腿」。
   全部由规则拼出，没有新的数据假设；数字都说清单位。
   ============================================================ */

import { aodBand } from '@/data/forecast/levels'
import type { CloudLayer, Conflict, Interpretation, KindKey, Measure, SunPos } from './types'
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

  /* ---- 高云：画布 ----
     ★ 区间必须和 scoring.ts 的 fHigh() 一致，否则文案会自相矛盾：
       fHigh: <8 → 0（没得烧）；8–55 → 线性爬坡；55–78 → 满分 1.0；>78 → 递减。
       原来这里写「30% 以上就落在理想区间」，但 30–55 其实只有 0.47–0.94 分，
       用户看到「30% 落在理想区间」配一个低分，会以为算错了。 */
  if (high < 8) {
    cons.push('高云只有 ' + pct(high) + '，不足以形成火烧云的“画布”')
  } else if (high < 40) {
    cons.push('高云 ' + pct(high) + ' 偏少，只能烧出一角，形不成整片')
  } else if (high < 55) {
    pros.push('高云 ' + pct(high) + '，够铺开，但还没到最理想的量')
  } else if (high <= 78) {
    pros.push('高云 ' + pct(high) + '，正好在 55–78% 的最佳区间，是火烧云最标准的画布')
  } else if (high <= 92) {
    cons.push('高云 ' + pct(high) + ' 偏多，容易糊成一整片，只剩边缘能烧')
  } else {
    cons.push('高云接近满云（' + pct(high) + '），太阳光被挡在外面')
  }

  /* ---- 低云：挡不挡地平线 ----
     ★ 「地平线略毛」是追霞圈口语，不是可验证的判据，这里换成能指认现象的说法：
       低云 15–30% 的实际影响是「太阳落到底部那条云带里会被切成几段」，
       而不是画质变“毛”。 */
  /* ★ 全国 224 机位里有 24 个山顶机位（五台山、五指山主峰、梧桐山…），
     还有西藏/新疆/内蒙古/青海等大量内陆机位。
     原来这里写死「沉入海面」，对它们全是错的。
     改成中立说法：日出「升起」、日落「落下」，后面统一用「地平线」。 */
  const horizonAct = i.kind === 'sunrise' ? '升起' : '落下'
  if (low <= 15) {
    pros.push('低云只有 ' + pct(low) + '，地平线干净，能看全太阳' + horizonAct + '的全过程')
  } else if (low <= 30) {
    pros.push('低云 ' + pct(low) + '，基本不挡光路，太阳' + horizonAct + '时可能被云带切成几段')
  } else if (low <= 60) {
    cons.push('低云 ' + pct(low) + '，太阳有可能提前没入低云，要多留 10 分钟余量')
  } else {
    cons.push('低云 ' + pct(low) + '，太阳大概率还没' + horizonAct + '就被云挡住')
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
    cons.push('低云云底只有约 ' + i.cloudBaseLow + ' 米，雾感重，远处景物会糊成一片')
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
    cons.push('云层结构不利于出霞：' + i.profileLabel +
      '（这一项只拿到 ' + Math.round(i.profileMod * 100) + ' 分/满分 100）')
  }

  /* ---- 时效 ---- */
  if (i.day === 1) {
    cons.push('这是明天的预报，时效越长越不准，分数已按 0.95 折过一次')
  }

  /* ---- 找主导因子：分数是乘法，最弱的一项决定结果 ----
     这样解读能解释“明明高云 53% 为什么还是低分”。 */
  const factors: Array<{ name: string; v: number; say: string }> = [
    { name: '高云画布', v: Math.max(0.05, fHigh(high)),
      say: '高云 ' + pct(high) + (high < 8 ? '，几乎没有' : high < 55 ? '，偏少' : high <= 78 ? '，量正好' : '，偏多挡光') },
    { name: '低云遮挡', v: 0.3 + 0.7 * fLow(low),
      say: '低云 ' + pct(low) + (low <= 15 ? '，不挡地平线' : low <= 30 ? '，基本不挡' : low <= 55 ? '，开始压住地平线' : '，明显压住地平线') },
    { name: '通透度', v: 0.55 + 0.45 * fAod(aod), say: 'AOD ' + aod.toFixed(2) + '（' + band.name + '）' },
    { name: '降水湿度', v: 0.55 + 0.45 * fWet(pop, rh ?? 80), say: '降水 ' + pct(pop) + '、湿度 ' + pct(rh) }
  ]
  if (i.profileMod != null) {
    factors.push({ name: '云层结构', v: i.profileMod, say: i.profileLabel ?? '云层结构' })
  }
  factors.sort((a, b) => a.v - b.v)

  /* ★ 原来不管系数多少都直接叫「主要短板」，导致低云 0% 时
     也出现「地平线干净」和「低云遮挡是主要短板」同时出现在一段话里。
     系数是乘法链里的一项，各因子的下限不同（低云最低 0.3、通透最低 0.55），
     所以「最低」不代表「差」。这里改成：
       · 系数 < 0.7 才算真的拖后腿，值得点名为短板；
       · 都在 0.7 以上时，说「没有明显短板」，并给出最接近下限的那一项作为参照。
     0.7 这个门槛：低于它意味着该项把总分砍掉了 30% 以上，肉眼可辨。 */
  const SHORT_BOARD = 0.7
  const weakest = factors.find((f) => f.v < SHORT_BOARD) ?? null
  /** 短板的中文说法：带系数，并解释「系数是什么」 */
  const weakPhrase = (f: { name: string; v: number; say: string }): string =>
    f.name + '（' + f.say + '，这一项只拿到 ' + Math.round(f.v * 100) + ' 分/满分 100）'
  /* 没有明显短板时的说法。
     ★ 这里**不能**点名具体是哪一项 —— 哪怕它是「最低」的，只要没低于 0.7，
       点它的名就会和上面 pros 里的「地平线干净」直接打架
       （实测：低云 15% 时 pros 说地平线干净，headline 说最弱是低云遮挡）。
       说「各项均衡」就够了，用户不需要知道哪一项相对最低。 */
  const noWeak = '各项条件比较均衡，没有哪一项明显拖后腿'
  /* 挑「最值得说」的优点。
     ★ 不能直接取系数最高的那一项：高云 65%（满分 1.0）、AOD 0.12（满分 1.0）、
       降水 5%（满分 1.0）三项并列时，按数组顺序会选中「降水 5%」——
       这对用户几乎没信息量（晴天本来就很少下雨）。
       乘法评分下「并列满分」很常见，所以按下面的优先级取第一个满分/接近满分的项：
         高云（画布）> 通透度 > 低云 > 降水湿度
       高云排第一：它是火烧云的必要条件，也是用户最想知道的「今天天上有没有东西可烧」。 */
  const STRONG_PRIORITY = ['高云画布', '通透度', '低云遮挡', '降水湿度', '云层结构']
  /* 高云只要 ≥0.75（约 43% 以上），就是比「降水概率低」更值得说的信息 ——
     用户关心的是「天上有没有东西可烧」，不是「会不会下雨」。

     ★ 加权必须是**硬提升**而不是加一个小数：各项系数上限都是 1.0，
       高云 0.787 加 0.15 只有 0.937，仍然输给降水的 1.0，等于没加权（实测踩过）。
       所以只要高云达到门槛，直接把它抬到 2.0（远高于任何真实系数），
       保证它排第一；这改变的是「先说哪一项」，不改变分数本身。 */
  const strongScore = (f: { name: string; v: number }): number =>
    f.name === '高云画布' && f.v >= 0.75 ? 2 : f.v
  const strongest = [...factors]
    .sort((a, b) => strongScore(b) - strongScore(a) ||
      STRONG_PRIORITY.indexOf(a.name) - STRONG_PRIORITY.indexOf(b.name))[0]

  /** 最强项的表达。降水/湿度做优点时信息量低，换成更具体的说法 */
  const strongPhrase = (): string => {
    switch (strongest.name) {
      case '降水湿度':
        return pop <= 25 ? '下雨可能性很低（' + pct(pop) + '）' : '湿度条件还行（' + pct(rh) + '）'
      case '通透度':
        return '空气通透（AOD ' + aod.toFixed(2) + '，' + band.name + '）'
      case '低云遮挡':
        return '低云少（' + pct(low) + '），不挡地平线'
      case '高云画布':
        /* 只有真的落在 55–78% 才能说「量正合适」。
           低于 55% 是「少」，高于 78% 是「多」，方向相反，不能共用一句
           （实测：高云 80% 曾被说成「略少于最佳量」）。 */
        if (high >= 55 && high <= 78) {
          return '高云 ' + pct(high) + '，量正合适（55–78% 是火烧云最标准的画布）'
        }
        return high < 55
          ? '高云 ' + pct(high) + '，够铺开一张画布（略少于 55–78% 的最佳量）'
          : '高云 ' + pct(high) + '，偏多，边缘还能烧但中心容易糊'
      default:
        return strongest.say
    }
  }

  /* ---- 结论 ----
     ★ 三种情况分别说，不再一律套「最弱的是 X」：
       · 有短板（系数 <0.7）→ 点名短板，这是用户最需要知道的信息
       · 没短板但分数不高 → 说明是「各项都平平、没有拖累也没有加成」
         这才是真实原因（乘法结构里，全项 0.85 也会把 96 分压到 50 分）
       · 分数高 → 说最强项，而不是把「降水 10%」这种常态当优点 */
  const hasWeak = weakest !== null
  let headline: string
  if (i.score >= 82) {
    headline = '条件到顶了：' + strongPhrase() + '，各项都在线，值得专程跑一趟'
  } else if (i.score >= 66) {
    headline = hasWeak
      ? '可以跑：' + strongPhrase() + '；主要短板是' + weakPhrase(weakest)
      : '可以跑：' + strongPhrase() + '；' + noWeak
  } else if (i.score >= 48) {
    headline = hasWeak
      ? '就近可以去：' + weakPhrase(weakest) + '，是拉低分数的主因'
      : '就近可以去：' + noWeak + '，分数不高是各项都只到中等，不是哪一项特别差'
  } else {
    headline = hasWeak
      ? '不太值得专门跑：' + weakPhrase(weakest) + '，这几项相乘后只剩 ' + i.score + ' 分'
      : '不太值得专门跑：各项都偏低且没有一项突出，相乘后只剩 ' + i.score + ' 分'
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
  /* ★ 日出的时间建议不能照抄日落：
     「回光返照」是太阳落到地平线下之后、高云仍被从下方照亮的余韵，
     只在日落后出现；日出前对应的是「霞先亮、太阳后出」，
     方向相反，所以说法也不一样（见 phenomena.ts「朝霞（日出霞）」词条）。 */
  const timing = i.kind === 'sunrise'
    ? '建议提前 30–40 分钟到位：天先亮、太阳后出，最艳的一段常在日出前 10 分钟'
    : '建议提前 40 分钟到位，太阳落下地平线后 10–15 分钟常有二次爆发（回光返照）'

  if (i.score >= 82) {
    return '这是一年里排得上号的条件，' + timing + '。' +
      (pop >= 40 ? '带好雨具，阵雨可能打乱计划，但也可能换来雨后的通透霞。' : '机位会很挤，建议早点去占位置。')
  }
  if (i.score >= 66) {
    return '条件不错，' + timing + '。' +
      (low > 40 ? '低云偏多，优先选视野开阔、地平线不被挡的位置（地势高一点、或前方没有遮挡）。' : '按预报正常拍就能出片。')
  }
  if (i.score >= 48) {
    /* ★ 不再重复 headline 里的「重点赌云缝」——上面已经说过了 */
    return '值得顺路看看，' + timing + '。盯住云缝：太阳穿过低云缝隙的那一两分钟，颜色才出得来。'
  }
  if (ell != null && ell > 8) {
    return '现在太阳还高，' + kind + '还早。分数低主要是云量和通透度拖的，可以改天再看。'
  }
  return '这一次不建议专程跑。如果人已经在附近，拍蓝调时刻或维纳斯带（背对太阳方向那条粉蓝带）更稳。'
}

/** 把解读压成一句给分享用的短话 */
export function interpretOneLine(it: Interpretation): string {
  return it.headline + '。' + it.advice
}

/* ---------- 模式打架：ECMWF（云种用的那套）vs 多模式平均 ----------
   界面上「云量%」是三个模式的平均，而「云种」只有 ECMWF 一家。
   两家差得远时，用户会看到「高云 49%」配「高云：无」这种自相矛盾的组合，
   必须显式标出来，否则会以为算错了。阈值取 20 个百分点（原来 30 太宽，实际很少触发）。 */
export const CONFLICT_THRESHOLD = 20

export function conflictsOf(m: Measure, ecmwf: { high: number | null; mid: number | null; low: number | null }): Conflict[] {
  const out: Conflict[] = []
  const bands: Array<['高云' | '中云' | '低云', number | null, number | null]> = [
    ['高云', m.high, ecmwf.high],
    ['中云', m.mid, ecmwf.mid],
    ['低云', m.low, ecmwf.low]
  ]
  for (const [band, avgV, ecmV] of bands) {
    if (avgV == null || ecmV == null) continue
    const diff = Math.round(avgV - ecmV)
    if (Math.abs(diff) < CONFLICT_THRESHOLD) continue
    const text =
      diff > 0
        ? '平均 ' + Math.round(avgV) + '%、ECMWF 只有 ' + Math.round(ecmV) + '%：ICON/GFS 报得多，ECMWF 报得少'
        : '平均 ' + Math.round(avgV) + '%、ECMWF 却有 ' + Math.round(ecmV) + '%：ECMWF 报得多，ICON/GFS 报得少'
    out.push({ band, ecmwf: Math.round(ecmV), avg: Math.round(avgV), diff, text })
  }
  return out
}

/** 供别处检查：分数和文案口径别打架 */
export function scoreBandOf(score: number): 'top' | 'good' | 'ok' | 'low' {
  return score >= 82 ? 'top' : score >= 66 ? 'good' : score >= 48 ? 'ok' : 'low'
}

export function clampScore(v: number): number {
  return clamp(Math.round(v), 0, 96)
}
