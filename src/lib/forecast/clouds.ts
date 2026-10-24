/* ============================================================
   云层剖面 + 云种识别
   ------------------------------------------------------------
   SunsetBot 的「大气截面图」展示的是垂直方向上的云层分布，
   我们拿 Open-Meteo 的气压层数据（ECMWF）做同一件事：

     cloud_cover_925hPa / ... / cloud_cover_200hPa
     relative_humidity_*  temperature_*  dew_point_*  geopotential_height_*

   识别思路（也是气象上判云属的老办法）：
     1. 一个气压层云量 ≥ 30% 或相对湿度 ≥ 80% → 这一层有云
     2. 按位势高度分三档：低云 <2km、中云 2–6km、高云 >6km
     3. 在高/中/低档里，按「云量 + 湿度 + 温度 + 降水 + 对流」挑云属
   输出既是给「大气截面图」画柱状图的，也是给解读文案用的。
   ============================================================ */

import type { CloudLayer, CloudSheet, Measure, RawPoint, SpotDetail } from './types'
import { clamp, lclMeters } from './scoring'

/** 取数的气压层（从低到高） */
export const PROFILE_LEVELS = [1000, 925, 850, 700, 600, 500, 300, 200] as const

/** 各层的标准高度兜底（m），数据缺该层位势高度时用 */
const FALLBACK_HEIGHT: Record<number, number> = {
  1000: 110,
  925: 780, 850: 1500, 700: 3100, 600: 4400, 500: 5900, 300: 9700, 200: 12500
}

function num(pr: RawPoint | null | undefined, name: string, idx: number): number | null {
  const h = pr?.hourly
  if (!h) return null
  const a = h[name] || h[name + '_ecmwf_ifs025']
  if (!a) return null
  const v = a[idx]
  return typeof v === 'number' ? v : null
}

/** 从静态缓存/实时数据里读某一层的原始值 */
export function rawLayer(pr: RawPoint | null | undefined, level: number, idx: number) {
  return {
    cover: num(pr, 'cloud_cover_' + level + 'hPa', idx),
    rh: num(pr, 'relative_humidity_' + level + 'hPa', idx),
    t: num(pr, 'temperature_' + level + 'hPa', idx),
    td: num(pr, 'dew_point_' + level + 'hPa', idx),
    height: num(pr, 'geopotential_height_' + level + 'hPa', idx) ?? FALLBACK_HEIGHT[level] ?? null
  }
}

/* ---------- 云属判据 ---------- */

interface JudgeCtx {
  height: number
  cover: number
  rh: number
  t: number | null
  pop: number
  cape: number | null
  /** 下层是否有厚云挡住阳光（决定透光/蔽光） */
  blockedBelow: boolean
  /** 该层以上是否还有云（决定“砧状”等） */
  hasAbove: boolean
  /** 这是整个剖面上最低的有云层 */
  isLowest: boolean
}

/** 高云族（> 6km）：卷云 / 卷层云 / 卷积云 */
function highGenus(c: JudgeCtx): { code: string; genus: string; species: string; lit: boolean; note: string } {
  const { cover, rh, t } = c
  const ice = t == null || t <= -25 /* 低于 -25℃ 基本是冰晶云 */
  if (cover < 25 && rh < 45) {
    return {
      code: 'Ci', genus: '卷云', species: rh < 32 ? '毛卷云 / 钩卷云' : '絮状卷云',
      lit: true,
      note: '丝缕状薄云，太阳落山后十几分钟仍会被照亮，颜色偏粉紫'
    }
  }
  if (cover >= 75 || rh >= 72) {
    return {
      code: 'Cs', genus: '卷层云', species: ice ? '薄幕卷层云' : '卷层云',
      lit: !c.blockedBelow,
      note: cover >= 85
        ? '连成整片的薄幕，会把整片天空染成一层色，但容易“糊成一片”'
        : '薄幕状，能整片点亮，是火烧云最理想的画布'
    }
  }
  return {
    code: 'Cc', genus: '卷积云', species: cover > 55 ? '鱼鳞状卷积云' : '卷积云',
    lit: true,
    note: cover > 55
      ? '鱼鳞/排骨状排列，夕阳斜照时像撒了一把碎金'
      : '成团的小云块，容易被夕阳点成亮橙色'
  }
}

