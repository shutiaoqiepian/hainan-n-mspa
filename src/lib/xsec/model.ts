/**
 * 把静态 JSON 整理成图表能直接用的形状。
 *
 * 这里只做「取数 / 转单位 / 摆成网格」，不做任何物理推断：
 * 云是模式变量，插值只是估算，阈值来自 tools/xsec/build_cross.py 的实测标定。
 */
import type { XsecField, XsecPoint, XsecSample, XsecSection, XsecSpotFile } from './types'

/** 纵轴可选高度范围（km） */
export const Y_RANGES = [8, 16, 22] as const
export type YRangeKm = (typeof Y_RANGES)[number]

/** 字段名 → 在 levels[] 数组里的下标（不要写死下标，JSON 里给了 levelFields） */
export function fieldIndex(fields: XsecField[]): Partial<Record<XsecField, number>> {
  const map: Partial<Record<XsecField, number>> = {}
  fields.forEach((f, i) => {
    map[f] = i
  })
  return map
}

export function sectionAt(file: XsecSpotFile, t: number, az: number): XsecSection | null {
  let best: XsecSection | null = null
  let bestCost = Infinity
  for (const s of file.sections) {
    const cost = Math.abs(s.t - t) * 1000 + Math.abs(s.az - az)
    if (cost < bestCost) {
      bestCost = cost
      best = s
    }
  }
  return best
}

/** 把 section.samples 展开成带字段名的点阵 [sample][level] */
export function expandPoints(file: XsecSpotFile, section: XsecSection): XsecPoint[][] {
  const idx = fieldIndex(file.levelFields)
  return section.samples.map((sample: XsecSample) =>
    sample.levels.map((row, j) => {
      const num = (f: XsecField): number | null => {
        const i = idx[f]
        if (i === undefined) return null
        const v = row[i]
        return typeof v === 'number' && Number.isFinite(v) ? v : null
      }
      return {
        pressureHpa: file.levelsHpa[j],
        hgtM: num('hgtM'),
        tC: num('tC'),
        rhPct: num('rhPct'),
        clwMgKg: num('clwMgKg'),
        iciMgKg: num('iciMgKg'),
        uMs: num('uMs'),
        vMs: num('vMs'),
        wPaS: num('wPaS'),
        cfPct: num('cfPct'),
        belowGround: num('belowGround') === 1,
        rainMmH: num('rainMmH')
      }
    })
  )
}

