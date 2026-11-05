/**
 * 雾的「环境符合度」计算 —— **这是提示，不是预报，更不是概率**。
 * ============================================================
 *
 * ★ 先读这段，否则会误读这个百分比
 *
 *   我们算的是：**5 条判据里满足了几条**，然后除以可用条数。
 *   它是个除法，不是模型输出，不含任何统计校准。
 *
 *   真正的「起雾概率」需要历史观测做标签（哪个小时真的起雾了），
 *   我们一个雾观测都没有 —— 只有机场 METAR，而海南大多数机位不在机场。
 *   按一年十几个雾日估算，攒够 30–50 个样本要 3–4 年。
 *   所以这里**永远不叫「概率」**，只叫「环境符合度」。
 *
 * ★ 判据来源（每条都能对上出处，不是拍脑袋）
 *   1 近饱和 T−Td ≤ 1.5 K ......... 预测文档 §6.2「高潜势」判据
 *   2 相对湿度 RH ≥ 93% ........... 同上
 *   3 风 2–8 m/s ................. 同上；太弱成浅雾、太强把雾抬成层云
 *   4 低云 ≥ 30% ................. 弱代理：雾 = 云底接地，模式有低云说明
 *                                    边界层已经接近饱和（这条最弱，只作参考）
 *   5 露点 > 海温（Td > SST）...... 机制第一判据（预测文档 §3.2 式(4)）
 *                                    ★ 这是平流雾的**必要条件**，单独当硬门槛
 *
 * ★ 海南的特殊性（2026-11-05 实测，别套黄海）
 *   黄海：春季冷海面 + 偏南暖湿气流 → 平流雾。
 *   海南：冷源是**过程性**的 —— 冷空气先把海水吹凉，冷空气一走，
 *        东到东南风带来暖湿气流，流经还没暖回来的冷海面才起雾。
 *        所以海南的平流雾集中在 1–3 月，峰值凌晨 4–8 点
 *        （来源：新华社《为啥琼州海峡春节总遭"雾"？》引海南省气象台/气候中心）。
 *   实测印证：2026-11-05 海口近海 SST 28.7 °C，而露点只有 23.7 °C ——
 *        露点比海温低 5 K，海面比空气暖，**这个季节平流雾的热力条件不成立**。
 *        这不是 bug，是海南 11 月本来就没有平流雾。
 */

import type { FogBasis, FogResult } from './types'

/** 判据阈值。改这里就够了，五个数字是唯一的可调项 */
export const FOG_THRESHOLD = {
  /** 露点差 ≤ 这个值算「接近饱和」（K） */
  dewSpread: 1.5,
  /** 相对湿度下限（%） */
  rh: 93,
  /** 有利风速区间（m/s） */
  windMin: 2,
  windMax: 8,
  /** 低云下限（%），弱代理 */
  lowCloud: 30
} as const

export interface FogInput {
  /** 2 m 气温（°C） */
  t2m: number | null
  /** 2 m 露点（°C） */
  td2m: number | null
  /** 相对湿度（%） */
  rh: number | null
  /** 低云量（%） */
  low: number | null
  /** 10 m 风速（m/s） */
  wind10: number | null
  /** 海表温度（°C）；null = 该点没有海温数据（内陆或取数失败） */
  sst: number | null
  /** 预报时刻的北京小时（0–23）。用于判断「是不是清晨」 */
  hour: number
}

/** 清晨判定窗口：海南平流雾官方统计是「凌晨 2 点至上午 10 点，4–8 点最多」 */
export const FOG_WINDOW = { from: 2, to: 10 } as const

function spread(t: number | null, td: number | null): number | null {
  if (t == null || td == null) return null
  const v = t - td
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null
}

/** 是不是清晨窗口。窗口外不显示雾卡片（决策 3a） */
export function isMorningHour(hour: number): boolean {
  return hour >= FOG_WINDOW.from && hour < FOG_WINDOW.to
}