/** 中云族（2–6km）：高积云 / 高层云 / 雨层云 */
function midGenus(c: JudgeCtx): { code: string; genus: string; species: string; lit: boolean; note: string } {
  const { cover, rh } = c
  if (cover >= 85 && rh >= 72) {
    if (c.pop >= 55) {
      return {
        code: 'Ns', genus: '雨层云', species: '雨层云',
        lit: false,
        note: '厚而均匀的降水云，会把整片天压暗，基本无霞'
      }
    }
    return {
      code: 'As', genus: '高层云', species: c.rh >= 85 ? '厚高层云' : '透光高层云',
      lit: c.rh < 82 && !c.blockedBelow,
      note: c.rh < 82
        ? '一层均匀的灰幕，能透出太阳的圆盘，偶尔出“透光”的低饱和霞'
        : '云体较厚，太阳多半被挡在后面，只剩一点边缘光'
    }
  }
  const species = c.blockedBelow
    ? '蔽光高积云'
    : cover > 45
      ? '透光高积云（俗称鱼鳞云）'
      : '高积云'
  return {
    code: 'Ac', genus: '高积云', species,
    lit: !c.blockedBelow,
    note: cover > 55
      ? '成片的块状云，边缘会被夕阳镀上金边，是“金边云”的主力'
      : '零散的块状云，能形成有趣的透光缝隙'
  }
}

/** 低云族（< 2km）：层积云 / 层云 / 积云 / 积雨云 */
function lowGenus(c: JudgeCtx, totalCloudTop: number | null): { code: string; genus: string; species: string; lit: boolean; note: string } {
  const { cover, rh, height, cape, pop } = c
  const capeV = cape ?? 0

  /* 积雨云：对流强 + 降水 + 云顶很高 */
  if (capeV >= 1000 && pop >= 45 && (totalCloudTop == null || totalCloudTop >= 4500)) {
    return {
      code: 'Cb', genus: '积雨云', species: '秃积雨云 / 砧状积雨云',
      lit: true,
      note: '对流云顶能冲到 8 km 以上，日落时顶部会被染红，但云底多半压得很低'
    }
  }

  if (rh >= 92 && height <= 900) {
    return {
      code: 'St', genus: '层云', species: rh >= 96 ? '碎层云 / 雾' : '层云',
      lit: false,
      note: '贴着地面的灰雾，与海面糊成一片，能见度和色彩都会被吃掉'
    }
  }

  if (cover >= 55) {
    return {
      code: 'Sc', genus: '层积云',
      species: rh >= 88 ? '蔽光层积云' : cover >= 45 && c.pop >= 40 ? '波状层积云（俗称排骨云）' : '透光层积云',
      lit: rh < 88,
      note: cover >= 80
        ? '厚层积云铺满低空，会把太阳提前压进云里'
        : '成片的低云，可能压住地平线，但也常留出一条缝让太阳钻进去'
    }
  }

  if (capeV >= 600) {
    return {
      code: 'Cu', genus: '积云', species: capeV >= 1500 ? '浓积云' : '淡积云',
      lit: true,
      note: '一朵朵立在半空，边缘会被夕阳描成金边，是最常见的“金边云”'
    }
  }

  return {
    code: 'Sc', genus: '碎积云', species: '碎积云',
    lit: true,
    note: '零散碎云，几乎不挡光，运气好能烧出“云烧穿”的效果'
  }
}

/* ---------- 主函数：把气压层数据变成云层剖面 ---------- */

export interface ProfileResult {
  layers: CloudLayer[]
  sheets: CloudSheet[]
  genusText: string
}

