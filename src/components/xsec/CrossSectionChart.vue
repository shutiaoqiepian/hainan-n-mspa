<script setup lang="ts">
/**
 * 大气水平—垂直截面图（Canvas 2D）。
 *
 * 三条铁律（顺序比美观重要）：
 *   1. 云水/云冰是 GFS 模式预报变量，不是观测；格点之间是双线性插值，插值不提高分辨率。
 *   2. 地形以下不画云（模式在那边没有有效层），画成地下遮罩。
 *   3. 太阳只画「投影到剖面平面」的方向；太阳不在剖面内时降低不透明度并提示偏离角度。
 *
 * 不引入任何图表库：5 个水平采样点 × 9 个气压层，Canvas 2D 足够。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  cloudBands, distanceAxis, expandPoints, fieldIndex, heightProfile,
  liquidShare, regularGrid, terrainProfile, totalCondensateMgKg
} from '@/lib/xsec/model'
import type { SunInPlane } from '@/lib/xsec/sun'
import type { XsecPoint, XsecSection, XsecSpotFile } from '@/lib/xsec/types'

const props = withDefaults(
  defineProps<{
    file: XsecSpotFile
    section: XsecSection
    /** 纵轴上限（km） */
    yMaxKm: number
    layers: { rh: boolean; temp: boolean; wind: boolean; w: boolean }
    sun: SunInPlane
    /** 太阳是否已落下（影响提示文案） */
    sunDown: boolean
  }>(),
  { yMaxKm: 16 }
)

/* ---------------- 数据准备 ---------------- */

const points = computed<XsecPoint[][]>(() => expandPoints(props.file, props.section))
const distances = computed(() => distanceAxis(props.section))
const terrain = computed(() => terrainProfile(props.section))
const heights = computed(() => heightProfile(points.value))
const totalKm = computed(() => distances.value[distances.value.length - 1] || 50)
const fieldIdx = computed(() => fieldIndex(props.file.levelFields))

/** 中心采样点上的连续云层（用于右侧层标签） */
const bands = computed(() => {
  const mid = points.value[Math.floor(points.value.length / 2)] ?? []
  return cloudBands(mid, BAND_CLOUD_MGK)
})

/** 显示分级（kg/kg → mg/kg）：与 CI 里 quality.json 的实测标定一致 */
const BAND_EDGE_MGK = 1
const BAND_CLOUD_MGK = 10
const BAND_THICK_MGK = 100

/* ---------------- 主题色 ---------------- */

interface Palette {
  text: string
  muted: string
  line: string
  lineSoft: string
  surface: string
  terrain: string
  terrainEdge: string
  under: string
  gridPx: string
  sun: string
  accent: string
}
const palette = ref<Palette>({
  text: '#e9ecef', muted: '#8f979f', line: 'rgba(255,255,255,0.14)',
  lineSoft: 'rgba(255,255,255,0.07)', surface: '#101214',
  terrain: 'rgba(150,128,100,0.55)', terrainEdge: 'rgba(196,170,130,0.9)',
  under: 'rgba(90,82,72,0.22)', gridPx: 'rgba(160,200,230,0.20)',
  sun: '#ffd28a', accent: '#4fb3e8'
})

function readPalette(): void {
  const cs = getComputedStyle(document.documentElement)
  const get = (k: string, fb: string) => {
    const v = cs.getPropertyValue(k).trim()
    return v || fb
  }
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  palette.value = {
    text: get('--text', '#e9ecef'),
    muted: get('--muted', '#8f979f'),
    line: get('--line-strong', 'rgba(255,255,255,0.18)'),
    lineSoft: get('--line', 'rgba(255,255,255,0.09)'),
    surface: light ? 'rgba(255,255,255,0.55)' : 'rgba(10,12,14,0.45)',
    terrain: light ? 'rgba(150,128,100,0.45)' : 'rgba(150,128,100,0.5)',
    terrainEdge: light ? 'rgba(120,96,64,0.85)' : 'rgba(206,180,140,0.9)',
    under: light ? 'rgba(120,104,86,0.14)' : 'rgba(90,82,72,0.24)',
    gridPx: light ? 'rgba(40,90,130,0.28)' : 'rgba(160,200,230,0.22)',
    sun: light ? '#e08a2e' : '#ffd28a',
    accent: get('--accent-a', '#4fb3e8')
  }
}

