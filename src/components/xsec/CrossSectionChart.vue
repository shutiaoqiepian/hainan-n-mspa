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
import { boundaryHeightKm, litAt, transmittance } from '@/lib/xsec/light'
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
  }>(),
  { yMaxKm: 16, mode: 'photo', heightAxis: 'msl', dem: null, demStepKm: 1.25, aod: null }
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
      below: p.belowGround
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
const canvas = ref<HTMLCanvasElement | null>(null)
const base = document.createElement('canvas')
const cssW = ref(820)
const cssH = ref(430)
const PAD = { l: 56, r: 46, t: 30, b: 46 }
const plot = computed(() => ({
  x: PAD.l, y: PAD.t,
  w: Math.max(80, cssW.value - PAD.l - PAD.r),
  h: Math.max(80, cssH.value - PAD.t - PAD.b)
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
  ctx.font = '10.5px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,196,140,0.95)'
  ctx.textAlign = 'left'
  ctx.fillText('夕阳照明边界', lx, ly)
  ctx.fillStyle = 'rgba(255,196,140,0.6)'
  ctx.fillText('（边界以下在地球阴影里）', lx, ly + 12)
  ctx.restore()
}

function drawBase(): void {
  const ctx = base.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
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
  ctx.font = '10px system-ui, sans-serif'
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
  drawScale(ctx)

  /* ---- 图内固定说明 ---- */
  ctx.save()
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'left'
  ctx.fillText('每层是模式采样点（垂直分辨率有限）· 横向格点间为线性插值', p.x + 8, p.y + 13)
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

  /* 观察者 */
  const ox = x2px(0)
  const oy = y2px(toAxis(groundM.value / 1000))
  ctx.save()
  ctx.fillStyle = palette.value.text
  ctx.beginPath(); ctx.moveTo(ox + 3, oy); ctx.lineTo(ox + 10, oy - 5); ctx.lineTo(ox + 10, oy + 5); ctx.closePath(); ctx.fill()
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillStyle = palette.value.muted
  ctx.textAlign = 'left'
  ctx.fillText(`机位 · ${hasDem.value ? 'DEM 地面' : '模式地形'} ${Math.round(groundM.value)} m`, ox + 13, oy + 3)
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
  ctx.font = '10.5px system-ui, sans-serif'
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'center'
  const noteX = Math.max(p.x + 140, Math.min(p.x + p.w - 140, sx))
  const trText = T === null ? 'AOD 缺测' : `直射透过率 ${Math.round(T * 100)}%`
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

  ctx.font = '11px system-ui, sans-serif'
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
  ctx.font = '9.5px system-ui, sans-serif'
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
  ctx.textAlign = 'center'
  for (let d = 0; d <= totalKm.value + 0.01; d += 10) {
    const x = x2px(d)
    ctx.strokeStyle = pal.lineSoft
    ctx.beginPath(); ctx.moveTo(x, p.y + p.h); ctx.lineTo(x, p.y + p.h + 4); ctx.stroke()
    ctx.fillText(`${d}`, x, p.y + p.h + 7 + 4)
  }
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'right'
  ctx.fillText('沿剖面方向距离 km →', p.x + p.w, p.y + p.h + 28)
  ctx.restore()
}

/** 图内色标：说明"什么数值开始着色" */
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
  ctx.font = '9.5px system-ui, sans-serif'
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

function onMove(ev: PointerEvent): void {
  const cv = canvas.value
  if (!cv) return
  const r = cv.getBoundingClientRect()
  const x = ((ev.clientX - r.left) / r.width) * cssW.value
  const y = ((ev.clientY - r.top) / r.height) * cssH.value
  const p = plot.value
  if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) { hover.value = null; return }
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
  const va = modeValue(levels.value[s0]?.[li] ?? null as never)
  const vb = modeValue(levels.value[s0 + 1]?.[li] ?? null as never)
  const q = va && vb ? va.q * (1 - w) + vb.q * w : (va ? va.q * (1 - w) : (vb ? vb.q * w : null))
  const point = points.value[si]?.[li]
  const nearest = col[li]
  hover.value = {
    x, y, d, axisKm, mslKm, si, li,
    point,
    interp: { q, mode: props.mode },
    nearest,
    nearestSi: si
  }
}
function onLeave(): void { hover.value = null }

function fmt(v: number | null | undefined, digits = 1, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '缺测'
  return `${Math.round(v * 10 ** digits) / 10 ** digits}${unit}`
}

function drawOverlay(): void {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
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
  lines.push(`该层原始值：云水 ${fmt(h.nearest.clw)} · 云冰 ${fmt(h.nearest.ici)} mg/kg`)
  lines.push(`该层总云量 ${fmt(h.nearest.cf, 0, '%')} · RH ${fmt(h.nearest.rh, 0, '%')} · T ${fmt(h.nearest.t, 1, '°C')}`)
  const cosDev = Math.cos((props.sun.deviationDeg * Math.PI) / 180)
  const litHere = litAt(h.mslKm * 1000, h.d * cosDev, props.sun.el)
  lines.push(`光照几何：${litHere ? '在太阳直射光中（几何）' : '在地球阴影内（几何）'}`)
  if (props.mode === 'photo' && h.nearest.clw !== null && h.nearest.ici !== null) {
    const tot = (h.nearest.clw ?? 0) + (h.nearest.ici ?? 0)
    lines.push(`液/冰占比：${tot > 0 ? Math.round(((h.nearest.clw as number) / tot) * 100) : 0}% 液`)
  }

  ctx.font = '11.5px system-ui, sans-serif'
  const wBox = 300
  const hBox = 14 + lines.length * 17
  let bx = h.x + 14, by = h.y + 14
  if (bx + wBox > cssW.value - 6) bx = h.x - wBox - 14
  if (by + hBox > cssH.value - 6) by = cssH.value - hBox - 6
  if (by < 4) by = 4
  ctx.fillStyle = 'rgba(8,10,12,0.92)'
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.roundRect(bx, by, wBox, hBox, 8); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#dbe3e9'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  lines.forEach((line, i) => ctx.fillText(line, bx + 10, by + 8 + i * 17))
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = Math.round(cssW.value * dpr)
    cv.height = Math.round(cssH.value * dpr)
    cv.style.width = `${cssW.value}px`
    cv.style.height = `${cssH.value}px`
  }
  redraw()
}

let ro: ResizeObserver | null = null
let mo: MutationObserver | null = null
onMounted(() => {
  readPalette()
  ro = new ResizeObserver(() => resize())
  if (wrap.value) ro.observe(wrap.value)
  mo = new MutationObserver(() => { readPalette(); redraw() })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  document.addEventListener('fullscreenchange', resize)
  resize()
})
onBeforeUnmount(() => {
  ro?.disconnect(); mo?.disconnect()
  document.removeEventListener('fullscreenchange', resize)
})
watch(() => [props.section, props.yMaxKm, props.layers, props.sun, props.mode, props.heightAxis, props.dem, props.aod], () => redraw(), { deep: true })
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
