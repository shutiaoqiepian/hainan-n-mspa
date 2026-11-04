<script setup lang="ts">
/**
 * 大气水平—垂直截面图 v2（数据真相重写版）。
 *
 * v2 相对 v1 的硬性修正（对应阶段七 P0–P4）：
 *   P0-1 每个变量各自画，绝不混用：云水 CLWMR / 云冰 ICMR / 总云量 TCDC / RH 等值线。
 *   P0-2 垂直方向**按模式层的真实厚度分段**，不再把一层的云平滑抹到上下 2–3 km。
 *   P0-3 tooltip 同时显示「光标处的插值值」和「最近模式层原始值」，两者语义分开。
 *   P0-4 缺测不允许当 0：任何一个成分缺测就标缺测，并在图上不因缺测而着色。
 *   P1  纵轴支持海拔/离地切换，右侧标气压层，横向标真实格点位置与采样间距。
 *   P2  四种渲染模式：云水 / 云冰 / 总云量 / 综合摄影（默认）。
 *   P3  太阳只画投影方向，并把「几何照明 ≠ 辐射传输」写在图上。
 *   P4  天空背景、地形、观察者、云底/云顶轮廓、色标、悬停读数、移动端可读尺寸。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  distanceAxis, expandPoints, fieldIndex, heightProfile, liquidShare, regularGrid, terrainProfile
} from '@/lib/xsec/model'
import { boundaryHeightKm, farFieldLit, litAt, transmittance } from '@/lib/xsec/light'
import { genusLabel, genusOfLevel } from '@/lib/xsec/cloudgenus'
import type { SunInPlane } from '@/lib/xsec/sun'
import type { XsecPoint, XsecSection, XsecSpotFile } from '@/lib/xsec/types'

export type XsecMode = 'photo' | 'water' | 'ice' | 'total'

const props = withDefaults(
  defineProps<{
    file: XsecSpotFile
    section: XsecSection
    yMaxKm: number
    layers: { rh: boolean; temp: boolean; wind: boolean; w: boolean }
    sun: SunInPlane
    sunDown: boolean
    mode: XsecMode
    /** 纵轴：msl 海拔 / agl 离地（以机位地面为基准） */
    heightAxis: 'msl' | 'agl'
    /** 真实 DEM 地形序列（沿当前剖面方位，等间距）；null = 缺测，退回模式地形 */
    dem?: Array<number | null> | null
    /** DEM 序列的步长（km） */
    demStepKm?: number
    /** 该时次 AOD（550 nm 柱总量）；null = 缺测 */
    aod?: number | null
    /** RH 诊断「潜在云区」的阈值（%）；null = 不画 */
    rhSat?: number | null
    /** 是否画降水圆点（地面附近，按降水率 mm/h 分档） */
    showRain?: boolean
  }>(),
  { yMaxKm: 16, mode: 'photo', heightAxis: 'msl', dem: null, demStepKm: 1.25, aod: null, rhSat: null, showRain: false }
)

/* ================= 数据 ================= */

const points = computed<XsecPoint[][]>(() => expandPoints(props.file, props.section))
const distances = computed(() => distanceAxis(props.section))
const terrain = computed(() => terrainProfile(props.section))

/** DEM 地形（真实起伏）；缺测点跳过，不插值、不补 0 */
const demPoints = computed<Array<[number, number]>>(() => {
  const dem = props.dem
  if (!dem || dem.length < 2) return []
  const pts: Array<[number, number]> = []
  dem.forEach((e, i) => { if (typeof e === 'number' && Number.isFinite(e)) pts.push([i * props.demStepKm, e]) })
  return pts.length >= 2 ? pts : []
})
const hasDem = computed(() => demPoints.value.length >= 2)
/** 机位地面海拔：DEM 优先（模式地形是平滑值） */
const groundM = computed(() => (hasDem.value ? demPoints.value[0][1] : (terrain.value[0] ?? 0)))
const totalKm = computed(() => distances.value[distances.value.length - 1] || 50)
const fieldIdx = computed(() => fieldIndex(props.file.levelFields))
const obsTerrainM = computed(() => groundM.value)

/** 层数组：每层把需要的字段取出来（null 保留 null，不当 0） */
interface Level {
  hPa: number
  hM: number | null
  clw: number | null
  ici: number | null
  cf: number | null
  t: number | null
  rh: number | null
  u: number | null
  v: number | null
  w: number | null
  below: boolean
  /** 地面降水率 mm/h（云属判据用）；null = 缺测，不是"没下雨" */
  rain: number | null
}
const levels = computed<Level[][]>(() =>
  points.value.map((col, si) =>
    col.map((p, j) => ({
      hPa: props.file.levelsHpa[j],
      hM: p.hgtM,
      clw: p.clwMgKg,
      ici: p.iciMgKg,
      cf: p.cfPct,
      t: p.tC,
      rh: p.rhPct,
      u: p.uMs,
      v: p.vMs,
      w: p.wPaS,
      below: p.belowGround,
      rain: p.rainMmH ?? null
    }))
  )
)

/** 每层真实的厚度分段：band j 覆盖 [下边界, 上边界]，边界取相邻层高度的中点 */
/**
 * 云带厚度：**每层只是一个采样点**，不是 2–3 km 厚的云块。
 * 所以每层画成一条以层中心为准的细带（≤0.45 km），并单独画出层中心线；
 * 报告云厚时明确说明"受垂直分辨率限制，真实厚度无法优于 ~2.5 km"。
 */
const bandEdges = computed<Array<{ loM: number; hiM: number }>>(() => {
  const h = heightProfile(points.value)[0] ?? []
  const out: Array<{ loM: number; hiM: number }> = []
  for (let j = 0; j < h.length; j++) {
    const cur = h[j]
    if (cur === null) { out.push({ loM: 0, hiM: 0 }); continue }
    const prev = j > 0 ? h[j - 1] : null
    const next = j < h.length - 1 ? h[j + 1] : null
    const gaps = [prev === null ? null : cur - prev, next === null ? null : next - cur].filter((v): v is number => v !== null)
    const gap = gaps.length ? Math.min(...gaps) : 600
    const thick = Math.min(1100, Math.max(260, gap * 0.4))
    out.push({ loM: Math.max(0, cur - thick / 2), hiM: cur + thick / 2 })
  }
  return out
})

/* ================= 主题 ================= */

interface Palette {
  text: string; muted: string; line: string; lineSoft: string
  skyTop: string; skyBottom: string; terrain: string; terrainEdge: string
  gridPx: string; sun: string; accent: string; water: [number, number, number]; ice: [number, number, number]
  cfColor: [number, number, number]
}
const palette = ref<Palette>({
  text: '#e9ecef', muted: '#8f979f', line: 'rgba(255,255,255,0.16)', lineSoft: 'rgba(255,255,255,0.08)',
  skyTop: 'rgba(24,40,66,0.55)', skyBottom: 'rgba(70,58,48,0.35)',
  terrain: 'rgba(126,106,82,0.62)', terrainEdge: 'rgba(214,184,140,0.85)',
  gridPx: 'rgba(160,200,230,0.22)', sun: '#ffd28a', accent: '#4fb3e8',
  water: [70, 198, 205], ice: [178, 150, 240], cfColor: [150, 176, 200]
})

function readPalette(): void {
  const cs = getComputedStyle(document.documentElement)
  const get = (k: string, fb: string) => cs.getPropertyValue(k).trim() || fb
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  palette.value = {
    text: get('--text', '#e9ecef'),
    muted: get('--muted', '#8f979f'),
    line: get('--line-strong', 'rgba(255,255,255,0.18)'),
    lineSoft: get('--line', 'rgba(255,255,255,0.09)'),
    skyTop: light ? 'rgba(196,220,246,0.75)' : 'rgba(20,36,60,0.62)',
    skyBottom: light ? 'rgba(252,226,196,0.75)' : 'rgba(72,56,44,0.42)',
    terrain: light ? 'rgba(150,128,100,0.42)' : 'rgba(126,106,82,0.6)',
    terrainEdge: light ? 'rgba(112,88,58,0.9)' : 'rgba(214,184,140,0.85)',
    gridPx: light ? 'rgba(30,80,120,0.3)' : 'rgba(160,200,230,0.22)',
    sun: light ? '#e08a2e' : '#ffd28a',
    accent: get('--accent-a', '#4fb3e8'),
    water: [70, 198, 205], ice: [178, 150, 240], cfColor: [150, 176, 200]
  }
}