export function cloudProfile(
  pr: RawPoint | null | undefined,
  idx: number,
  opts: { pop: number; cape: number | null; sunEl: number | null }
): ProfileResult {
  const raw = PROFILE_LEVELS.map((lv) => {
    const r = rawLayer(pr, lv, idx)
    return { level: lv, ...r }
  }).filter((r) => r.height != null && (r.cover != null || r.rh != null)) as Array<{
    level: number; cover: number | null; rh: number | null; t: number | null; td: number | null; height: number
  }>

  if (raw.length < 3) return { layers: [], sheets: [], genusText: '' }

  /* 有云的层：云量 ≥ 30% 或 湿度 ≥ 80%。
     湿度到饱和（RH ≥ 92%）但 ECMWF 云量很低 → 「弱云」：按有云处理，
     云量用湿度反推一个不小于 25% 的值，并在说明里标出来。
     这样既不会出现「平均 46% / 云种：无」的矛盾，也不会冒出 0% 这种怪数字。 */
  const cloudy = raw.map((r) => {
    const cover0 = r.cover ?? 0
    const rh = r.rh ?? 0
    const byCloud = cover0 >= 30
    const byHumid = rh >= 80
    let coverEff = Math.max(0, cover0)
    if (!byCloud && byHumid) {
      const inferred = Math.round(Math.min(85, Math.max(15, (rh - 60) * 1.2)))
      coverEff = Math.max(coverEff, inferred)
    }
    return { ...r, isCloud: byCloud || byHumid, faint: !byCloud && byHumid, coverEff }
  })

  /* 云顶：最高的有云层 */
  let topMost: number | null = null
  for (const r of cloudy) if (r.isCloud) topMost = r.height

  const layers: CloudLayer[] = []

  for (let i = 0; i < cloudy.length; i++) {
    const r = cloudy[i]
    const cover = Math.max(0, Math.round((r as { coverEff?: number }).coverEff ?? r.cover ?? 0))
    const rh = Math.round(r.rh ?? 0)
    const faint = (r as { faint?: boolean }).faint === true
    if (!r.isCloud) {
      layers.push({
        level: r.level, height: Math.round(r.height), cover, rh,
        t: r.t, td: r.td, code: '--', genus: '无云', species: '',
        base: null, top: null, lit: false,
        note: cover < 15 ? '基本无云' : '云量偏少'
      })
      continue
    }

    /* 下层是否已经有厚云（决定上层云能不能被太阳照到） */
    const blockedBelow = cloudy.slice(0, i).some((x) => x.isCloud && (x.cover ?? 0) >= 70)

    const ctx: JudgeCtx = {
      height: r.height,
      cover,
      rh,
      t: r.t,
      pop: opts.pop,
      cape: opts.cape,
      blockedBelow,
      hasAbove: false,
      isLowest: false
    }

    let g: { code: string; genus: string; species: string; lit: boolean; note: string }
    if (r.height >= 6000) g = highGenus(ctx)
    else if (r.height >= 2000) g = midGenus(ctx)
    else g = lowGenus(ctx, topMost)

    /* 云底：这一层的温露差推 LCL，从层底往上抬；温露差大到“不可能饱和”时就用层底。
       必须夹在「本层高度」与「上一层高度」之间、且不低于 0 —— 否则会算出
       “云底 -1200 m”这种负值（高空层温度低，LCL 公式会把云底往下推）。 */
    const lcl = lclMeters(r.t, r.td)
    const nextUp = raw[i + 1] ? raw[i + 1].height : r.height + 2500
    const rawBase = lcl != null && lcl < 2500 ? r.height + lcl * 0.25 : r.height
    const base = Math.round(Math.max(0, Math.min(rawBase, nextUp - 50)))
    const top = Math.round(Math.min(nextUp, r.height + (r.height >= 6000 ? 900 : r.height >= 2000 ? 600 : 400)))

    layers.push({
      level: r.level, height: Math.round(r.height), cover, rh,
      t: r.t, td: r.td, code: g.code, genus: g.genus, species: g.species,
      base, top, lit: g.lit,
      note: faint ? g.note + '（ECMWF 云量报得偏低、湿度已近饱和，按有云处理）' : g.note
    })
  }

  /* 连成一片的云层：相邻两个有云层高度差 < 2500m 就合并 */
  const sheets: CloudSheet[] = []
  let cur: CloudLayer[] = []
  function flush(): void {
    if (!cur.length) return
    const low = cur[0]
    const high = cur[cur.length - 1]
    const genera = cur.map((x) => x.genus).filter((v, k, arr) => arr.indexOf(v) === k)
    const cover = Math.round(cur.reduce((a, b) => a + b.cover, 0) / cur.length)
    const lit = cur.some((x) => x.lit)
    const base = Math.max(0, low.base ?? low.height)
    const top = Math.max(base, high.top ?? high.height)
    const genTxt = genera.join('、')
    sheets.push({
      base, top, cover, genera, lit,
      text: genTxt + ' · 云底约 ' + km(base) + ' · 云顶约 ' + km(top) +
        ' · 云量 ' + cover + '%' + (lit ? ' · 能被夕阳照亮' : ' · 多半照不到')
    })
    cur = []
  }
  for (const l of layers) {
    if (l.code === '--') {
      flush()
      continue
    }
    const last = cur[cur.length - 1]
    if (last && l.height - last.height > 2500) flush()
    cur.push(l)
  }
  flush()

  /* 一句话云况 */
  const band = (min: number, max: number) => layers
    .filter((l) => l.code !== '--' && l.height >= min && l.height < max)
    .sort((a, b) => b.cover - a.cover)[0] || null
  const hi = band(6000, 99999)
  const md = band(2000, 6000)
  const lo = band(-1, 2000)
  const genusText = [
    '高云：' + (hi ? hi.genus + ' ' + hi.cover + '%' : '无'),
    '中云：' + (md ? md.genus + ' ' + md.cover + '%' : '无'),
    '低云：' + (lo ? lo.genus + ' ' + lo.cover + '%' : '无')
  ].join(' · ')

  return { layers, sheets, genusText }
}