/* ---------------- 布局 ---------------- */

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const base = document.createElement('canvas')
const cssW = ref(820)
const cssH = ref(430)

const PAD = { l: 54, r: 16, t: 26, b: 42 }
const plot = computed(() => ({
  x: PAD.l,
  y: PAD.t,
  w: Math.max(80, cssW.value - PAD.l - PAD.r),
  h: Math.max(80, cssH.value - PAD.t - PAD.b)
}))

function x2px(d: number): number {
  return plot.value.x + (d / totalKm.value) * plot.value.w
}
function y2px(km: number): number {
  return plot.value.y + (1 - km / props.yMaxKm) * plot.value.h
}
function px2d(px: number): number {
  return ((px - plot.value.x) / plot.value.w) * totalKm.value
}
function px2km(py: number): number {
  return (1 - (py - plot.value.y) / plot.value.h) * props.yMaxKm
}

/* ---------------- 云场像素渲染 ---------------- */

/** 把某个采样点垂直廓线在高度 h(km) 上的凝结水取出来（线性插值；地形以下/顶层以上为 null） */
function profileAt(si: number, hKm: number): { q: number; liquid: number; estimated: boolean } | null {
  const hs = heights.value[si]
  const col = points.value[si]
  if (!hs || !col) return null
  const zm = hKm * 1000
  if (zm < terrain.value[si]) return null
  let k = -1
  for (let j = 0; j < hs.length; j++) {
    const hv = hs[j]
    if (hv === null || col[j].belowGround) continue
    if (hv <= zm) k = j
  }
  if (k < 0) return null
  let k2 = -1
  for (let j = k + 1; j < hs.length; j++) {
    const hv = hs[j]
    if (hv === null || col[j].belowGround) continue
    k2 = j
    break
  }
  const q1 = valueOf(col[k])
  if (k2 < 0) {
    /* 最高一层之上没有数据：绝不能把顶层的值往上拉，
       那会把 12 km 的卷云画到 16 km 去（看图会以为是实测厚度）。 */
    if (zm > (hs[k] as number) + 1) return null
    return q1
  }
  const h1 = hs[k] as number
  const h2 = hs[k2] as number
  const w = h2 > h1 ? (zm - h1) / (h2 - h1) : 0
  const q2 = valueOf(col[k2])
  return {
    q: q1.q * (1 - w) + q2.q * w,
    liquid: q1.liquid * (1 - w) + q2.liquid * w,
    estimated: q1.estimated || q2.estimated
  }
}

/**
 * 某层在某个高度上的「云强度」。
 * GFS：总凝结水（液+冰）mg/kg，原生变量。
 * Open-Meteo：没有云水 → 用云量 % 映射到同一套透明度刻度，并标记 estimated。
 */
function valueOf(p: XsecPoint): { q: number; liquid: number; estimated: boolean } {
  const q = totalCondensateMgKg(p)
  if (q !== null) return { q, liquid: liquidShare(p), estimated: false }
  const cf = p.cfPct
  if (cf !== null) {
    /* 0–100% 映射到 0.5–400 的对数刻度，与 GFS 的透明度刻度对齐 */
    const lo = Math.log10(0.5)
    const hi = Math.log10(400)
    const qPseudo = 10 ** (lo + (Math.max(0, Math.min(100, cf)) / 100) * (hi - lo))
    return { q: qPseudo, liquid: 0.5, estimated: true }
  }
  return { q: 0, liquid: 0.5, estimated: false }
}

/** 沿路径把两个采样点之间线性混合（插值，不是观测） */
function cloudAt(d: number, hKm: number): { q: number; liquid: number; estimated: boolean } | null {
  const ds = distances.value
  let si = 0
  while (si < ds.length - 2 && ds[si + 1] < d) si++
  const span = ds[si + 1] - ds[si] || 1
  const w = Math.max(0, Math.min(1, (d - ds[si]) / span))
  const a = profileAt(si, hKm)
  const b = profileAt(si + 1, hKm)
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return {
    q: a.q * (1 - w) + b.q * w,
    liquid: a.liquid * (1 - w) + b.liquid * w,
    estimated: a.estimated || b.estimated
  }
}

