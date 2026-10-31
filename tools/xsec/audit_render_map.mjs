#!/usr/bin/env node
/**
 * 阶段七 P0 审计：把「图上颜色」与「鼠标提示」逐像素对齐，找出两者不一致的位置与原因。
 *
 * 用法：node tools/xsec/audit_render_map.mjs [spotId] [t] [az]
 * 默认：hk-xihai t=2 az=265（用户截图的样板场景）
 *
 * 复刻 CrossSectionChart.vue 的渲染数学（见文件内注释），逐像素算：
 *   - 像素处的插值 q（图上颜色用它）
 *   - 该位置 tooltip 会取到的「最近采样点 + 最近模式层」的原始值
 *   - 两者是否一致
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = 'C:/dsh椰青/18n-mspa'
const SPOT = process.argv[2] || 'hk-xihai'
const T = Number(process.argv[3] ?? 2)
const AZ = Number(process.argv[4] ?? 265)

const BAND_EDGE_MGK = 1
function alphaOf(q) {
  if (q < BAND_EDGE_MGK * 0.5) return 0
  const t = (Math.log10(Math.max(q, 0.5)) - Math.log10(0.5)) / (Math.log10(400) - Math.log10(0.5))
  return Math.max(0, Math.min(1, t)) * 0.62
}

const file = JSON.parse(await readFile(join(ROOT, `data/cross/hn-${SPOT}.json`), 'utf8'))
const sec = file.sections.find((s) => s.t === T && s.az === AZ)
if (!sec) throw new Error(`没有 t=${T} az=${AZ} 的 section`)
const F = Object.fromEntries(file.levelFields.map((f, i) => [f, i]))
const levels = file.levelsHpa
const pts = sec.samples.map((s) =>
  s.levels.map((row, j) => ({
    pressureHpa: levels[j],
    hgtM: row[F.hgtM],
    tC: row[F.tC],
    rhPct: row[F.rhPct],
    clw: row[F.clwMgKg],
    ici: row[F.iciMgKg],
    cfPct: row[F.cfPct],
    belowGround: row[F.belowGround] === 1
  }))
)
const ds = sec.samples.map((s) => s.d)
const terrain = sec.samples.map((s) => s.terrainM)
const totalQ = (p) => (p.clw === null && p.ici === null ? null : (p.clw ?? 0) + (p.ici ?? 0))
const liquidShare = (p) => {
  const a = p.clw ?? 0
  const b = p.ici ?? 0
  return a + b > 0 ? a / (a + b) : 0.5
}
const valueOf = (p) => {
  const q = totalQ(p)
  if (q !== null) return { q, liquid: liquidShare(p), estimated: false }
  if (p.cfPct !== null) {
    const lo = Math.log10(0.5), hi = Math.log10(400)
    return { q: 10 ** (lo + (Math.max(0, Math.min(100, p.cfPct)) / 100) * (hi - lo)), liquid: 0.5, estimated: true }
  }
  return { q: 0, liquid: 0.5, estimated: false }
}
const heights = pts.map((col) => col.map((p) => p.hgtM))

function profileAt(si, hKm) {
  const hs = heights[si], col = pts[si]
  const zm = hKm * 1000
  if (zm < terrain[si]) return null
  let k = -1
  for (let j = 0; j < hs.length; j++) {
    if (hs[j] === null || col[j].belowGround) continue
    if (hs[j] <= zm) k = j
  }
  if (k < 0) return null
  let k2 = -1
  for (let j = k + 1; j < hs.length; j++) {
    if (hs[j] === null || col[j].belowGround) continue
    k2 = j
    break
  }
  const q1 = valueOf(col[k])
  if (k2 < 0) {
    if (zm > hs[k] + 1) return null
    return q1
  }
  const w = hs[k2] > hs[k] ? (zm - hs[k]) / (hs[k2] - hs[k]) : 0
  const q2 = valueOf(col[k2])
  return { q: q1.q * (1 - w) + q2.q * w, liquid: q1.liquid * (1 - w) + q2.liquid * w, estimated: q1.estimated || q2.estimated }
}
function cloudAt(d, hKm) {
  let si = 0
  while (si < ds.length - 2 && ds[si + 1] < d) si++
  const w = Math.max(0, Math.min(1, (d - ds[si]) / (ds[si + 1] - ds[si] || 1)))
  const a = profileAt(si, hKm), b = profileAt(si + 1, hKm)
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return { q: a.q * (1 - w) + b.q * w, liquid: a.liquid * (1 - w) + b.liquid * w, estimated: a.estimated || b.estimated }
}

/* ---- tooltip 的取值逻辑（与 CrossSectionChart.onMove 一致）---- */
function tooltipAt(d, hKm) {
  let si = 0, bd = Infinity
  ds.forEach((v, i) => { const diff = Math.abs(v - d); if (diff < bd) { bd = diff; si = i } })
  const col = pts[si]
  let li = 0; bd = Infinity
  col.forEach((pt, j) => {
    if (pt.hgtM === null) return
    const diff = Math.abs(pt.hgtM / 1000 - hKm)
    if (diff < bd) { bd = diff; li = j }
  })
  return { si, li, point: col[li], levelOffsetKm: Math.abs(col[li].hgtM / 1000 - hKm) }
}