/** 数据缺气压层时的兜底：用高/中/低三档云量 + 旧版湿度剖面拼一个粗略剖面 */
export function syntheticProfile(
  m: Measure,
  pr: RawPoint | null | undefined,
  idx: number,
  cape: number | null,
  pop: number
): ProfileResult {
  const rows: Array<{ level: number; height: number; cover: number; rh: number }> = [
    { level: 850, height: 1500, cover: m.low ?? 0, rh: num(pr, 'relative_humidity_850hPa', idx) ?? 70 },
    { level: 700, height: 3100, cover: m.mid ?? 0, rh: num(pr, 'relative_humidity_700hPa', idx) ?? 60 },
    { level: 500, height: 5900, cover: m.high ?? 0, rh: num(pr, 'relative_humidity_500hPa', idx) ?? 40 }
  ]
  const layers: CloudLayer[] = rows.map((r) => {
    const ctx: JudgeCtx = {
      height: r.height, cover: Math.round(r.cover), rh: Math.round(r.rh),
      t: null, pop, cape, blockedBelow: false, hasAbove: false, isLowest: false
    }
    const g = r.height >= 6000 ? highGenus(ctx) : r.height >= 2000 ? midGenus(ctx) : lowGenus(ctx, null)
    return {
      level: r.level, height: r.height, cover: Math.round(r.cover), rh: Math.round(r.rh),
      t: null, td: null, code: r.cover < 30 ? '--' : g.code,
      genus: r.cover < 30 ? '无云' : g.genus,
      species: r.cover < 30 ? '' : g.species,
      base: r.cover < 30 ? null : r.height, top: r.cover < 30 ? null : r.height + 600,
      lit: r.cover < 30 ? false : g.lit, note: r.cover < 30 ? '基本无云' : g.note
    }
  })
  const genusText = [
    '高云：' + (layers[2].code === '--' ? '无' : layers[2].genus + ' ' + layers[2].cover + '%'),
    '中云：' + (layers[1].code === '--' ? '无' : layers[1].genus + ' ' + layers[1].cover + '%'),
    '低云：' + (layers[0].code === '--' ? '无' : layers[0].genus + ' ' + layers[0].cover + '%')
  ].join(' · ')
  return { layers, sheets: [], genusText }
}

function km(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'
}

/* ---------- 云对“能不能烧”的影响，给评分用 ---------- */

/** 薄高云是画布；厚高云会挡；无高云没得烧 */
export function canvasFactor(layers: CloudLayer[]): number {
  if (!layers.length) return 1
  const high = layers.filter((l) => l.height >= 6000)
  const useful = high.filter((l) => l.lit && l.cover >= 20 && l.cover <= 85)
  if (!high.length) return 0.8
  if (!useful.length) return 0.55
  const best = usableCover(useful.map((l) => l.cover))
  return clamp(0.6 + 0.4 * best, 0, 1)
}

function usableCover(covers: number[]): number {
  /* 40–75% 最理想；太低没面积，太高糊成一片 */
  let best = 0
  for (const c of covers) {
    const v = c < 20 ? c / 20 * 0.5 : c <= 40 ? 0.5 + (c - 20) / 20 * 0.5
      : c <= 75 ? 1 : clamp(1 - (c - 75) / 25 * 0.6, 0, 1)
    best = Math.max(best, v)
  }
  return best
}

export type { SpotDetail }