/** 总凝结水（液 + 冰），mg/kg。缺测返回 null，绝不当 0。 */
export function totalCondensateMgKg(p: XsecPoint): number | null {
  const a = p.clwMgKg
  const b = p.iciMgKg
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

/** 云水/云冰各占的比例（0 = 全冰，1 = 全液），给配色用 */
export function liquidShare(p: XsecPoint): number {
  const a = p.clwMgKg ?? 0
  const b = p.iciMgKg ?? 0
  const t = a + b
  return t > 0 ? a / t : 0.5
}

/** 各采样点的地形高度（m） */
export function terrainProfile(section: XsecSection): number[] {
  return section.samples.map((s) => s.terrainM)
}

/** 各采样点各层的位势高度（m）；缺测为 null */
export function heightProfile(points: XsecPoint[][]): Array<Array<number | null>> {
  return points.map((col) => col.map((p) => p.hgtM))
}

/** 图的横轴范围（km） */
export function distanceAxis(section: XsecSection): number[] {
  return section.samples.map((s) => s.d)
}

/**
 * 把（5 个采样点 × 9 个气压层）的场插值到规则网格上，用于等值线。
 * 纵向按位势高度线性插值、横向按距离线性插值 —— 这只是估算，图上必须标「格点之间为插值」。
 * 地形以下 / 顶层以上的格点一律返回 null（不画、也不猜）。
 */
export function regularGrid(
  points: XsecPoint[][],
  distances: number[],
  terrain: number[],
  zMaxKm: number,
  nx: number,
  ny: number,
  get: (p: XsecPoint) => number | null
): Array<Array<number | null>> {
  const nSample = points.length
  if (!nSample) return []
  // 1) 每个采样点先把垂直廓线插值到规则高度上
  const cols: Array<Array<number | null>> = points.map((col, si) => {
    const hs: number[] = []
    const vs: number[] = []
    for (const p of col) {
      if (p.hgtM === null || p.belowGround) continue
      const v = get(p)
      if (v === null) continue
      hs.push(p.hgtM)
      vs.push(v)
    }
    const out: Array<number | null> = []
    for (let j = 0; j < ny; j++) {
      const z = (zMaxKm * j) / (ny - 1)
      const zm = z * 1000
      if (zm < terrain[si]) {
        out.push(null)
        continue
      }
      if (hs.length < 2 || zm < hs[0] || zm > hs[hs.length - 1]) {
        out.push(null)
        continue
      }
      let k = 0
      while (k < hs.length - 2 && hs[k + 1] < zm) k++
      const w = (zm - hs[k]) / (hs[k + 1] - hs[k] || 1)
      out.push(vs[k] * (1 - w) + vs[k + 1] * w)
    }
    return out
  })
  // 2) 横向线性插值到规则距离上
  const grid: Array<Array<number | null>> = []
  for (let j = 0; j < ny; j++) {
    const rowOut: Array<number | null> = []
    for (let i = 0; i < nx; i++) {
      const d = (distances[nSample - 1] * i) / (nx - 1)
      let si = 0
      while (si < nSample - 2 && distances[si + 1] < d) si++
      const span = distances[si + 1] - distances[si] || 1
      const w = (d - distances[si]) / span
      const a = cols[si][j]
      const b = cols[si + 1][j]
      rowOut.push(a === null || b === null ? (w < 0.5 ? a : b) : a * (1 - w) + b * w)
    }
    grid.push(rowOut)
  }
  return grid
}

/** 连续云层分段（按气压层合并），给图右侧的层标签用 */
export interface CloudBand {
  fromHpa: number
  toHpa: number
  fromKm: number
  toKm: number
  peakMgKg: number
  liquid: boolean
  /** true = 这段云是 Open-Meteo 的相对湿度诊断云量估出来的，不是模式原生云水 */
  estimated: boolean
}

export function cloudBands(points: XsecPoint[], thresholdMgKg: number): CloudBand[] {
  const bands: CloudBand[] = []
  let cur: CloudBand | null = null
  for (const p of points) {
    const q = totalCondensateMgKg(p)
    const cf = p.cfPct
    /* GFS 有原生云水 → 按凝结水阈值；Open-Meteo 没有云水（null）→ 退回「云量≥50%」，
       并且明确标记这是估算，不让两种来源混为一谈。 */
    const estimated = q === null && cf !== null
    const value = q ?? 0
    const has = !p.belowGround && p.hgtM !== null &&
      (q !== null ? q >= thresholdMgKg : (cf ?? 0) >= 50)
    if (has) {
      const h = (p.hgtM as number) / 1000
      if (!cur) {
        cur = {
          fromHpa: p.pressureHpa,
          toHpa: p.pressureHpa,
          fromKm: h,
          toKm: h,
          peakMgKg: value,
          liquid: !estimated && liquidShare(p) >= 0.5,
          estimated
        }
      } else {
        cur.toHpa = p.pressureHpa
        cur.toKm = h
        cur.peakMgKg = Math.max(cur.peakMgKg, value)
        cur.liquid = cur.liquid || (!estimated && liquidShare(p) >= 0.5)
        cur.estimated = cur.estimated || estimated
      }
    } else if (cur) {
      bands.push(cur)
      cur = null
    }
  }
  if (cur) bands.push(cur)
  return bands
}

/** 北京时间「HH:MM」 */
export function beijingTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '--:--'
  const hh = String(d.getUTCHours() + 8 >= 24 ? d.getUTCHours() - 16 : d.getUTCHours() + 8).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 北京时间「M月D日 HH:MM」 */
export function beijingDateTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const shifted = new Date(d.getTime() + 8 * 3600000)
  const m = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  return `${m}月${day}日 ${beijingTime(iso)}`
}