function alphaOf(q: number): number {
  if (q < BAND_EDGE_MGK * 0.5) return 0
  const t = (Math.log10(Math.max(q, 0.5)) - Math.log10(0.5)) / (Math.log10(400) - Math.log10(0.5))
  return Math.max(0, Math.min(1, t)) * 0.62
}

function cloudColor(liquid: number, estimated: boolean): [number, number, number] {
  /* 液水：青绿；冰水：紫白；Open-Meteo 的 RH 诊断云量：冷灰蓝（一眼能看出不是同一类数据） */
  if (estimated) return [150, 176, 200]
  const liq: [number, number, number] = [72, 200, 205]
  const ice: [number, number, number] = [178, 150, 240]
  return [
    Math.round(ice[0] + (liq[0] - ice[0]) * liquid),
    Math.round(ice[1] + (liq[1] - ice[1]) * liquid),
    Math.round(ice[2] + (liq[2] - ice[2]) * liquid)
  ]
}

/* ---------------- 等值线（marching squares） ---------------- */

type Grid = Array<Array<number | null>>

function contour(grid: Grid, level: number, nx: number, ny: number): Array<[number, number, number, number]> {
  const seg: Array<[number, number, number, number]> = []
  const at = (j: number, i: number): number | null => {
    const row = grid[j]
    if (!row) return null
    const v = row[i]
    return v === null || !Number.isFinite(v) ? null : v
  }
  const lerp = (a: number, b: number) => (level - a) / (b - a)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = at(j, i)
      const v10 = at(j, i + 1)
      const v01 = at(j + 1, i)
      const v11 = at(j + 1, i + 1)
      if (v00 === null || v10 === null || v01 === null || v11 === null) continue
      /* 四个角相对 level 的符号；用 bitmask 走标准 16 种情形 */
      const b00 = v00 > level ? 1 : 0
      const b10 = v10 > level ? 2 : 0
      const b01 = v01 > level ? 4 : 0
      const b11 = v11 > level ? 8 : 0
      const code = b00 | b10 | b01 | b11
      if (code === 0 || code === 15) continue
      const edgeT = (): [number, number] => [i + lerp(v00, v10), j]
      const edgeR = (): [number, number] => [i + 1, j + lerp(v10, v11)]
      const edgeB = (): [number, number] => [i + lerp(v01, v11), j + 1]
      const edgeL = (): [number, number] => [i, j + lerp(v00, v01)]
      const push = (a: [number, number], b: [number, number]) => seg.push([a[0], a[1], b[0], b[1]])
      switch (code) {
        case 1: case 14: push(edgeL(), edgeT()); break
        case 2: case 13: push(edgeT(), edgeR()); break
        case 3: case 12: push(edgeL(), edgeR()); break
        case 4: case 11: push(edgeL(), edgeB()); break
        case 6: case 9: push(edgeT(), edgeB()); break
        case 7: case 8: push(edgeB(), edgeR()); break
        case 5: push(edgeL(), edgeT()); push(edgeB(), edgeR()); break
        case 10: push(edgeT(), edgeR()); push(edgeL(), edgeB()); break
        default: break
      }
    }
  }
  return seg
}

/* ---------------- 主绘制 ---------------- */

