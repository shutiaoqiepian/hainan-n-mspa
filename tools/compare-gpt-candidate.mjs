/**
 * 对照第三份实现：GPT 给出的候选函数（fWetCandidate / fAodCandidate）。
 *
 * 目的不是评判好坏，而是回答一个具体问题：
 *   把它接进现有 scoreOf，169 个机位的分数会怎么变？
 *
 * 用法：node tools/compare-gpt-candidate.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

/* ========== GPT 给的候选实现（原样照抄，只补了类型） ========== */
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const smoothstep = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t) }

function finiteInRange(value, min, max) {
  if (value == null || !Number.isFinite(value) || value < min || value > max) return null
  return value
}

function fWetCandidate(pop, rh) {
  const p = finiteInRange(pop, 0, 100)
  const r = finiteInRange(rh, 0, 100)
  if (p === null || r === null) return null
  const rainRisk = smoothstep((p - 20) / 60)
  const rainFactor = 1 - 0.78 * rainRisk
  const humidityRisk = smoothstep((r - 75) / 23)
  const humidityFactor = 1 - 0.35 * humidityRisk
  return clamp01(rainFactor * humidityFactor)
}

function fAodCandidate(aod) {
  if (aod == null || !Number.isFinite(aod) || aod < 0 || aod > 5) return null
  return Math.exp(-aod / 0.7)
}
/* ============================================================= */

function fHigh(h) {
  if (h < 8) return 0
  if (h <= 55) return (h - 8) / 47
  if (h <= 78) return 1
  return 0.25 + 0.75 * (100 - h) / 22
}
const fLow = (l) => Math.max(0, Math.min(1, 1 - l / 82))
const fMid = (m) => (m <= 55 ? 1 : Math.max(0, Math.min(1, 1 - (m - 55) / 40)))

/* 基线（与生产完全一致） */
function scoreBaseline(m) {
  const high = m.high ?? 90, mid = m.mid ?? 60, low = m.low ?? 70
  const pop = m.pop ?? 60, rh = m.rh ?? 90
  const h = Math.max(0, Math.min(1, fHigh(high)))
  if (h <= 0) return 0
  const aodStep = (a) => (a <= 0.1 ? 1 : a <= 0.2 ? 0.97 : a <= 0.3 ? 0.92 : a <= 0.5 ? 0.8 : a <= 0.8 ? 0.55 : 0.3)
  const wetStep = (p, r) => (p < 40 ? 1 : p < 70 ? 0.62 : 0.22) * (r > 93 ? 0.5 : r > 88 ? 0.78 : 1)
  const lowF = 0.3 + 0.7 * fLow(low)
  const midF = 0.72 + 0.28 * fMid(mid)
  const aodF = 0.55 + 0.45 * aodStep(m.aod ?? 0.4)
  const wetF = 0.55 + 0.45 * wetStep(pop, rh)
  return Math.round(Math.min(96, 100 * Math.pow(Math.max(0, Math.min(1, h * lowF * midF * aodF * wetF)), 1.8)))
}

/* GPT 候选：缺测时退回基线值（GPT 没定义缺测行为，这里用最宽松的假设） */
function scoreGpt(m) {
  const high = m.high ?? 90, mid = m.mid ?? 60, low = m.low ?? 70
  const h = Math.max(0, Math.min(1, fHigh(high)))
  if (h <= 0) return 0
  const aodFv = fAodCandidate(m.aod ?? 0.4)
  const wetFv = fWetCandidate(m.pop ?? 60, m.rh ?? 90)
  const aodF = 0.55 + 0.45 * (aodFv ?? 0.8)
  const wetF = 0.55 + 0.45 * (wetFv ?? 0.62)
  const lowF = 0.3 + 0.7 * fLow(low)
  const midF = 0.72 + 0.28 * fMid(mid)
  return Math.round(Math.min(96, 100 * Math.pow(Math.max(0, Math.min(1, h * lowF * midF * aodF * wetF)), 1.8)))
}

const LEVELS = [
  { min: 92, name: '火烧云' }, { min: 82, name: '大烧' }, { min: 66, name: '中烧' },
  { min: 48, name: '小烧' }, { min: 30, name: '微烧' }, { min: 0, name: '不烧' }
]
const levelOf = (s) => LEVELS.find((l) => s >= l.min) ?? LEVELS[LEVELS.length - 1]

const CASES = [
  ['教科书级大烧', { high: 62, mid: 20, low: 8, aod: 0.12, pop: 5, rh: 70 }],
  ['云量最佳窗口', { high: 66, mid: 30, low: 12, aod: 0.18, pop: 0, rh: 72 }],
  ['低云封地平线', { high: 60, mid: 20, low: 80, aod: 0.2, pop: 10, rh: 85 }],
  ['厚云阴天', { high: 95, mid: 85, low: 90, aod: 0.4, pop: 70, rh: 92 }],
  ['有霾', { high: 60, mid: 20, low: 10, aod: 0.85, pop: 5, rh: 70 }],
  ['高云过厚', { high: 92, mid: 40, low: 20, aod: 0.25, pop: 10, rh: 78 }]
]