/* ================= 布局 ================= */

const wrap = ref<HTMLDivElement | null>(null)

/**
 * 画布里「当前真正能被看到」的横向范围（画布坐标系，px）。
 *
 * 为什么需要：窄屏时画布 680px、但外面的 .xsec-scroll 只有 ~318px，
 * 用户横向滚动查看不同段落。悬停框如果只按画布边界定位，
 * 算出来的框会落在**屏幕外面**，用户只看到被切掉的一半
 * （2026-11-04 手机实测：框右半截直接跑到屏幕外）。
 *
 * 返回 { lo, hi }：lo = 可见区域左边缘在画布中的 x，hi = 右边缘。
 * 桌面没有横向滚动时就是 [0, cssW]。
 */
function visibleXRange(): { lo: number; hi: number } {
  const el = wrap.value
  if (!el) return { lo: 0, hi: cssW.value }
  /* 往上找可横向滚动的祖先（.xsec-scroll） */
  let scroller: HTMLElement | null = el.parentElement
  while (scroller) {
    const cs = getComputedStyle(scroller)
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && scroller.scrollWidth > scroller.clientWidth + 1) break
    scroller = scroller.parentElement
  }
  if (!scroller) return { lo: 0, hi: cssW.value }
  const wr = el.getBoundingClientRect()
  const sr = scroller.getBoundingClientRect()
  /* 画布左边缘相对可见窗口的偏移量，换算成画布坐标 */
  const lo = Math.max(0, sr.left - wr.left)
  const hi = Math.min(cssW.value, sr.right - wr.left)
  return hi > lo ? { lo, hi } : { lo: 0, hi: cssW.value }
}
const canvas = ref<HTMLCanvasElement | null>(null)
const base = document.createElement('canvas')
const cssW = ref(820)
const cssH = ref(430)

/**
 * 图内字号 / 边距的缩放系数。
 *
 * 为什么需要它：这张图按 820px 设计，所有字号都硬编码成 10–11.5px。
 * 手机「先看全图」把它压到 318px 时，**字号不变、画布变小**，
 * 结果图内说明、色标、坐标轴全部叠在一起（实测截图确认过）。
 * 这里让边距和字号一起按宽度等比缩小，窄图才不会糊成一团。
 * 下限 0.62：再小字就看不清了，那时宁可让它横向滚动。
 */
const scale = computed(() => {
  const k = cssW.value / 820
  return Math.max(0.62, Math.min(1, k))
})
/** 按缩放系数取字号字符串 */
function fs(px: number): string {
  return `${(px * scale.value).toFixed(1)}px system-ui, sans-serif`
}

/* b 给底部留出远场光路带（14 px 带 + 刻度 + 标题） */
const PAD = computed(() => {
  const k = scale.value
  return {
    l: Math.round(56 * k),
    r: Math.round(46 * k),
    t: Math.round(30 * k),
    b: Math.round(82 * k)
  }
})
const plot = computed(() => ({
  x: PAD.value.l, y: PAD.value.t,
  w: Math.max(80, cssW.value - PAD.value.l - PAD.value.r),
  h: Math.max(80, cssH.value - PAD.value.t - PAD.value.b)
}))
const x2px = (d: number) => plot.value.x + (d / totalKm.value) * plot.value.w
const y2px = (km: number) => plot.value.y + (1 - km / props.yMaxKm) * plot.value.h
const px2d = (px: number) => ((px - plot.value.x) / plot.value.w) * totalKm.value
const px2km = (py: number) => (1 - (py - plot.value.y) / plot.value.h) * props.yMaxKm

/** 把海拔(km)换算成当前纵轴基准 */
const toAxis = (mslKm: number): number =>
  props.heightAxis === 'agl' ? mslKm - obsTerrainM.value / 1000 : mslKm
const fromAxis = (axisKm: number): number =>
  props.heightAxis === 'agl' ? axisKm + obsTerrainM.value / 1000 : axisKm
const axisTop = computed(() => toAxis(props.yMaxKm))

/* ================= 云量/色标 ================= */

const BAND_EDGE = 1        // mg/kg，开始着色的下限（= 1e-6 kg/kg）
const BAND_CLOUD = 10      // mg/kg，"可辨识云"
const BAND_THICK = 100     // mg/kg，厚云

function alphaOf(q: number): number {
  if (q < BAND_EDGE * 0.5) return 0
  const t = (Math.log10(Math.max(q, 0.5)) - Math.log10(0.5)) / (Math.log10(400) - Math.log10(0.5))
  return Math.max(0, Math.min(1, t)) * 0.72
}

/** 当前模式下一个层值的"云强度"；null 表示缺测（不得画） */
function modeValue(l: Level): { q: number; color: [number, number, number]; label: string } | null {
  if (props.mode === 'water') {
    if (l.clw === null) return null
    return { q: l.clw, color: palette.value.water, label: '云水' }
  }
  if (props.mode === 'ice') {
    if (l.ici === null) return null
    return { q: l.ici, color: palette.value.ice, label: '云冰' }
  }
  if (props.mode === 'total') {
    if (l.cf === null) return null
    return { q: (l.cf / 100) * 60, color: palette.value.cfColor, label: '总云量' }
  }
  /* photo：总凝结水 + 按液/冰比例混色；两者都缺测才算缺测（一个缺测时用另一个，并标记部分缺测） */
  const hasA = l.clw !== null, hasB = l.ici !== null
  if (!hasA && !hasB) return null
  const q = (l.clw ?? 0) + (l.ici ?? 0)
  const liq = hasA && hasB ? (l.clw as number) / ((l.clw as number) + (l.ici as number) || 1) : (hasA ? 1 : 0)
  const [ir, ig, ib] = palette.value.ice
  const [wr, wg, wb] = palette.value.water
  return {
    q,
    color: [Math.round(ir + (wr - ir) * liq), Math.round(ig + (wg - ig) * liq), Math.round(ib + (wb - ib) * liq)],
    label: '云水+云冰'
  }
}

/* ================= 光路挡光（「有云」不等于「会烧」） ================= */

/**
 * 为什么要有这块：
 *   火烧云 = 高空有云（画布）+ 阳光能穿过大气照到那片云的底部。
 *   只要光路上有一层厚低云/中云挡着，云再多也不烧 —— 这正是
 *   「有云就烧」这个错误的核心。
 *
 *   首页评分那边早就算了两层（低云系数 lowF + 太阳方向柱 horizonBlock，
 *   实测 2026-11-03 海南有高云 100% 但低云 57% → 0 分的机位），
 *   但**剖面图这边没有**：它只画了云在哪，外加地球阴影边界与气溶胶消光，
 *   没有任何「从太阳到这块云的路上有没有被别的云挡住」的判断。
 *   所以这一层是补上这个缺口。
 */

/** 凝结水（云水+云冰）在 (距离 km, 海拔 km) 处的双线性插值；缺测返回 null */
function condensateAt(dKm: number, hKm: number): number | null {
  const ds = distances.value
  const lv = levels.value
  if (ds.length < 2 || !lv.length) return null
  if (dKm < ds[0] - 0.01 || dKm > ds[ds.length - 1] + 0.01) return null

  /** 在同一列的 9 层里按高度做线性插值 */
  const atColumn = (col: Level[] | undefined, h: number): number | null => {
    if (!col || !col.length) return null
    let lo = -1
    for (let j = 0; j < col.length; j++) {
      const hm = col[j].hM
      if (hm === null) continue
      if (hm / 1000 <= h) lo = j
      else break
    }
    if (lo < 0) return null
    const a = col[lo]
    if (a.hM === null) return null
    const qa = (a.clw ?? 0) + (a.ici ?? 0)
    const b = col[lo + 1]
    if (!b || b.hM === null) return qa
    const span = (b.hM - a.hM) / 1000
    if (span <= 0) return qa
    const t = Math.max(0, Math.min(1, (h - a.hM / 1000) / span))
    const qb = (b.clw ?? 0) + (b.ici ?? 0)
    return qa + (qb - qa) * t
  }

  let si = 0
  while (si < ds.length - 2 && ds[si + 1] < dKm) si++
  const span = ds[si + 1] - ds[si]
  const w = span > 0 ? Math.max(0, Math.min(1, (dKm - ds[si]) / span)) : 0
  const qa = atColumn(lv[si], hKm)
  const qb = atColumn(lv[si + 1], hKm)
  if (qa === null) return qb
  if (qb === null) return qa
  return qa * (1 - w) + qb * w
}