const totalKm = ds[ds.length - 1]
const yMax = 16
const NX = 220, NY = 220
let colored = 0, mismatch = 0, mismatchStrong = 0
const examples = []
const bandByLevel = new Map()
for (let py = 0; py < NY; py++) {
  const h = (1 - py / (NY - 1)) * yMax
  for (let px = 0; px < NX; px++) {
    const d = (px / (NX - 1)) * totalKm
    const c = cloudAt(d, h)
    if (!c) continue
    const a = alphaOf(c.q)
    if (a <= 0) continue
    colored++
    const tt = tooltipAt(d, h)
    const tq = totalQ(tt.point) ?? 0
    if (tq <= 0) {
      mismatch++
      if (a > 0.15) mismatchStrong++
      const key = tt.point.pressureHpa
      bandByLevel.set(key, (bandByLevel.get(key) ?? 0) + 1)
      if (examples.length < 6) {
        examples.push({
          dKm: +d.toFixed(1), hKm: +h.toFixed(2), pixelAlpha: +a.toFixed(3),
          pixelQ: +c.q.toFixed(2), tooltipLevelHpa: tt.point.pressureHpa,
          tooltipLevelHgtKm: +(tt.point.hgtM / 1000).toFixed(2), levelOffsetKm: +tt.levelOffsetKm.toFixed(2),
          tooltipQ: 0, tooltipCf: tt.point.cfPct
        })
      }
    }
  }
}

console.log(`=== P0 逐像素审计：${SPOT} t=${T} az=${AZ} ===`)
console.log(`采样点距离：${ds.join(' / ')} km；层高度(km)：${heights[0].map((h) => (h === null ? 'null' : (h / 1000).toFixed(2))).join(' / ')}`)
console.log(`有色像素（alpha>0）：${colored} / ${NX * NY}（${((colored / (NX * NY)) * 100).toFixed(1)}%）`)
console.log(`其中 tooltip 会显示「云水0/云冰0」的像素：${mismatch}（${((mismatch / Math.max(1, colored)) * 100).toFixed(1)}%），强色（alpha>0.15）：${mismatchStrong}`)
console.log('不一致像素对应的 tooltip 层：', [...bandByLevel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}hPa×${v}`).join(' '))
console.log('样例：')
for (const e of examples) console.log('  ', JSON.stringify(e))

/* ---- 变量映射：各层原始值分布 ---- */
console.log('\n=== 各气压层原始值（采样点 0）===')
console.log('层hPa  高度km  CLWMR  ICMR  TCDC%  该层是否会被画成紫色')
for (let j = 0; j < levels.length; j++) {
  const p = pts[0][j]
  const q = totalQ(p) ?? 0
  console.log(`${String(levels[j]).padStart(5)}  ${(p.hgtM / 1000).toFixed(2).padStart(6)}  ${String(p.clw).padStart(5)}  ${String(p.ici).padStart(4)}  ${String(p.cfPct).padStart(5)}   ${q > 0.5 ? '是' : '否'}（q=${q} mg/kg）`)
}

/* ---- 缺测与 null 处理 ---- */
let nullClw = 0, nullIci = 0, nullCf = 0, halfNull = 0
for (const col of pts) for (const p of col) {
  if (p.clw === null) nullClw++
  if (p.ici === null) nullIci++
  if (p.cfPct === null) nullCf++
  if ((p.clw === null) !== (p.ici === null)) halfNull++
}
console.log('\n=== null 情况（本剖面 5 采样 × 9 层）===')
console.log(`clw=null ${nullClw} 个 / ici=null ${nullIci} 个 / cf=null ${nullCf} 个 / 只有一半为 null（当前实现把 null 当 0）${halfNull} 个`)

/* ---- 层间距 vs tooltip 误差 ---- */
console.log('\n=== 垂直层间距（决定 tooltip 最近层的最大偏差）===')
const hs0 = heights[0]
for (let j = 1; j < hs0.length; j++) {
  const dh = (hs0[j] - hs0[j - 1]) / 1000
  console.log(`  ${levels[j - 1]}→${levels[j]} hPa：${dh.toFixed(2)} km（最近层误差最大 ±${(dh / 2).toFixed(2)} km）`)
}