console.log('=== ① 单个因子的差异 ===\n')
console.log('AOD    基线fAod  GPT fAod    aodF 变化')
for (const a of [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5]) {
  const base = a <= 0.1 ? 1 : a <= 0.2 ? 0.97 : a <= 0.3 ? 0.92 : a <= 0.5 ? 0.8 : a <= 0.8 ? 0.55 : 0.3
  const gpt = fAodCandidate(a)
  console.log(
    String(a).padEnd(6) + '  ' + base.toFixed(2).padStart(6) + '   ' + gpt.toFixed(3).padStart(6) +
    '   ' + (0.55 + 0.45 * base).toFixed(3) + ' → ' + (0.55 + 0.45 * gpt).toFixed(3)
  )
}

console.log('\n降水/湿度   基线fWet  GPT fWet')
for (const [pop, rh] of [[0, 60], [10, 85], [40, 80], [55, 85], [70, 92], [90, 95], [5, 70]]) {
  const wetStep = (p, r) => (p < 40 ? 1 : p < 70 ? 0.62 : 0.22) * (r > 93 ? 0.5 : r > 88 ? 0.78 : 1)
  console.log('pop' + String(pop).padStart(3) + ' rh' + String(rh).padStart(3) + '    ' +
    wetStep(pop, rh).toFixed(2).padStart(6) + '   ' + fWetCandidate(pop, rh).toFixed(3).padStart(6))
}

console.log('\n=== ② 自测用例 ===\n')
console.log('用例'.padEnd(14, '　') + ' 基线  GPT   差')
for (const [name, m] of CASES) {
  const b = scoreBaseline(m)
  const g = scoreGpt(m)
  console.log(name.padEnd(12, '　') + ' ' + String(b).padStart(4) + ' ' + String(g).padStart(4) +
    ' ' + ((g - b) >= 0 ? '+' : '') + (g - b))
}

/* 169 个机位 */
const obsDir = path.join(ROOT, 'data', 'obs')
const files = existsSync(obsDir) ? (await readdir(obsDir)).filter((f) => f.startsWith('forecast-') && f.endsWith('.json')) : []
const rows = []
for (const f of files) {
  const j = JSON.parse(await readFile(path.join(obsDir, f), 'utf8'))
  for (const r of j.rows) rows.push({ n: r.n, m: { high: r.high, mid: r.mid, low: r.low, rh: r.rh, pop: r.pop, aod: r.aod ?? 0.2 } })
}

if (rows.length) {
  const base = rows.map((r) => scoreBaseline(r.m))
  const gpt = rows.map((r) => scoreGpt(r.m))
  const diffs = gpt.map((v, i) => v - base[i])
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length
  const absMean = diffs.reduce((s, x) => s + Math.abs(x), 0) / diffs.length
  let lv = 0
  const pairs = {}
  for (let i = 0; i < rows.length; i++) {
    const a = levelOf(base[i]).name, b = levelOf(gpt[i]).name
    if (a !== b) { lv++; pairs[a + '→' + b] = (pairs[a + '→' + b] || 0) + 1 }
  }

  console.log('\n=== ③ 今天 ' + rows.length + ' 个机位 ===')
  console.log('平均变化：' + (mean >= 0 ? '+' : '') + mean.toFixed(2) + ' 分')
  console.log('平均绝对变化：' + absMean.toFixed(2) + ' 分')
  console.log('最大变化：' + Math.min(...diffs) + ' 分')
  console.log('等级变化：' + lv + ' / ' + rows.length)
  const top = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 6)
  for (const [k, v] of top) console.log('   ' + k + '：' + v + ' 个')

  const baseAvg = base.reduce((s, x) => s + x, 0) / base.length
  const gptAvg = gpt.reduce((s, x) => s + x, 0) / gpt.length
  console.log('平均分：基线 ' + baseAvg.toFixed(1) + ' → GPT候选 ' + gptAvg.toFixed(1))
}

/* 抖动：GPT 版本是不是真消除了跳变 */
console.log('\n=== ④ 阈值附近抖动（只挪 0.2 个单位）===')
const probe = { high: 62, mid: 20, low: 8, aod: 0.12, pop: 5, rh: 70 }
const edges = [
  ['降水 40%', { pop: 39.9 }, { pop: 40.1 }],
  ['降水 70%', { pop: 69.9 }, { pop: 70.1 }],
  ['湿度 88%', { rh: 87.9 }, { rh: 88.1 }],
  ['湿度 93%', { rh: 92.9 }, { rh: 93.1 }],
  ['AOD 0.3', { aod: 0.299 }, { aod: 0.301 }],
  ['AOD 0.5', { aod: 0.499 }, { aod: 0.501 }]
]
let maxBase = 0, maxGpt = 0
for (const [name, lo, hi] of edges) {
  const b = Math.abs(scoreBaseline({ ...probe, ...hi }) - scoreBaseline({ ...probe, ...lo }))
  const g = Math.abs(scoreGpt({ ...probe, ...hi }) - scoreGpt({ ...probe, ...lo }))
  maxBase = Math.max(maxBase, b); maxGpt = Math.max(maxGpt, g)
  console.log(name.padEnd(10, '　') + ' 基线 ' + String(b).padStart(3) + ' 分   GPT ' + String(g).padStart(2) + ' 分')
}
console.log('最大跳变：基线 ' + maxBase + ' → GPT候选 ' + maxGpt)