/** 厚到能挡光的凝结水阈值（mg/kg）。10 就是图上「可辨识云」那一档。 */
const BLOCK_Q = 10

/**
 * 从 (d, h) 沿「平面内指向太阳」的方向回溯，看光路上有没有厚云。
 * 返回第一块挡住光的云（离目标最近的那块，也就是最直接的原因）。
 *
 * 局限（必须知道）：这是**二维剖面近似**。光线真实方向与剖面平面有夹角时，
 * 挡光判断会偏乐观/悲观；太阳偏离剖面超过 ~25° 时已由界面提示「光线只是投影」。
 */
function lightPathBlock(
  dKm: number,
  hKm: number
): { blocked: boolean; at?: { d: number; hKm: number; q: number } } {
  const t = props.sun.toward
  /* 太阳几乎垂直于剖面时，光路根本不在这一刀里，不能拿平面去判 */
  if (!(Math.abs(t.x) > 0.15)) return { blocked: false }

  const stepKm = 4
  for (let s = stepKm; s <= 340; s += stepKm) {
    const d = dKm + t.x * s
    const h = hKm + t.y * s
    if (d < 0 || d > 320) break
    if (h > 22 || h < -0.5) break
    const q = condensateAt(d, h)
    if (q !== null && q >= BLOCK_Q) return { blocked: true, at: { d, hKm: h, q } }
  }
  return { blocked: false }
}

/* ================= 等值线 ================= */

type Grid = Array<Array<number | null>>
function contour(grid: Grid, level: number, nx: number, ny: number): Array<[number, number, number, number]> {
  const seg: Array<[number, number, number, number]> = []
  const at = (j: number, i: number): number | null => {
    const v = grid[j]?.[i]
    return v === null || v === undefined || !Number.isFinite(v) ? null : v
  }
  const lerp = (a: number, b: number) => (level - a) / (b - a)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = at(j, i), v10 = at(j, i + 1), v01 = at(j + 1, i), v11 = at(j + 1, i + 1)
      if (v00 === null || v10 === null || v01 === null || v11 === null) continue
      const code = (v00 > level ? 1 : 0) | (v10 > level ? 2 : 0) | (v01 > level ? 4 : 0) | (v11 > level ? 8 : 0)
      if (code === 0 || code === 15) continue
      const eT = (): [number, number] => [i + lerp(v00, v10), j]
      const eR = (): [number, number] => [i + 1, j + lerp(v10, v11)]
      const eB = (): [number, number] => [i + lerp(v01, v11), j + 1]
      const eL = (): [number, number] => [i, j + lerp(v00, v01)]
      const push = (a: [number, number], b: [number, number]) => seg.push([a[0], a[1], b[0], b[1]])
      switch (code) {
        case 1: case 14: push(eL(), eT()); break
        case 2: case 13: push(eT(), eR()); break
        case 3: case 12: push(eL(), eR()); break
        case 4: case 11: push(eL(), eB()); break
        case 6: case 9: push(eT(), eB()); break
        case 7: case 8: push(eB(), eR()); break
        case 5: push(eL(), eT()); push(eB(), eR()); break
        case 10: push(eT(), eR()); push(eL(), eB()); break
        default: break
      }
    }
  }
  return seg
}

/* ================= 主绘制 ================= */

/**
 * RH 诊断「潜在云区」底纹（任务书 P2）。
 *
 * ⚠ 这不是云：RH 是按网格点诊断的相对湿度，模式里真正的水物质是 CLWMR/ICMR。
 *   两者可以不一致（高湿无云、低湿有云都会发生），所以这里只用**极淡的斜纹/底色**，
 *   并放在云场之下，不抢云的视觉优先级。
 *   阈值可调（默认 90%），因为「多少湿度算可能成云」没有唯一答案。
 */
function drawRhSaturation(ctx: CanvasRenderingContext2D): void {
  const thr = props.rhSat
  if (thr === null || !Number.isFinite(thr)) return
  const p = plot.value
  const iw = Math.round(p.w)
  ctx.save()
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  for (let px = 0; px < iw; px++) {
    const d = (px / (iw - 1)) * totalKm.value
    const dsArr = distances.value
    let si = 0
    while (si < dsArr.length - 2 && dsArr[si + 1] < d) si++
    const w = Math.max(0, Math.min(1, (d - dsArr[si]) / (dsArr[si + 1] - dsArr[si] || 1)))
    for (let j = 0; j < bandEdges.value.length; j++) {
      const a = levels.value[si]?.[j]
      const b = levels.value[si + 1]?.[j]
      /* 缺测不参与插值：只有一侧有值就按那一侧，两侧都缺测就跳过（不当 0） */
      const va = a && a.rh !== null && !a.below ? a.rh : null
      const vb = b && b.rh !== null && !b.below ? b.rh : null
      const rh = va === null && vb === null ? null : (va === null ? vb : vb === null ? va : va * (1 - w) + vb * w)
      if (rh === null || rh < thr) continue
      const edge = bandEdges.value[j]
      const y0 = Math.max(p.y, Math.min(p.y + p.h, y2px(toAxis(edge.hiM / 1000))))
      const y1 = Math.max(p.y, Math.min(p.y + p.h, y2px(toAxis(edge.loM / 1000))))
      if (y1 - y0 < 0.4) continue
      /* 湿度越接近 100% 越实一点，但整体保持很淡 */
      const alpha = 0.05 + 0.09 * Math.min(1, Math.max(0, (rh - thr) / Math.max(5, 100 - thr)))
      ctx.fillStyle = `rgba(206,232,255,${alpha.toFixed(3)})`
      ctx.fillRect(p.x + px, y0, 1, y1 - y0)
    }
  }
  ctx.restore()
}

/** 点 (剖面距离 d, 海拔 h) 此刻是否处于几何直射光中（太阳方位按 cosΔ 投影到剖面） */
function litNowAt(dKm: number, hM: number): boolean {
  const sun = props.sun
  if (!Number.isFinite(sun.el)) return false
  const dSun = dKm * Math.cos((sun.deviationDeg * Math.PI) / 180)
  return litAt(hM, dSun, sun.el)
}

/**
 * 夕阳照明边界（地球阴影上缘）。
 * 边界高度 = light.boundaryHeightKm(l, 太阳高度角, 太阳方位−剖面方位)；
 * 边界以下 = 几何上处于地球阴影中。这是**球面几何**结果，不含云遮挡与辐射传输。
 */
function drawShadowRegion(ctx: CanvasRenderingContext2D): void {
  const sun = props.sun
  if (!Number.isFinite(sun.el) || !Number.isFinite(sun.deviationDeg)) return
  const p = plot.value
  const topKm = props.yMaxKm
  const CURVE_MAX = topKm * 1.6
  const pts: Array<[number, number]> = []
  const steps = 200
  for (let k = 0; k <= steps; k++) {
    const d = (k / steps) * totalKm.value
    const hb = boundaryHeightKm(d, sun.el, sun.deviationDeg)
    if (hb > 0 && hb <= CURVE_MAX) pts.push([d, hb])
  }
  if (pts.length < 2) return
  ctx.save()
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  /* 阴影区填充：底部 → 边界曲线 */
  ctx.beginPath()
  ctx.moveTo(x2px(pts[0][0]), p.y + p.h)
  for (const [d, hb] of pts) ctx.lineTo(x2px(d), y2px(toAxis(hb)))
  ctx.lineTo(x2px(pts[pts.length - 1][0]), p.y + p.h)
  ctx.closePath()
  ctx.fillStyle = 'rgba(10,16,28,0.34)'
  ctx.fill()
  /* 边界虚线 */
  ctx.beginPath()
  pts.forEach(([d, hb], i) => {
    const xx = x2px(d)
    const yy = y2px(toAxis(hb))
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy)
  })
  ctx.strokeStyle = 'rgba(255,178,112,0.9)'
  ctx.lineWidth = 1.4
  ctx.setLineDash([5, 3])
  ctx.stroke()
  ctx.setLineDash([])
  /* 标签：放在曲线中段上方 */
  const mid = pts[Math.floor(pts.length * 0.55)]
  const lx = Math.min(p.x + p.w - 8, x2px(mid[0]) + 8)
  const ly = Math.max(p.y + 12, y2px(toAxis(mid[1])) - 6)
  ctx.font = fs(10.5)
  ctx.fillStyle = 'rgba(255,196,140,0.95)'
  ctx.textAlign = 'left'
  ctx.fillText('夕阳照明边界', lx, ly)
  ctx.fillStyle = 'rgba(255,196,140,0.6)'
  ctx.fillText('（边界以下在地球阴影里）', lx, ly + 12)
  ctx.restore()
}

