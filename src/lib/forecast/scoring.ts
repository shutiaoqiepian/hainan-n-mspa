import { aodBand } from '@/data/forecast/levels'
import type { CloudLayer, Measure, Profile, RawPoint, Spot, SunPos } from '@/lib/forecast/types'
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

/* ---------- 云隙光（丁达尔 / 曙暮光条 / 耶稣光）----------
   和「太阳光柱」是两回事。旧版把两者混在一个“光柱”指数里，
   所以数值总是不对味。分开算：

   云隙光 = 太阳低 + 云有缝隙 + 低云不封地平线 + 空气里有散射介质
     · 太阳高度：-6°~+4° 最出戏（光条最长、明暗对比最强）；
       高于 18° 基本只剩普通斜射光。
     · 缝隙：一片云的“边缘密度”在云量 50% 附近最大（4c(1-c)），
       全晴没云没光条、全阴没有缝。中/高/低云各算一次取最大。
     · 低云：挡地平线就看不到光条落点。
     · 介质：AOD 太低（<0.08）空气太干净，光路看不见；
       0.15–0.5 最好；>0.8 变成漫射灰。
     · 降水：小雨柱反而能出“耶稣光打雨幕”，暴雨则全糊。 */
function edgeDensity(cover: number | null): number {
  if (cover == null) return 0
  const c = clamp(cover, 0, 100) / 100
  return c < 0.08 ? 0 : 4 * c * (1 - c)
}

export function crepuscularOf(
  m: Measure,
  sun: SunPos | null,
  opts?: { face?: number; cloudBase?: number | null }
): number {
  if (!sun) return 0
  const el = sun.el

  let sunF: number
  if (el >= -6 && el <= 4) sunF = 1
  else if (el > 4 && el <= 10) sunF = 0.8
  else if (el > 10 && el <= 18) sunF = 0.42
  else if (el < -6 && el >= -10) sunF = 0.55
  else sunF = 0.08

  /* 缝隙：中云、高云、低云各算一次，取最大（光条可以从任何一层漏下来）。
     另外要有“云”这件事本身：全晴 5% 云量谈不上云缝，最多算孤立积云的偶然光柱。 */
  const gapMid = edgeDensity(m.mid)
  const gapHigh = edgeDensity(m.high)
  const gapLow = edgeDensity(m.low) * 0.75
  const gap = Math.max(gapMid, gapHigh, gapLow)
  const mostCover = Math.max(m.high ?? 0, m.mid ?? 0, m.low ?? 0)
  const presence = clamp(mostCover / 30, 0, 1)
  const gapF = presence * (0.15 + 0.85 * gap)

  /* 低云压住地平线：光条落点被吃掉 */
  const low = m.low ?? 0
  const lowF = low <= 20 ? 1 : 1 - clamp((low - 20) / 75, 0, 1) * 0.82

  /* 散射介质：和火烧云相反 —— 太干净反而看不见光条（pristine clear air produces
     invisible rays），0.1–0.5 最好，>0.8 变漫射灰。见 research/rays.md B.3 */
  const aod = m.aod ?? 0.25
  const aodF = aod < 0.05 ? 0.4 : aod < 0.1 ? 0.7 : aod <= 0.5 ? 1 : aod <= 0.8 ? 0.6 : 0.25

  const pop = m.pop ?? 0
  const popF = pop >= 80 ? 0.35 : pop >= 55 ? 0.6 : pop >= 30 ? 0.9 : 1

  const vis = m.vis
  const visF = vis == null ? 0.9 : vis >= 20 ? 1 : vis >= 10 ? 0.85 : vis >= 5 ? 0.6 : 0.35

  /* 低云云底太低时，云自己也成了“墙”，光条落不下来 */
  const cb = opts?.cloudBase ?? null
  const baseF = cb == null ? 1 : cb < 250 ? 0.55 : cb < 500 ? 0.75 : cb < 900 ? 0.9 : 1

  /* 朝向：面向太阳才看得到顺光光条；背对只剩反云隙光 */
  const faceF = opts?.face != null ? 0.55 + 0.45 * clamp(opts.face, 0, 1) : 1

  /* 0.85 的保守系数：几何上的“有缝”只是必要条件，不等于一定出片。
     没有历史回测，所以宁可低估；上限压到 95，避免出现“满分光柱”。 */
  const v = 100 * sunF * gapF * lowF * aodF * popF * visF * baseF * faceF
  return Math.round(clamp(v * 0.85, 0, 95))
}