export function computeFog(inp: FogInput): FogResult {
  const d = spread(inp.t2m, inp.td2m)
  const basis: FogBasis[] = []

  /* ---- 1 近饱和 ---- */
  if (d == null) {
    basis.push({
      label: '近饱和（露点差）',
      state: 'missing',
      value: '缺测',
      need: `≤ ${FOG_THRESHOLD.dewSpread} K`,
      why: '空气要接近饱和才可能凝结成雾滴，这是最直接的一条。'
    })
  } else {
    basis.push({
      label: '近饱和（露点差）',
      state: d <= FOG_THRESHOLD.dewSpread ? 'ok' : 'no',
      value: `${d} K`,
      need: `≤ ${FOG_THRESHOLD.dewSpread} K`,
      why: '空气要接近饱和才可能凝结成雾滴。露点差 1 K 以内基本就是「一降温就饱和」。'
    })
  }

  /* ---- 2 相对湿度 ---- */
  if (inp.rh == null) {
    basis.push({
      label: '相对湿度',
      state: 'missing',
      value: '缺测',
      need: `≥ ${FOG_THRESHOLD.rh}%`,
      why: '湿度是水汽够不够。但单看湿度会误判，要和露点差一起看。'
    })
  } else {
    const v = Math.round(inp.rh)
    basis.push({
      label: '相对湿度',
      state: v >= FOG_THRESHOLD.rh ? 'ok' : 'no',
      value: `${v}%`,
      need: `≥ ${FOG_THRESHOLD.rh}%`,
      why: '湿度是水汽够不够。但单看湿度会误判，要和露点差一起看。'
    })
  }

  /* ---- 3 风 ---- */
  if (inp.wind10 == null) {
    basis.push({
      label: '风速（10 m）',
      state: 'missing',
      value: '缺测',
      need: `${FOG_THRESHOLD.windMin}–${FOG_THRESHOLD.windMax} m/s`,
      why: '风是双刃剑：太弱只剩贴地薄雾，太强会把雾抬成层云并卷进干空气。'
    })
  } else {
    const w = Math.round(inp.wind10 * 10) / 10
    const ok = w >= FOG_THRESHOLD.windMin && w <= FOG_THRESHOLD.windMax
    basis.push({
      label: '风速（10 m）',
      state: ok ? 'ok' : 'no',
      value: `${w} m/s`,
      need: `${FOG_THRESHOLD.windMin}–${FOG_THRESHOLD.windMax} m/s`,
      why:
        w > FOG_THRESHOLD.windMax
          ? '风偏大：湍流会把雾抬成低层云，或者把干空气卷进来把雾吹散。'
          : w < FOG_THRESHOLD.windMin
            ? '风偏小：冷却只集中在贴地薄薄一层，多半是浅雾，成不了片。'
            : '风速在有利区间：湍流刚好能把冷却和水汽搅到几十到几百米厚。'
    })
  }

  /* ---- 4 低云（弱代理） ---- */
  if (inp.low == null) {
    basis.push({
      label: '低云量',
      state: 'missing',
      value: '缺测',
      need: `≥ ${FOG_THRESHOLD.lowCloud}%`,
      why: '雾就是云底接地。模式里已经有低云，说明边界层接近饱和。'
    })
  } else {
    const v = Math.round(inp.low)
    basis.push({
      label: '低云量（弱参考）',
      state: v >= FOG_THRESHOLD.lowCloud ? 'ok' : 'no',
      value: `${v}%`,
      need: `≥ ${FOG_THRESHOLD.lowCloud}%`,
      why: '雾就是云底接地。这条最弱 —— 低云多也可能只是低层云没接地，所以只当参考。'
    })
  }

  /* ---- 5 热力：露点 > 海温（平流雾必要条件） ---- */
  let gate: FogResult['gate']
  if (inp.sst == null) {
    gate = 'missing'
    basis.push({
      label: '冷面条件（露点 > 海温）',
      state: 'na',
      value: '该点没有海温',
      need: '露点 > 海温',
      why:
        '平流雾的第一判据是「暖湿空气的露点高于冷下垫面」。' +
        '这个点不是海面（内陆/山区），没有海温，不能用这条判断 —— ' +
        '内陆要看的是辐射雾，不是平流雾。'
    })
  } else if (inp.td2m == null) {
    gate = 'missing'
    basis.push({
      label: '冷面条件（露点 > 海温）',
      state: 'missing',
      value: '露点缺测',
      need: '露点 > 海温',
      why: '要有露点才能和海温比。'
    })
  } else {
    const diff = Math.round((inp.td2m - inp.sst) * 10) / 10
    gate = diff > 0 ? 'ok' : 'no'
    basis.push({
      label: '冷面条件（露点 > 海温）',
      state: gate === 'ok' ? 'ok' : 'no',
      value: `露点 ${Math.round(inp.td2m * 10) / 10} °C，海温 ${inp.sst} °C（差 ${diff > 0 ? '+' : ''}${diff} K）`,
      need: '露点 > 海温',
      why:
        gate === 'ok'
          ? '露点高于海温：暖湿空气流到冷海面上会被冷却到饱和，这是平流雾能成立的前提。'
          : '露点低于海温：海面比空气还暖，空气不会因为接触海面而变冷 —— 平流雾的冷面条件不成立。'
    })
  }

  /* ---- 汇总 ---- */
  const usable = basis.filter((b) => b.state === 'ok' || b.state === 'no')
  const hit = usable.filter((b) => b.state === 'ok').length
  const total = usable.length
  const pct = total ? Math.round((hit / total) * 100) : null

  const hasCore = d != null && inp.rh != null
  const dataStatus: FogResult['dataStatus'] = !hasCore
    ? 'missing'
    : inp.sst == null || inp.wind10 == null
      ? 'partial'
      : 'ok'

  return { pct, hit, total, basis, gate, dataStatus, guide: guideFor(inp, gate) }
}