function drawBase(): void {
  const ctx = base.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = cssW.value
  const H = cssH.value
  base.width = Math.round(W * dpr)
  base.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const p = plot.value
  const pal = palette.value
  const yMax = props.yMaxKm

  /* 背景 */
  ctx.fillStyle = pal.surface
  ctx.fillRect(p.x, p.y, p.w, p.h)

  /* 1) 云场（像素级；横向在采样点之间线性混合，纵向在气压层之间线性混合） */
  const img = ctx.createImageData(Math.round(p.w), Math.round(p.h))
  const data = img.data
  const iw = Math.round(p.w)
  const ih = Math.round(p.h)
  for (let py = 0; py < ih; py++) {
    const hKm = (1 - py / (ih - 1)) * yMax
    for (let px = 0; px < iw; px++) {
      const d = (px / (iw - 1)) * totalKm.value
      const c = cloudAt(d, hKm)
      if (!c) continue
      const a = alphaOf(c.q)
      if (a <= 0.01) continue
      const [r, g, b] = cloudColor(c.liquid, c.estimated)
      const o = (py * iw + px) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = Math.round(a * 255)
    }
  }
  const tmp = document.createElement('canvas')
  tmp.width = iw
  tmp.height = ih
  tmp.getContext('2d')?.putImageData(img, 0, 0)
  ctx.drawImage(tmp, p.x, p.y, p.w, p.h)

  /* 2) 地形以下遮罩（模式在这些层没有有效数据，不能画成晴空） */
  ctx.save()
  ctx.beginPath()
  ctx.rect(p.x, p.y, p.w, p.h)
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(x2px(0), y2px(terrain.value[0] / 1000))
  for (let i = 1; i < distances.value.length; i++) {
    ctx.lineTo(x2px(distances.value[i]), y2px(terrain.value[i] / 1000))
  }
  ctx.lineTo(x2px(totalKm.value), p.y + p.h)
  ctx.lineTo(x2px(0), p.y + p.h)
  ctx.closePath()
  ctx.fillStyle = pal.terrain
  ctx.fill()
  ctx.strokeStyle = pal.terrainEdge
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x2px(0), y2px(terrain.value[0] / 1000))
  for (let i = 1; i < distances.value.length; i++) {
    ctx.lineTo(x2px(distances.value[i]), y2px(terrain.value[i] / 1000))
  }
  ctx.save()
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = pal.under
  for (let k = 1; k < 8; k++) {
    const xx = (totalKm.value * k) / 8
    ctx.beginPath()
    ctx.moveTo(x2px(xx), y2px((terrain.value[Math.min(terrain.value.length - 1, Math.round((k / 8) * (terrain.value.length - 1)))] as number) / 1000))
    ctx.lineTo(x2px(xx), p.y + p.h)
    ctx.stroke()
  }
  ctx.restore()
  ctx.restore()

  /* 3) 等值线图层 */
  const nx = 60
  const ny = 40
  const g = (get: (pt: XsecPoint) => number | null): Grid =>
    regularGrid(points.value, distances.value, terrain.value, yMax, nx, ny, get)

  if (props.layers.rh) {
    const grid = g((pt) => pt.rhPct)
    ctx.save()
    ctx.beginPath()
    ctx.rect(p.x, p.y, p.w, p.h)
    ctx.clip()
    ctx.lineWidth = 1
    for (const lv of [50, 70, 85, 95]) {
      ctx.beginPath()
      ctx.strokeStyle = `rgba(120,210,255,${0.18 + (lv - 50) / 260})`
      for (const s of contour(grid, lv, nx, ny)) {
        ctx.moveTo(x2px((s[0] / (nx - 1)) * totalKm.value), y2px((s[1] / (ny - 1)) * yMax))
        ctx.lineTo(x2px((s[2] / (nx - 1)) * totalKm.value), y2px((s[3] / (ny - 1)) * yMax))
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  if (props.layers.temp) {
    const grid = g((pt) => pt.tC)
    ctx.save()
    ctx.beginPath()
    ctx.rect(p.x, p.y, p.w, p.h)
    ctx.clip()
    ctx.lineWidth = 1
    ctx.font = '10px system-ui, sans-serif'
    for (const lv of [-60, -50, -40, -30, -20, -10, 0, 10, 20]) {
      ctx.beginPath()
      ctx.strokeStyle = lv === 0 ? 'rgba(255,170,120,0.75)' : 'rgba(255,170,120,0.32)'
      const seg = contour(grid, lv, nx, ny)
      for (const s of seg) {
        ctx.moveTo(x2px((s[0] / (nx - 1)) * totalKm.value), y2px((s[1] / (ny - 1)) * yMax))
        ctx.lineTo(x2px((s[2] / (nx - 1)) * totalKm.value), y2px((s[3] / (ny - 1)) * yMax))
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  /* 4) 真实格点虚线（模式原始网格，不是插值结果） */
  ctx.save()
  ctx.beginPath()
  ctx.rect(p.x, p.y, p.w, p.h)
  ctx.clip()
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = pal.gridPx
  ctx.lineWidth = 1
  for (const node of props.section.gridNodes) {
    const x = x2px(node[0])
    ctx.beginPath()
    ctx.moveTo(x, p.y)
    ctx.lineTo(x, p.y + p.h)
    ctx.stroke()
  }
  ctx.restore()

  /* 5) 风矢量 */
  if (props.layers.wind) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(p.x, p.y, p.w, p.h)
    ctx.clip()
    for (let si = 0; si < points.value.length; si++) {
      const col = points.value[si]
      for (const pt of col) {
        if (pt.belowGround || pt.hgtM === null) continue
        const u = pt.uMs
        const v = pt.vMs
        if (u === null || v === null) continue
        const spd = Math.hypot(u, v)
        if (spd < 0.5) continue
        const x = x2px(distances.value[si])
        const y = y2px(pt.hgtM / 1000)
        const len = 6 + Math.min(20, spd * 1.1)
        ctx.strokeStyle = `rgba(150,230,190,${0.22 + Math.min(0.5, spd / 30)})`
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + (u / spd) * len, y - (v / spd) * len)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /* 6) 垂直速度（w>0 下沉，w<0 上升；GFS 原生 Pa/s） */
  if (props.layers.w) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(p.x, p.y, p.w, p.h)
    ctx.clip()
    for (let si = 0; si < points.value.length; si++) {
      for (const pt of points.value[si]) {
        if (pt.belowGround || pt.hgtM === null || pt.wPaS === null) continue
        const w = pt.wPaS
        if (Math.abs(w) < 0.06) continue
        const x = x2px(distances.value[si])
        const y = y2px(pt.hgtM / 1000)
        const up = w < 0
        const r = 2 + Math.min(5, Math.abs(w) * 12)
        ctx.fillStyle = up ? 'rgba(120,200,255,0.75)' : 'rgba(255,170,120,0.65)'
        ctx.beginPath()
        if (up) {
          ctx.moveTo(x, y - r)
          ctx.lineTo(x + r * 0.8, y + r * 0.7)
          ctx.lineTo(x - r * 0.8, y + r * 0.7)
        } else {
          ctx.moveTo(x, y + r)
          ctx.lineTo(x + r * 0.8, y - r * 0.7)
          ctx.lineTo(x - r * 0.8, y - r * 0.7)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /* 7) 太阳（只画投影到剖面的方向） */
  drawSun(ctx)

  /* 8) 坐标轴 */
  drawAxes(ctx)

  /* 9) 云层标注（右边缘，只有中心采样点有云时才标） */
  ctx.save()
  ctx.beginPath()
  ctx.rect(p.x, p.y, p.w, p.h)
  ctx.clip()
  ctx.font = '10px system-ui, sans-serif'
  for (const b of bands.value) {
    const y1 = y2px(b.fromKm)
    const y2 = y2px(b.toKm)
    if (y2 - y1 < 8) continue
    ctx.fillStyle = b.estimated
      ? 'rgba(150,176,200,0.8)'
      : (b.liquid ? 'rgba(110,220,220,0.75)' : 'rgba(190,165,245,0.8)')
    ctx.fillRect(p.x + p.w - 3, y2, 3, y1 - y2)
    if (b.peakMgKg >= BAND_CLOUD_MGK) {
      ctx.fillStyle = palette.value.muted
      ctx.textAlign = 'right'
      ctx.fillText(`${b.toHpa}–${b.fromHpa} hPa`, p.x + p.w - 7, (y1 + y2) / 2 + 3)
    }
  }
  ctx.restore()
}

function drawAxes(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  const yMax = props.yMaxKm
  ctx.save()
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(p.x, p.y + p.h)
  ctx.lineTo(p.x + p.w, p.y + p.h)
  ctx.stroke()

  ctx.fillStyle = pal.muted
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'

  /* 纵轴：海拔 km */
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const yStep = yMax <= 8 ? 2 : 4
  for (let km = 0; km <= yMax; km += yStep) {
    const y = y2px(km)
    ctx.strokeStyle = pal.lineSoft
    ctx.beginPath()
    ctx.moveTo(p.x - 4, y)
    ctx.lineTo(p.x, y)
    ctx.stroke()
    ctx.fillText(`${km}`, p.x - 7, y)
  }
  ctx.save()
  ctx.translate(13, p.y + p.h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = pal.muted
  ctx.fillText('海拔 km', 0, 0)
  ctx.restore()

  /* 横轴：距观察者 km */
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let d = 0; d <= totalKm.value + 0.01; d += 10) {
    const x = x2px(d)
    ctx.strokeStyle = pal.lineSoft
    ctx.beginPath()
    ctx.moveTo(x, p.y + p.h)
    ctx.lineTo(x, p.y + p.h + 4)
    ctx.stroke()
    ctx.fillText(`${d}`, x, p.y + p.h + 7)
  }
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'right'
  ctx.fillText('沿剖面方向距离 km →', p.x + p.w, p.y + p.h + 24)

  /* 观察者（机位） */
  const ox = x2px(0)
  const oy = y2px((terrain.value[0] as number) / 1000)
  ctx.fillStyle = pal.text
  ctx.beginPath()
  ctx.moveTo(ox + 2, oy)
  ctx.lineTo(ox + 9, oy - 5)
  ctx.lineTo(ox + 9, oy + 5)
  ctx.closePath()
  ctx.fill()
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = pal.muted
  ctx.fillText(`机位 · ${terrain.value[0]} m`, ox + 12, oy + 3)
  ctx.restore()
}

function drawSun(ctx: CanvasRenderingContext2D): void {
  const p = plot.value
  const pal = palette.value
  const sun = props.sun
  const yMax = props.yMaxKm
  const obsH = (terrain.value[0] as number) / 1000
  const tx = sun.toward.x
  const ty = sun.toward.y
  if (ty <= 0.001) return

  /* 从机位沿太阳方向画到天顶边界：这就是「投影到剖面的光路方向」 */
  const tTop = (yMax - obsH) / ty
  const topX = tx * tTop
  const alpha = sun.inFront ? 0.95 : 0.28
  ctx.save()
  ctx.beginPath()
  ctx.rect(p.x - PAD.l, p.y - PAD.t, cssW.value, cssH.value)
  ctx.clip()

  /* 主光线（穿过机位）+ 两条平行辅助线 */
  ctx.setLineDash([5, 4])
  ctx.lineWidth = 1.2
  for (const off of [-1, 0, 1]) {
    const dx = off * 8
    ctx.strokeStyle = `rgba(255,210,138,${alpha * (off === 0 ? 0.8 : 0.35)})`
    ctx.beginPath()
    ctx.moveTo(x2px(topX) + dx, y2px(yMax))
    const belowY = obsH - 2
    ctx.lineTo(x2px(topX) - (tx / ty) * (yMax - belowY) + dx, y2px(belowY))
    ctx.stroke()
  }
  ctx.setLineDash([])

  /* 太阳符号：落在图顶（超出则夹到边界） */
  const sx = Math.max(p.x + 8, Math.min(p.x + p.w - 8, x2px(topX)))
  const sy = y2px(yMax) + 2
  ctx.globalAlpha = alpha
  ctx.fillStyle = pal.sun
  ctx.beginPath()
  ctx.arc(sx, sy + 10, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = pal.sun
  ctx.lineWidth = 1.2
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(sx + Math.cos(a) * 9, sy + 10 + Math.sin(a) * 9)
    ctx.lineTo(sx + Math.cos(a) * 13, sy + 10 + Math.sin(a) * 13)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.font = '10.5px system-ui, sans-serif'
  ctx.fillStyle = pal.muted
  ctx.textAlign = 'center'
  const note = sun.inFront
    ? `太阳方位 ${sun.az.toFixed(0)}° · 高度角 ${sun.el.toFixed(0)}° · 投影角 ${sun.inPlaneEl.toFixed(0)}°`
    : `太阳在剖面背后（偏离 ${Math.abs(sun.deviationDeg).toFixed(0)}°）——图中的光线只是投影`
  const noteX = Math.max(p.x + 130, Math.min(p.x + p.w - 130, sx))
  ctx.fillText(note, noteX, sy + 34)
  ctx.restore()
}

/* ---------------- 交互 ---------------- */

interface Hover {
  x: number
  y: number
  d: number
  km: number
  si: number
  li: number
  point: XsecPoint | null
  pressure: number | null
  hgt: number | null
}
const hover = ref<Hover | null>(null)

function nearestSample(d: number): number {
  let best = 0
  let bd = Infinity
  distances.value.forEach((v, i) => {
    const diff = Math.abs(v - d)
    if (diff < bd) { bd = diff; best = i }
  })
  return best
}

function onMove(ev: PointerEvent): void {
  const cv = canvas.value
  if (!cv) return
  const r = cv.getBoundingClientRect()
  const x = ((ev.clientX - r.left) / r.width) * cssW.value
  const y = ((ev.clientY - r.top) / r.height) * cssH.value
  const p = plot.value
  if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
    hover.value = null
    return
  }
  const d = px2d(x)
  const km = px2km(y)
  const si = nearestSample(d)
  const col = points.value[si] ?? []
  let li = 0
  let bd = Infinity
  col.forEach((pt, j) => {
    const hv = pt.hgtM
    if (hv === null) return
    const diff = Math.abs(hv / 1000 - km)
    if (diff < bd) { bd = diff; li = j; li = j }
  })
  const point = col[li] ?? null
  hover.value = {
    x, y, d, km, si, li,
    point,
    pressure: point ? point.pressureHpa : null,
    hgt: point && point.hgtM !== null ? point.hgtM : null
  }
}

function onLeave(): void {
  hover.value = null
}

function round1(v: number | null | undefined): string {
  return v === null || v === undefined ? '缺测' : String(Math.round(v * 10) / 10)
}

function drawOverlay(): void {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW.value, cssH.value)
  /* 先把缓存好的底图贴回来 */
  ctx.drawImage(base, 0, 0, cssW.value, cssH.value)

  const p = plot.value
  const pal = palette.value
  const h = hover.value
  if (!h) return

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(h.x, p.y)
  ctx.lineTo(h.x, p.y + p.h)
  ctx.moveTo(p.x, h.y)
  ctx.lineTo(p.x + p.w, h.y)
  ctx.stroke()
  ctx.restore()

  const pt = h.point
  const lines: string[] = []
  lines.push(`距离 ${h.d.toFixed(1)} km（采样点 ${h.si + 1}/5 · 最近格点）`)
  if (pt) {
    lines.push(`${pt.pressureHpa} hPa · 海拔 ${h.hgt === null ? '缺测' : Math.round(h.hgt as number)} m`)
    if (pt.belowGround) lines.push('⚠ 该层在地形以下（模式无有效值，已遮罩）')
    lines.push(`温度 ${round1(pt.tC)} °C · 湿度 ${round1(pt.rhPct)} %`)
    lines.push(`云水 ${round1(pt.clwMgKg)} mg/kg · 云冰 ${round1(pt.iciMgKg)} mg/kg`)
    lines.push(`云分数 ${round1(pt.cfPct)} % · 风 ${round1(pt.uMs)}/${round1(pt.vMs)} m/s`)
    lines.push(`垂直速度 ${round1(pt.wPaS)} Pa/s（负 = 上升）`)
  } else {
    lines.push('该位置没有有效数据')
  }

  ctx.font = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif'
  const wBox = 208
  const hBox = 16 + lines.length * 17
  let bx = h.x + 14
  let by = h.y + 14
  if (bx + wBox > cssW.value - 6) bx = h.x - wBox - 14
  if (by + hBox > cssH.value - 6) by = cssH.value - hBox - 6
  if (by < 4) by = 4
  ctx.fillStyle = 'rgba(8,10,12,0.9)'
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(bx, by, wBox, hBox, 8)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#dbe3e9'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => {
    ctx.fillText(line, bx + 10, by + 8 + i * 17)
  })
}

/* ---------------- 生命周期 ---------------- */

let raf = 0
function scheduleOverlay(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    drawOverlay()
  })
}

function redraw(): void {
  drawBase()
  drawOverlay()
}

function resize(): void {
  const el = wrap.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const fsEl = document.fullscreenElement
  const inFull = !!fsEl && (fsEl === el || fsEl.contains(el))
  cssW.value = Math.max(300, Math.round(rect.width))
  /* 全屏时要吃满可用高度，普通卡片按宽高比给一个舒服的高度 */
  cssH.value = inFull
    ? Math.max(320, Math.round(el.clientHeight || rect.height))
    : Math.round(Math.max(300, Math.min(520, rect.width * 0.5)))
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
  mo = new MutationObserver(() => {
    readPalette()
    redraw()
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  document.addEventListener('fullscreenchange', resize)
  resize()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  mo?.disconnect()
  document.removeEventListener('fullscreenchange', resize)
})

watch(
  () => [props.section, props.yMaxKm, props.layers, props.sun],
  () => redraw(),
  { deep: true }
)
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