/* ---------- 太阳光柱（日柱 / sun pillar）----------
   冰晶云里的片状冰晶把太阳光镜面反射成一根竖直光柱。
   判据（和云隙光完全不同，旧版没算这一块）：
     · 太阳高度 -8°~+5°：光柱高度随太阳高度变化，最低时最长
     · 必须是真的冰晶云：500 hPa ≤ -18℃、300 hPa ≤ -35℃
     · 高空云要薄：云量 10–60% 最好（太厚挡光，太薄不够亮）
     · 低云要少：< 25%，否则把太阳和光柱一起挡掉
     · 空气别太脏：AOD < 0.5，否则对比度被糊掉 */
export function pillarOf(m: Measure, sun: SunPos | null, layers?: CloudLayer[]): number {
  if (!sun) return 0
  const el = sun.el

  /* atoptics 的观测：太阳 9° 高仍有明显的下柱，日落后 30–60 分钟内光柱反而增强。
     所以窗口比旧版宽得多：-6°~+20° 都可能，-2°~+8° 最好；见 research/rays.md A.2 */
  let sunF: number
  if (el >= -2 && el <= 8) sunF = 1
  else if (el > 8 && el <= 20) sunF = 1 - (el - 8) / 12 * 0.55        /* +8°→+20°：1 → 0.45 */
  else if (el < -2 && el >= -6) sunF = 1 + (el + 2) / 4 * 0.45        /* -2°→-6°：1 → 0.55 */
  else sunF = 0

  /* 冰晶条件：高空温度 */
  let iceF = 0.75
  if (layers && layers.length) {
    const t500 = layers.find((l) => l.level === 500)?.t ?? null
    const t300 = layers.find((l) => l.level === 300)?.t ?? null
    if (t500 != null && t500 <= -18) iceF = 1
    else if (t500 != null && t500 > -10) iceF = 0.45
    if (t300 != null && t300 > -30) iceF = Math.min(iceF, 0.5)
  }

  const highCover = m.high ?? 0
  const highF = highCover < 8 ? 0.15
    : highCover <= 30 ? 0.75
      : highCover <= 60 ? 1
        : highCover <= 80 ? 0.6
          : 0.3

  const low = m.low ?? 0
  const lowF = low <= 15 ? 1 : low <= 30 ? 0.8 : low <= 55 ? 0.5 : 0.22

  /* 光柱要“亮结构 + 暗背景”，空气越干净对比越强，AOD >0.5 开始明显吃亏 */
  const aod = m.aod ?? 0.25
  const aodF = aod <= 0.3 ? 1 : aod <= 0.5 ? 0.8 : aod <= 0.8 ? 0.5 : 0.25

  const popF = (m.pop ?? 0) >= 70 ? 0.4 : 1
  const visF = m.vis == null ? 0.9 : m.vis >= 15 ? 1 : m.vis >= 8 ? 0.8 : 0.5

  /* 光柱是罕见现象：几何条件齐了也只给“有机会”级别，
     再乘 0.6 压一档，上限 88（不出现满分）。 */
  const v = 100 * sunF * iceF * highF * lowF * aodF * popF * visF
  return Math.round(clamp(v * 0.6, 0, 88))
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
  return v >= 70 ? '很可能出现' : v >= 45 ? '有机会' : v >= 25 ? '可以蹲一蹲' : '基本没有'
}
export function pillarLabel(v: number): string {
  return v >= 55 ? '光柱很可能' : v >= 35 ? '有机会' : v >= 20 ? '看运气' : '基本没有'
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