/** 指导文案：告诉用户拿到这个结果之后，还该去看什么 */
function guideFor(inp: FogInput, gate: FogResult['gate']): string[] {
  const g: string[] = []

  /* 1. 双刃剑 —— 对拍照的人最要紧的一条 */
  g.push(
    '雾对拍照是双刃剑：好处是平流雾配日出容易出大片、山顶还能看到云海；' +
      '坏处是雾一厚就什么都看不见，太阳被整个盖住，白跑一趟。'
  )

  /* 2. 硬门槛：冷面条件不成立时，先说清「这一类雾基本不可能」 */
  if (gate === 'no') {
    g.push(
      '这次「冷面条件」不满足，所以平流雾这一类基本可以排除。' +
        '如果清晨真起了雾，更可能是夜间辐射冷却造成的辐射雾，或者雨后的雾。'
    )
  }

  /* 3. 气溶胶：决定雾有多「稠」 */
  g.push(
    '再看 AOD（气溶胶）：气溶胶多的时候同样的含水量雾更浓、能见度更低，' +
      '更容易把太阳完全挡住；气溶胶少的时候雾偏「薄纱」，反而可能透光出层次。'
  )

  /* 4. 低云高度：分辨「雾」还是「低层云压顶」 */
  g.push(
    '再看低云：如果低云很多但云底明显高于地面，那不算雾，是低层云压顶 —— ' +
      '这种情况更可能是「阴天没戏」，而不是「拍雾」。'
  )

  /* 5. 风：超过 10 m/s 就不是雾了 */
  if (inp.wind10 != null && inp.wind10 > 10) {
    g.push(
      `这次风速 ${Math.round(inp.wind10 * 10) / 10} m/s 偏大：风一大雾会被抬成低层云，` +
        '那就别按「蹲雾」的思路去，改成等云缝。'
    )
  }

  /* 6. 数据边界：必须说清我们算不了什么 */
  g.push(
    '这个百分比是「几条环境判据满足了几条」，不是「起雾的可能性有多大」。' +
      '我们没有雾的观测记录，也没法验证它准不准 —— 所以它只能用来「多一个参考」，不能当成决定要不要去的唯一依据。'
  )

  if (gate === 'missing') {
    g.push(
      '另外：这个机位不是海面（内陆/山区），没有海温数据，所以「冷面条件」这一条没法评估，' +
        '上面的百分比是剩下几条算出来的。内陆更该关注的是辐射雾。'
    )
  }

  return g
}