/**
 * canvas 的像素比上限。
 * 性能模式下封到 1：剖面图是大面积渐变+网格，2 倍屏下绘制量是 1 倍屏的 4 倍，
 * 在低端手机上这就是卡顿的主因。文字会比标准模式略软，但读数仍然清楚。
 */
function pixelRatio(): number {
  const cap = document.documentElement.getAttribute('data-perf') === 'on' ? 1 : 2
  return Math.min(window.devicePixelRatio || 1, cap)
}

function drawBase(): void {
  const ctx = base.getContext('2d')
  if (!ctx) return
  const dpr = pixelRatio()
  const W = cssW.value, H = cssH.value
  base.width = Math.round(W * dpr)
  base.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const p = plot.value
  const pal = palette.value
  const top = axisTop.value

  /* 天空背景：上蓝下暖（纯装饰，不承载任何数据） */
  const sky = ctx.createLinearGradient(0, p.y, 0, p.y + p.h)
  sky.addColorStop(0, pal.skyTop)
  sky.addColorStop(1, pal.skyBottom)
  ctx.fillStyle = sky
  ctx.fillRect(p.x, p.y, p.w, p.h)

  /* 地球阴影 / 夕阳照明边界：必须在云之前画（云落在阴影里也仍然可见） */
  drawShadowRegion(ctx)

  /* RH 诊断「潜在云区」底纹：也不是云，只是「模式湿度高到可能成云」的区域 */
  drawRhSaturation(ctx)

  /* ---- 云场：按模式层真实厚度逐列绘制（横向线性插值，纵向不平滑）---- */
  ctx.save()
  ctx.beginPath()
  ctx.rect(p.x, p.y, p.w, p.h)
  ctx.clip()
  const iw = Math.round(p.w)
  const levelsN = bandEdges.value.length
  for (let px = 0; px < iw; px++) {
    const d = (px / (iw - 1)) * totalKm.value
    /* 该列左右两个采样点与权重 */
    const dsArr = distances.value
    let si = 0
    while (si < dsArr.length - 2 && dsArr[si + 1] < d) si++
    const w = Math.max(0, Math.min(1, (d - dsArr[si]) / (dsArr[si + 1] - dsArr[si] || 1)))
    for (let j = 0; j < levelsN; j++) {
      const a = modeValue(levels.value[si]?.[j])
      const b = modeValue(levels.value[si + 1]?.[j])
      if (!a && !b) continue
      const q = a && b ? a.q * (1 - w) + b.q * w : (a ? a.q * (1 - w) : (b as { q: number }).q * w)
      const alpha = alphaOf(q)
      if (alpha <= 0.012) continue
      const colA = a?.color ?? (b as { color: [number, number, number] }).color
      const colB = b?.color ?? (a as { color: [number, number, number] }).color
      const r = Math.round(colA[0] * (1 - w) + colB[0] * w)
      const g = Math.round(colA[1] * (1 - w) + colB[1] * w)
      const bl = Math.round(colA[2] * (1 - w) + colB[2] * w)
      const edge = bandEdges.value[j]
      const yHi = y2px(toAxis(edge.hiM / 1000))
      const yLo = y2px(toAxis(edge.loM / 1000))
      if (yLo <= p.y || yHi >= p.y + p.h) {
        /* 越过上下边界时裁剪，避免把云画到坐标轴外 */
      }
      const y0 = Math.max(p.y, Math.min(p.y + p.h, yHi))
      const y1 = Math.max(p.y, Math.min(p.y + p.h, yLo))
      if (y1 - y0 < 0.4) continue
      ctx.fillStyle = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`
      ctx.fillRect(p.x + px, y0, 1, y1 - y0)
      /* 几何受光：只加一层很淡的暖色，不改变云的变量颜色（图例里说明） */
      if (litNowAt(d, (edge.loM + edge.hiM) / 2)) {
        ctx.fillStyle = 'rgba(255,196,128,0.085)'
        ctx.fillRect(p.x + px, y0, 1, y1 - y0)
      }
    }
  }
  ctx.restore()

  /* ---- 模式层中心线：强调"每层是一个采样点" ---- */
  ctx.save()
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  ctx.setLineDash([1, 5])
  for (const l of levels.value[0] ?? []) {
    if (l.hM === null) continue
    const y = y2px(toAxis(l.hM / 1000))
    if (y < p.y || y > p.y + p.h) continue
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.restore()

  /* 云底/云顶不再画折线：不同采样点最高有云层可能不同，连线会出现误导性的斜边。
     云层结构改在页面右侧信息卡里按层列出（层中心/厚度上限/峰值）。 */

  /* ---- 等值线 ---- */
  const nx = 60, ny = 40
  const grid = (get: (pt: XsecPoint) => number | null): Grid =>
    regularGrid(points.value, distances.value, terrain.value, top > 0 ? top : props.yMaxKm, nx, ny, (pt) => {
      const v = get(pt)
      return v === null ? null : v
    })
  if (props.layers.rh) {
    const g = grid((pt) => pt.rhPct)
    ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
    for (const lv of [50, 70, 85, 95]) {
      ctx.beginPath()
      ctx.strokeStyle = `rgba(130,215,255,${0.16 + (lv - 50) / 240})`
      ctx.lineWidth = 1
      for (const s of contour(g, lv, nx, ny)) {
        ctx.moveTo(x2px((s[0] / (nx - 1)) * totalKm.value), y2px((s[1] / (ny - 1)) * Math.max(top, props.yMaxKm)))
        ctx.lineTo(x2px((s[2] / (nx - 1)) * totalKm.value), y2px((s[3] / (ny - 1)) * Math.max(top, props.yMaxKm)))
      }
      ctx.stroke()
    }
    ctx.restore()
  }
  if (props.layers.temp) {
    const g = grid((pt) => pt.tC)
    ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
    for (const lv of [-60, -50, -40, -30, -20, -10, 0, 10, 20]) {
      ctx.beginPath()
      ctx.strokeStyle = lv === 0 ? 'rgba(255,170,120,0.7)' : 'rgba(255,170,120,0.3)'
      ctx.lineWidth = 1
      for (const s of contour(g, lv, nx, ny)) {
        ctx.moveTo(x2px((s[0] / (nx - 1)) * totalKm.value), y2px((s[1] / (ny - 1)) * Math.max(top, props.yMaxKm)))
        ctx.lineTo(x2px((s[2] / (nx - 1)) * totalKm.value), y2px((s[3] / (ny - 1)) * Math.max(top, props.yMaxKm)))
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  /* ---- 真实模式格点：虚线 + 底部刻度 ---- */
  ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = pal.gridPx
  ctx.lineWidth = 1
  for (const node of props.section.gridNodes) {
    const x = x2px(node[0])
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke()
  }
  ctx.restore()
  ctx.save()
  ctx.setLineDash([])
  ctx.font = fs(10)
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'center'
  for (const node of props.section.gridNodes) {
    const x = x2px(node[0])
    ctx.fillText('↓', x, p.y + p.h - 4)
  }
  ctx.restore()

  /* ---- 风/垂直速度 ---- */
  if (props.layers.wind) drawWind(ctx)
  if (props.layers.w) drawW(ctx)

  /* ---- 地形 + 观察者 ---- */
  drawTerrain(ctx)

  /* ---- 太阳 ---- */
  drawSun(ctx)

  /* ---- 坐标轴 ---- */
  drawAxes(ctx)

  /* ---- 色标 ---- */
  drawFarField(ctx)
  drawScale(ctx)

  /* ---- 图内固定说明 ---- */
  ctx.save()
  ctx.font = fs(10)
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'left'
  /* ★ 采样点在横向上很不均匀（0–50 km 每 12.5 km 一个，之后是 60–80 km 一个），
     而 GFS 的网格约 28 km。也就是说：
       · 左侧 15% 的宽度里塞了 5 个采样点，但对应的真实格点只有约 2 个
         → 那里的「细节」主要是插值出来的，不是模式真能分辨的东西；
       · 右侧 85% 的宽度只有 4 个采样点，比模式网格还粗
         → 大块平滑、看起来「没云」。
     不说明这一点，用户会以为左边云系细节可信、右边真的晴空。
     这句话就是用来防止这个误读的。 */
  /* 宽度不够时用短版本：长句在窄图上会横穿整幅图、压到右侧色标上
     （手机「先看全图」实测就是这个样子）。 */
  const noteLong =
    '垂直：每层是模式采样点 · 横向：左侧每 12.5 km 一个采样点（比 GFS 约 28 km 网格更密，其间为插值）、右侧约 60–80 km 一个'
  const noteShort = '每层是模式采样点 · 横向左侧 12.5 km 一点（其间为插值）、右侧 60–80 km 一点'
  /* 三档：
     宽图 → 完整说明；中等 → 短说明；窄到连短说明都放不下 → 不画。
     最后一种情况下这段信息并非丢失：图下方「数据来源」卡片里有同样的话，
     而挤在右上角色标上只会两头都读不清。 */
  if (ctx.measureText(noteLong).width <= p.w - 16) {
    ctx.fillText(noteLong, p.x + 8, p.y + 13)
  } else if (ctx.measureText(noteShort).width <= p.w - 110) {
    /* 右边留 110px 给右上角的色标（「≥1 10 100 mg/kg」那块） */
    ctx.fillText(noteShort, p.x + 8, p.y + 13)
  }
  ctx.restore()
}

function drawWind(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  levels.value.forEach((col, si) => {
    for (const l of col) {
      if (l.below || l.hM === null || l.u === null || l.v === null) continue
      const spd = Math.hypot(l.u, l.v)
      if (spd < 0.5) continue
      const x = x2px(distances.value[si])
      const y = y2px(toAxis(l.hM / 1000))
      const len = 6 + Math.min(18, spd)
      ctx.strokeStyle = `rgba(150,230,190,${0.25 + Math.min(0.45, spd / 30)})`
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (l.u / spd) * len, y - (l.v / spd) * len); ctx.stroke()
    }
  })
  ctx.restore()
}

function drawW(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  levels.value.forEach((col, si) => {
    for (const l of col) {
      if (l.below || l.hM === null || l.w === null || Math.abs(l.w) < 0.06) continue
      const x = x2px(distances.value[si])
      const y = y2px(toAxis(l.hM / 1000))
      const up = (l.w as number) < 0
      const r = 2 + Math.min(5, Math.abs(l.w) * 12)
      ctx.fillStyle = up ? 'rgba(120,200,255,0.72)' : 'rgba(255,170,120,0.62)'
      ctx.beginPath()
      if (up) { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y + r * 0.7); ctx.lineTo(x - r * 0.8, y + r * 0.7) }
      else { ctx.moveTo(x, y + r); ctx.lineTo(x + r * 0.8, y - r * 0.7); ctx.lineTo(x - r * 0.8, y - r * 0.7) }
      ctx.closePath(); ctx.fill()
    }
  })
  ctx.restore()
}

function drawTerrain(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  /* 优先用真实 DEM（沿当前方位 41 点）；没有就退回 GFS 模式地形的 5 个采样点并注明 */
  const pts: Array<[number, number]> = hasDem.value
    ? demPoints.value.map(([d, m]) => [x2px(d), y2px(toAxis(m / 1000))] as [number, number])
    : distances.value.map((d, i) => [x2px(d), y2px(toAxis((terrain.value[i] ?? 0) / 1000))] as [number, number])
  if (pts.length < 2) return
  const baseY = y2px(toAxis(0))
  ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.lineTo(pts[pts.length - 1][0], baseY)
  ctx.lineTo(pts[0][0], baseY)
  ctx.closePath()
  ctx.fillStyle = pal.terrain
  ctx.fill()
  ctx.strokeStyle = pal.terrainEdge
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.stroke()
  ctx.restore()

  drawRain(ctx)

  /* 观察者 */
  const ox = x2px(0)
  const oy = y2px(toAxis(groundM.value / 1000))
  ctx.save()
  ctx.fillStyle = palette.value.text
  ctx.beginPath(); ctx.moveTo(ox + 3, oy); ctx.lineTo(ox + 10, oy - 5); ctx.lineTo(ox + 10, oy + 5); ctx.closePath(); ctx.fill()
  ctx.font = fs(10)
  ctx.fillStyle = palette.value.muted
  ctx.textAlign = 'left'
  ctx.fillText(`机位 · ${hasDem.value ? 'DEM 地面' : '模式地形'} ${Math.round(groundM.value)} m`, ox + 13, oy + 3)
  ctx.restore()
}

/**
 * 降水圆点（任务书 P4 的降水表达）。
 *
 * 口径：数据是 GFS 地面降水率 PRATE（mm/h），**不是降水概率**。
 *   · 每个 12.5 km 采样点画一列点，点的大小/密度表示强度（0.1 / 0.5 / 2 / 5 mm/h 四档）；
 *   · 缺测（null）→ 画一个空心"?"标记，绝不画成"没下雨"；
 *   · 点从地面往上堆 0.6 km，表示"这里的降水来自这一列空气"，不是云层高度。
 *   · 不画彩虹判断（彩虹需要太阳—观测者—雨幕的三维关系，二维剖面表达不了）。
 */
function drawRain(ctx: CanvasRenderingContext2D): void {
  if (!props.showRain) return
  const p = plot.value
  const pal = palette.value
  const iw = totalKm.value
  ctx.save()
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  for (const sample of props.section.samples) {
    const col = points.value[props.section.samples.indexOf(sample)]
    const rain = col?.[0]?.rainMmH
    const x = x2px(sample.d)
    const groundKm = sample.terrainM / 1000
    if (rain === null || rain === undefined) {
      /* 缺测：空心问号，明确表示"这里没有降水数据"，不是"没下雨" */
      ctx.strokeStyle = 'rgba(180,200,220,0.55)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath(); ctx.arc(x, y2px(toAxis(groundKm)) - 7, 3.5, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
      ctx.font = fs(8)
      ctx.fillStyle = 'rgba(180,200,220,0.7)'
      ctx.textAlign = 'center'
      ctx.fillText('?', x, y2px(toAxis(groundKm)) - 4)
      continue
    }
    if (rain < 0.02) continue          /* 无有效降水不画点（0.02 mm/h 是模式噪声下限） */
    /* 强度 → 点数与大小。分档按 GFS 实际量级：本区域实测 0–0.84 mm/h，
       所以 0.05/0.15/0.35/0.6 更贴近真实；≥0.6 mm/h 已是明显的雨。 */
    const level = rain >= 0.6 ? 4 : rain >= 0.35 ? 3 : rain >= 0.15 ? 2 : 1
    const rows = 1 + level
    const r = 1.3 + level * 0.6
    const color = level >= 4 ? 'rgba(90,170,255,0.95)'
      : level === 3 ? 'rgba(80,200,230,0.9)'
        : level === 2 ? 'rgba(120,215,190,0.85)'
          : 'rgba(160,215,200,0.75)'
    ctx.fillStyle = color
    for (let k = 0; k < rows; k++) {
      const jitter = ((props.section.samples.indexOf(sample) * 7 + k * 13) % 9) / 9 - 0.5
      const yy = y2px(toAxis(groundKm)) - 5 - k * (r * 2 + 1.2)
      ctx.beginPath(); ctx.arc(x + jitter * 5, yy, r, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.restore()
}

function drawSun(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  const sun = props.sun
  const tx = sun.toward.x
  const ty = sun.toward.y
  if (ty <= 0.001) return
  const axisTopKm = Math.max(axisTop.value, props.yMaxKm)
  const obsAxis = toAxis(terrain.value[0] / 1000)
  const tTop = (axisTopKm - obsAxis) / ty
  const topX = tx * tTop
  const T = transmittance(props.aod, props.sun.el)
  const dim = T === null ? 1 : Math.min(1, 0.4 + 0.6 * T)
  const alpha = (sun.inFront ? 0.95 : 0.3) * dim
  ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2
  for (const off of [0, 1]) {
    const dx = off * 12
    ctx.strokeStyle = `rgba(255,210,138,${alpha * (off === 0 ? 0.6 : 0.25)})`
    ctx.beginPath()
    ctx.moveTo(x2px(topX) + dx, y2px(axisTopKm))
    ctx.lineTo(x2px(topX) - (tx / ty) * axisTopKm + dx, p.y + p.h)
    ctx.stroke()
  }
  ctx.setLineDash([])
  const sx = Math.max(p.x + 8, Math.min(p.x + p.w - 8, x2px(topX)))
  const sy = y2px(axisTopKm) + 2
  ctx.globalAlpha = alpha
  ctx.fillStyle = pal.sun
  ctx.beginPath(); ctx.arc(sx, sy + 10, 6, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = pal.sun; ctx.lineWidth = 1.2
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * 9, sy + 10 + Math.sin(a) * 9); ctx.lineTo(sx + Math.cos(a) * 13, sy + 10 + Math.sin(a) * 13); ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.font = fs(10.5)
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'center'
  const noteX = Math.max(p.x + 140, Math.min(p.x + p.w - 140, sx))
  /* 透过率取整要注意：太阳贴近地平线时 T 可能只有 0.004，
     Math.round(0.4) = 0 → 图上会写「直射透过率 0%」，
     而页面下方「数据来源」面板对同一个数写的是「＜1%」。
     同一份数据两种说法，而且 0% 会被读成「完全没有直射光」这个更强的断言。
     统一成：小于 1% 一律写「＜1%」。 */
  const trText = T === null ? 'AOD 缺测' : T < 0.01 ? '直射透过率 ＜1%' : `直射透过率 ${Math.round(T * 100)}%`
  const note = sun.inFront
    ? `${props.sunDown ? '太阳已落下' : '太阳'} 方位 ${sun.az.toFixed(0)}° · 高度角 ${sun.el.toFixed(1)}° · 剖面内投影 ${sun.inPlaneEl.toFixed(0)}° · ${trText}`
    : `太阳在剖面背后（偏 ${Math.abs(sun.deviationDeg).toFixed(0)}°）— 光线仅为投影 · ${trText}`
  ctx.fillText(note, noteX, sy + 34)
  ctx.restore()
}

function drawAxes(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  const axisTopKm = p.y && props.yMaxKm
  ctx.save()
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + p.h); ctx.lineTo(p.x + p.w, p.y + p.h); ctx.stroke()

  ctx.font = fs(11)
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const step = props.yMaxKm <= 8 ? 2 : 4
  for (let km = 0; km <= props.yMaxKm; km += step) {
    const y = y2px(km)
    ctx.strokeStyle = pal.lineSoft
    ctx.beginPath(); ctx.moveTo(p.x - 4, y); ctx.lineTo(p.x, y); ctx.stroke()
    ctx.fillText(`${km}`, p.x - 7, y)
  }
  ctx.save()
  ctx.translate(13, p.y + p.h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = pal.muted
  ctx.fillText(props.heightAxis === 'agl' ? '离地 km' : '海拔 km (MSL)', 0, 0)
  ctx.restore()
  void axisTopKm

  /* 右侧：气压层刻度 */
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = fs(9.5)
  ctx.fillStyle = pal.muted
  const firstCol = levels.value[0] ?? []
  for (const l of firstCol) {
    if (l.hM === null) continue
    const km = l.hM / 1000
    if (km > props.yMaxKm) continue
    const y = y2px(toAxis(km))
    ctx.strokeStyle = pal.lineSoft
    ctx.beginPath(); ctx.moveTo(p.x + p.w, y); ctx.lineTo(p.x + p.w + 4, y); ctx.stroke()
    ctx.fillText(`${l.hPa}`, p.x + p.w + 7, y)
  }
  /* 底部距离刻度：短剖面每 10 km，320 km 远场每 40 km（否则 32 个标签会挤成一团） */
  const dStep = totalKm.value > 120 ? 40 : 10
  ctx.textAlign = 'center'
  for (let d = 0; d <= totalKm.value + 0.01; d += dStep) {
    const x = x2px(d)
    ctx.strokeStyle = pal.lineSoft
    ctx.beginPath(); ctx.moveTo(x, p.y + p.h); ctx.lineTo(x, p.y + p.h + 4); ctx.stroke()
    ctx.fillText(`${d}`, x, p.y + p.h + 7 + 4)
  }
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'right'
  ctx.fillText('沿剖面方向距离 km →', p.x + p.w, p.y + p.h + 18)
  ctx.restore()
}

/** 图内色标：说明"什么数值开始着色" */
/**
 * 远场光路带（主图底部一条 0–FAR_KM 的横条）。
 *
 * 为什么需要：主剖面最多到 320 km，而夕阳照明边界常在数十到数百 km 外，
 * 经常整条边界都在画面之外。这条带子用**纯几何**（不需要任何气象数据）
 * 把「从这个距离起，地面已经进入地球阴影」画出来，边界会随时间在带子里滑动。
 *
 * 画法：
 *   · 底色 = 受光（暖）；阴影段 = 冷色并加斜纹；
 *   · 竖线标出当前的日落线位置；刻度 0 / 100 / 200 / 400 / 600 / 800 km。
 */
const FAR_KM = 800
const FAR_STEP = 10

function farField() {
  return farFieldLit(FAR_KM, FAR_STEP, props.sun.el)
}

function drawFarField(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  const bandH = 14
  const y0 = p.y + p.h + 34
  const segs = farField()
  if (!segs.length) return
  const xOf = (d: number) => p.x + (d / FAR_KM) * p.w

  ctx.save()
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
  /* 受光段：暖色；阴影段：冷色 + 斜纹 */
  let start = 0
  let cur = segs[0].lit
  const flush = (endKm: number, lit: boolean) => {
    ctx.fillStyle = lit ? 'rgba(255,190,120,0.34)' : 'rgba(96,140,190,0.26)'
    ctx.fillRect(xOf(start), y0, Math.max(1, xOf(endKm) - xOf(start)), bandH)
    if (!lit) {
      ctx.strokeStyle = 'rgba(150,190,235,0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = xOf(start) - bandH; x < xOf(endKm); x += 6) {
        const x1 = Math.max(xOf(start), x)
        const x2 = Math.min(xOf(endKm), x + bandH)
        if (x2 <= x1) continue
        ctx.moveTo(x1, y0 + bandH)
        ctx.lineTo(x2, y0)
      }
      ctx.stroke()
    }
  }
  for (const seg of segs) {
    if (seg.lit !== cur) { flush(seg.d, cur); start = seg.d; cur = seg.lit }
  }
  flush(FAR_KM, cur)
  ctx.restore()

  /* 边框与刻度 */
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.rect(xOf(0), y0, xOf(FAR_KM) - xOf(0), bandH); ctx.stroke()
  ctx.font = fs(9.5)
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'center'
  for (const d of [0, 100, 200, 400, 600, 800]) {
    const x = xOf(d)
    ctx.beginPath(); ctx.moveTo(x, y0 + bandH); ctx.lineTo(x, y0 + bandH + 3); ctx.stroke()
    ctx.fillText(String(d), x, y0 + bandH + 13)
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,196,140,0.85)'
  ctx.fillText('远场：地面是否受直射', p.x, y0 - 4)
  ctx.fillStyle = pal.muted
  ctx.fillText('km', xOf(FAR_KM) + 4, y0 + bandH + 13)

  /* 日落线位置 */
  const lineD = terminatorD()
  if (lineD !== null && Math.abs(lineD) <= FAR_KM) {
    const x = xOf(lineD)
    ctx.strokeStyle = 'rgba(255,178,112,0.95)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 2])
    ctx.beginPath(); ctx.moveTo(x, y0 - 3); ctx.lineTo(x, y0 + bandH + 3); ctx.stroke()
    ctx.setLineDash([])
  }
}

/** 地面日落线在剖面方向上的距离（km），与页面上写的是同一个量 */
function terminatorD(): number | null {
  const el = props.sun.el
  const c = Math.cos((props.sun.deviationDeg * Math.PI) / 180)
  if (!Number.isFinite(el) || Math.abs(c) < 0.15) return null
  return (-el * (Math.PI / 180) * 6371.0088) / c
}

function drawScale(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  const w = 88, h = 8
  const x = p.x + p.w - w - 12
  const y = p.y + 10
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  if (props.mode === 'total') {
    g.addColorStop(0, 'rgba(150,176,200,0)')
    g.addColorStop(0.5, 'rgba(150,176,200,0.35)')
    g.addColorStop(1, 'rgba(150,176,200,0.8)')
  } else if (props.mode === 'water' || props.mode === 'ice') {
    const c = props.mode === 'water' ? pal.water : pal.ice
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0)`)
    g.addColorStop(0.45, `rgba(${c[0]},${c[1]},${c[2]},0.4)`)
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0.85)`)
  } else {
    g.addColorStop(0, 'rgba(120,200,220,0)')
    g.addColorStop(0.45, 'rgba(120,200,220,0.35)')
    g.addColorStop(0.8, 'rgba(160,150,240,0.55)')
    g.addColorStop(1, 'rgba(178,150,240,0.85)')
  }
  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  ctx.font = fs(9.5)
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'left'
  if (props.mode === 'total') {
    ctx.fillText('云量 0%', x, y - 3)
    ctx.textAlign = 'right'
    ctx.fillText('100%', x + w, y - 3)
  } else {
    ctx.fillText('≥1', x, y - 3)
    ctx.textAlign = 'center'
    ctx.fillText('10', x + w / 2, y - 3)
    ctx.textAlign = 'right'
    ctx.fillText('100 mg/kg', x + w, y - 3)
  }
  ctx.restore()
}

/* ================= 悬停 ================= */

interface Hover {
  x: number; y: number; d: number; axisKm: number; mslKm: number
  si: number; li: number; point: XsecPoint
  /** 光标处的插值云强度（与图上颜色同一套算法） */
  interp: { q: number | null; mode: XsecMode }
  /** 最近模式层 */
  nearest: Level
  nearestSi: number
}
const hover = ref<Hover | null>(null)

function nearestSampleIdx(d: number): number {
  let best = 0, bd = Infinity
  distances.value.forEach((v, i) => { const diff = Math.abs(v - d); if (diff < bd) { bd = diff; best = i } })
  return best
}
function nearestLevelIdx(col: Level[], hKm: number): number {
  let li = 0, bd = Infinity
  col.forEach((l, j) => {
    if (l.hM === null) return
    const diff = Math.abs(l.hM / 1000 - hKm)
    if (diff < bd) { bd = diff; li = j }
  })
  return li
}

/**
 * 是否「正在用手指操作」。
 *
 * ★ 不要用 matchMedia('(hover: none)') 判断：那是**一次性**求值，
 *   混合设备（带触摸屏的笔记本）和无头浏览器都会误判 ——
 *   实测桌面会被判成触摸设备，导致鼠标用户也得点一下才出提示框，体验倒退。
 *
 * 正确做法：看**事件自己的 pointerType**。
 * 鼠标移动 → 'mouse'；手指按下 → 'touch'。以「最近一次输入」为准，
 * 混合设备也能自动切换。
 */
const lastPointerType = ref<string>('mouse')
function isTouchInput(): boolean {
  return lastPointerType.value === 'touch'
}

function onMove(ev: PointerEvent): void {
  lastPointerType.value = ev.pointerType || 'mouse'
  const cv = canvas.value
  if (!cv) return
  const r = cv.getBoundingClientRect()
  const x = ((ev.clientX - r.left) / r.width) * cssW.value
  const y = ((ev.clientY - r.top) / r.height) * cssH.value
  const p = plot.value
  if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
    if (hover.value) { hover.value = null; scheduleOverlay() }
    return
  }
  const d = px2d(x)
  const axisKm = px2km(y)
  const mslKm = fromAxis(axisKm)
  const si = nearestSampleIdx(d)
  const col = levels.value[si] ?? []
  const li = nearestLevelIdx(col, mslKm)
  /* 光标处的插值值：与 drawBase 完全同一算法 */
  const dsArr = distances.value
  let s0 = 0
  while (s0 < dsArr.length - 2 && dsArr[s0 + 1] < d) s0++
  const w = Math.max(0, Math.min(1, (d - dsArr[s0]) / (dsArr[s0 + 1] - dsArr[s0] || 1)))
  const la = levels.value[s0]?.[li]
  const lb = levels.value[s0 + 1]?.[li]
  const va = la ? modeValue(la) : null
  const vb = lb ? modeValue(lb) : null
  const q = va && vb ? va.q * (1 - w) + vb.q * w : (va ? va.q * (1 - w) : (vb ? vb.q * w : null))
  const point = points.value[si]?.[li]
  const nearest = col[li]
  if (!nearest) { hover.value = null; scheduleOverlay(); return }
  hover.value = {
    x, y, d, axisKm, mslKm, si, li,
    point,
    interp: { q, mode: props.mode },
    nearest,
    nearestSi: si
  }
  scheduleOverlay()
}
/**
 * 触摸设备上**不要**在 pointerleave 时清空悬停框。
 *
 * 手指一抬就会触发 pointerup/pointerleave，框立刻消失 ——
 * 用户根本来不及读那 8 行数字（手机实测确认）。
 * 所以触摸设备改成「点一下保持」，再点图表别处才更新，点图表外面才关闭。
 */
function onLeave(): void {
  if (isTouchInput()) return
  hover.value = null
  scheduleOverlay()
}

function fmt(v: number | null | undefined, digits = 1, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '缺测'
  return `${Math.round(v * 10 ** digits) / 10 ** digits}${unit}`
}

function drawOverlay(): void {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dpr = pixelRatio()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW.value, cssH.value)
  ctx.drawImage(base, 0, 0, cssW.value, cssH.value)
  const h = hover.value
  if (!h) return
  const p = plot.value
  const pal = palette.value

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(h.x, p.y); ctx.lineTo(h.x, p.y + p.h)
  ctx.moveTo(p.x, h.y); ctx.lineTo(p.x + p.w, h.y); ctx.stroke()
  ctx.setLineDash([])
  /* 最近模式层的位置（横线） */
  if (h.nearest.hM !== null) {
    const yl = y2px(toAxis(h.nearest.hM / 1000))
    ctx.strokeStyle = 'rgba(255,210,138,0.55)'
    ctx.beginPath(); ctx.moveTo(p.x, yl); ctx.lineTo(p.x + p.w, yl); ctx.stroke()
  }
  ctx.restore()

  const lines: string[] = []
  lines.push(`距离 ${h.d.toFixed(1)} km · 海拔 ${(h.mslKm).toFixed(2)} km · 离地 ${(h.mslKm - props.file.spot.terrainM / 1000).toFixed(2)} km`)
  const modeName = props.mode === 'water' ? '云水' : props.mode === 'ice' ? '云冰' : props.mode === 'total' ? '总云量' : '云水+云冰'
  lines.push(`光标处插值（${modeName}）：${h.interp.q === null ? '缺测' : h.interp.q.toFixed(2) + (props.mode === 'total' ? ' 折算' : ' mg/kg')}`)
  lines.push(`最近模式层：${h.nearest.hPa} hPa · ${fmt(h.nearest.hM, 0, ' m')}${h.nearest.below ? '（地下）' : ''} · 距光标 ${Math.abs((h.nearest.hM ?? 0) / 1000 - h.mslKm).toFixed(2)} km`)
  /* 说明「原始值」是哪个采样点的：光标在两点之间时，原始值是「水平最近那个格点」的，
     不是光标正下方的。不加这句，用户会疑惑「原值 1、插值 0.86 差在哪」。 */
  const nearD = distances.value[h.nearestSi]
  lines.push(
    `该层原始值（最近格点 ${nearD === undefined ? '—' : nearD.toFixed(1) + ' km'}）：` +
    `云水 ${fmt(h.nearest.clw)} · 云冰 ${fmt(h.nearest.ici)} mg/kg`
  )
  /* 「该层总云量」容易被读成「整层大气总云量」，实际是 GFS 在该气压层的
     云覆盖（TCDC 分层值）。改成「该层云量」。 */
  lines.push(`该层云量 ${fmt(h.nearest.cf, 0, '%')} · RH ${fmt(h.nearest.rh, 0, '%')} · T ${fmt(h.nearest.t, 1, '°C')}`)
  /* 云属：用 GFS 的真三维云水/云冰判，比只靠云量+湿度更硬。
     判不出来（数据不足）就不显示这一行，不硬猜。 */
  const genus = genusOfLevel({
    hPa: h.nearest.hPa,
    tC: h.nearest.t,
    rhPct: h.nearest.rh,
    clwMgKg: h.nearest.clw,
    iciMgKg: h.nearest.ici,
    cfPct: h.nearest.cf,
    wPaS: h.nearest.w,
    rainMmH: h.nearest.rain
  })
  if (genus) {
    /* 统一写法：学名（英文缩写）。云种有就带上，没有不硬凑。 */
    const sp = genus.species ? ' · ' + genus.species : ''
    const ev = genus.evidence === 'guess' ? '，云水缺测、按云量推断' : ''
    lines.push(`云属：${genusLabel(genus)} · ${genus.familyName}${sp}`)
    lines.push(`　　　${genus.note}${ev}`)
  }
  const cosDev = Math.cos((props.sun.deviationDeg * Math.PI) / 180)
  const litHere = litAt(h.mslKm * 1000, h.d * cosDev, props.sun.el)
  /* 「几何受光」和上方「直射透过率」是两件事：前者不含大气消光，
     后者已经乘上 Beer-Lambert。太阳贴地平线时会出现
     「在太阳直射光中」+「透过率＜1%」同时成立，加这半句免得看着矛盾。

     ★ 太阳在地平线以下（el < 0）却写「在太阳直射光中」看着最反直觉，
     但这是对的：地面日落时，十几公里高的云仍在地球阴影之上、还能被照亮 ——
     这正是「火烧云」的物理基础。必须把这句解释补上，否则读者以为是 bug。 */
  let litText: string
  if (!litHere) {
    litText = '在地球阴影内（几何）'
  } else if (props.sun.el < 0) {
    litText = `在太阳直射光中（几何）——地面已日落（太阳 ${props.sun.el.toFixed(1)}°），` +
      `但 ${(h.mslKm).toFixed(1)} km 高处仍在地球阴影之上，所以还被照亮`
  } else {
    litText = '在太阳直射光中（几何，未计大气消光）'
  }
  lines.push(`光照几何：${litText}`)
  /* 光路挡光：有云 ≠ 会烧。地球阴影只回答「这里在不在阴影里」，
     不回答「阳光到这里的路上有没有被别的云吃掉」——后者才是火烧云的关键。 */
  const block = lightPathBlock(h.d, h.mslKm)
  if (!litHere) {
    lines.push('光路：不适用（此点已在地球阴影内）')
  } else if (!(Math.abs(props.sun.toward.x) > 0.15)) {
    lines.push('光路：无法判断（太阳几乎垂直于剖面，光路不在这一刀里）')
  } else if (block.blocked && block.at) {
    lines.push(
      `光路：⚠ 被挡 — 朝太阳方向 ${block.at.d.toFixed(0)} km、` +
      `${block.at.hKm.toFixed(1)} km 高处有厚云（${block.at.q.toFixed(0)} mg/kg），阳光到不了这里`
    )
  } else {
    lines.push('光路：通透 — 朝太阳方向没有厚云挡着（二维剖面近似）')
  }
  if (props.mode === 'photo' && h.nearest.clw !== null && h.nearest.ici !== null) {
    const tot = (h.nearest.clw ?? 0) + (h.nearest.ici ?? 0)
    lines.push(`液/冰占比：${tot > 0 ? Math.round(((h.nearest.clw as number) / tot) * 100) : 0}% 液`)
  }

  ctx.font = fs(11.5)
  /* 宽度按最长一行算，不再写死 300：
     「地面已日落但高处仍被照亮」那句明显更长，固定宽度会溢出到画布外。 */
  let wBox = 300
  for (const line of lines) {
    const w = ctx.measureText(line).width
    if (w + 22 > wBox) wBox = Math.min(w + 22, cssW.value - 20)
  }
  const hBox = 14 + lines.length * 17
  /* ★ 框必须落在「用户真正能看到的横向范围」内，不是画布范围内。
     窄屏画布 680px、可见只有 ~318px，按画布边界算会让框跑到屏幕外。 */
  const vr = visibleXRange()
  const visW = vr.hi - vr.lo
  /* 框比可见宽度还宽 → 得换行，否则永远显示不全 */
  const tooWide = wBox > visW - 8
  let bx: number
  let by = h.y + 14
  if (tooWide) {
    /* 超宽：贴住可见区域左边，宽度收到可见宽度 */
    wBox = Math.max(140, visW - 8)
    bx = vr.lo + 4
  } else {
    bx = h.x + 14
    if (bx + wBox > vr.hi - 4) bx = h.x - wBox - 14
    if (bx < vr.lo + 4) bx = vr.lo + 4
  }
  if (by + hBox > cssH.value - 6) by = cssH.value - hBox - 6
  if (by < 4) by = 4
  ctx.fillStyle = 'rgba(8,10,12,0.92)'
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.roundRect(bx, by, wBox, hBox, 8); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#dbe3e9'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  /* 逐行绘制；一行放不下就折行（窄屏框宽有限，云属说明那种长句必然要折）。 */
  const innerW = wBox - 20
  let ty = by + 8
  for (const line of lines) {
    if (ctx.measureText(line).width <= innerW) {
      ctx.fillText(line, bx + 10, ty)
      ty += 17
      continue
    }
    /* 按字符折行（中文没有空格可断，只能逐字量） */
    let cur = ''
    for (const ch of line) {
      const next = cur + ch
      if (ctx.measureText(next).width > innerW && cur) {
        ctx.fillText(cur, bx + 10, ty)
        ty += 17
        cur = ch
      } else {
        cur = next
      }
    }
    if (cur) { ctx.fillText(cur, bx + 10, ty); ty += 17 }
  }
}

/* ================= 生命周期 ================= */

let raf = 0
function scheduleOverlay(): void {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; drawOverlay() })
}
function redraw(): void { drawBase(); drawOverlay() }
function resize(): void {
  const el = wrap.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const fsEl = document.fullscreenElement
  const inFull = !!fsEl && (fsEl === el || fsEl.contains(el))
  cssW.value = Math.max(320, Math.round(rect.width))
  cssH.value = inFull ? Math.max(340, Math.round(el.clientHeight || rect.height)) : Math.round(Math.max(320, Math.min(560, rect.width * 0.52)))
  const cv = canvas.value
  if (cv) {
    const dpr = pixelRatio()
    cv.width = Math.round(cssW.value * dpr)
    cv.height = Math.round(cssH.value * dpr)
    cv.style.width = `${cssW.value}px`
    cv.style.height = `${cssH.value}px`
  }
  redraw()
}

let ro: ResizeObserver | null = null
let mo: MutationObserver | null = null
/** 触摸设备：点图表以外的地方关闭悬停框 */
/**
 * 点在图表外面 → 关闭悬停框。
 * 触摸设备上这是**唯一**的关闭方式（手指抬起不再自动关，否则来不及读）。
 * 鼠标设备上原本就是靠 pointerleave 关的，这里只是多一层保险。
 */
function onDocPointerDown(ev: PointerEvent): void {
  const el = wrap.value
  if (!el) return
  if (el.contains(ev.target as Node)) return
  if (hover.value) { hover.value = null; scheduleOverlay() }
}

onMounted(() => {
  readPalette()
  ro = new ResizeObserver(() => resize())
  if (wrap.value) ro.observe(wrap.value)
  mo = new MutationObserver(() => { readPalette(); redraw() })
  /* data-perf 也要监听：性能模式切换会改变 canvas 像素比，
     不重绘的话画布会保持旧的位图尺寸，看起来糊掉或错位。 */
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-perf']
  })
  document.addEventListener('fullscreenchange', resize)
  document.addEventListener('pointerdown', onDocPointerDown)
  resize()
})
onBeforeUnmount(() => {
  ro?.disconnect(); mo?.disconnect()
  document.removeEventListener('fullscreenchange', resize)
  document.removeEventListener('pointerdown', onDocPointerDown)
})
watch(() => [props.section, props.yMaxKm, props.layers, props.sun, props.mode, props.heightAxis, props.dem, props.aod, props.rhSat, props.showRain], () => redraw(), { deep: true })
/* 悬停状态一变就重绘 overlay —— v2 曾漏掉这一步，导致"有十字线、没有提示框" */
watch(hover, () => scheduleOverlay())
</script>

<template>
  <div ref="wrap" class="xsec-chart-wrap">
    <canvas
      ref="canvas"
      class="xsec-canvas"
      @pointermove="onMove"
      @pointerdown="onMove"
      @pointerleave="onLeave"
    />
  </div>
</template>
