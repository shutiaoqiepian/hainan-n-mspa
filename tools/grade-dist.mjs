/**
 * 等级分布 / 边界距离统计 —— 给「分档阈值」和「区间半径」找依据，别凭感觉定。
 *
 * 用法：
 *   node tools/grade-dist.mjs                 # 全部省份 × 第0/1天 × 日出/日落
 *   node tools/grade-dist.mjs hn gd           # 只跑这几个省
 *   node tools/grade-dist.mjs --delta=6       # 按这个半径统计「跨档」占比
 *   node tools/grade-dist.mjs --save=/tmp/x.json   # 存原始分数，改阈值前后来对比
 *   node tools/grade-dist.mjs --base=/tmp/x.json   # 与上一次的原始分数逐条比 diff
 *
 * 为什么不能用 data/obs 的历史快照：那份只有 9 天、1961 条，且是改算法之前的口径。
 * 这里直接调 src/ 里的真实管线（和 tools/snapshot-forecast.mjs 同一套），
 * 分数就是页面上显示的那个最终分（含模式分歧/朝向/剖面/时效折扣）。
 *
 * 输出四块：
 *   ① 分数直方图（每 10 分一档）—— 看分数是不是全挤在低段
 *   ② 六档占用 —— 看有没有哪档永远进不去（那就是死档）
 *   ③ 离档位分界的距离 —— 决定「区间半径」取多大：半径越大，越多预报写成区间
 *   ④ 与 --base 的逐条 diff —— 确认某次改动到底动了几条、动了多少
 */
import { readdir, readFile } from 'node:fs/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const a = argv.find((x) => x.startsWith('--' + name + '='))
  return a ? a.slice(name.length + 3) : dflt
}
const DELTA = Number(opt('delta', '6'))
const SAVE = opt('save', null)
const BASE = opt('base', null)
const provs = argv.filter((a) => !a.startsWith('-'))

async function makeComputer() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-gradedist-'))
  const entry = path.join(tmp, 'entry.ts')
  await (await import('node:fs/promises')).writeFile(entry, `
import { load } from '@/lib/forecast/api'
import { state } from '@/lib/forecast/state'

export async function computeFor(prov: string, fixture: string, kind: 'sunrise' | 'sunset', day: number) {
  ;(globalThis as any).fetch = async () => new Response(fixture, { status: 200 })
  ;(globalThis as any).location = { search: '', href: 'http://localhost/forecast' }
  ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem() {} }
  state.prov = prov
  state.kind = kind
  state.day = day
  state.model = 'multi'
  state.area = '全部'
  load()
  await new Promise((r) => setTimeout(r, 60))
  return state.rows.map((r) => ({
    n: r.spot.n,
    score: r.score,
    level: r.level.name,
    raw: r.rawScore,
    high: r.m.high, mid: r.m.mid, low: r.m.low
  }))
}
`, 'utf8')
  const outfile = path.join(tmp, 'bundle.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  const mod = await import(pathToFileURL(outfile).href)
  return mod.computeFor
}

/* 与 src/data/forecast/levels.ts 保持同源：不在这里抄第二份阈值 */
async function loadLevels() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-gradedist-lv-'))
  const entry = path.join(tmp, 'lv.ts')
  await (await import('node:fs/promises')).writeFile(entry, `
export { LEVELS, levelOf } from '@/data/forecast/levels'
`, 'utf8')
  const outfile = path.join(tmp, 'lv.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

const LV = await loadLevels()
const computeFor = await makeComputer()

let files = []
if (provs.length) files = provs.map((p) => p.replace(/\.json$/, '') + '.json')
else {
  files = (await readdir(path.join(ROOT, 'data/forecast')))
    .filter((f) => f.endsWith('.json') && !f.startsWith('forecast-'))
}
if (!files.length) throw new Error('data/forecast/ 里没有缓存')

const rows = []
for (const f of files) {
  const prov = f.replace(/\.json$/, '')
  const fixture = await readFile(path.join(ROOT, 'data/forecast', f), 'utf8')
  for (const kind of ['sunset', 'sunrise']) {
    for (const day of [0, 1]) {
      let got
      try {
        got = await computeFor(prov, fixture, kind, day)
      } catch (e) {
        console.log('  ⚠ ' + prov + ' ' + kind + ' d' + day + ' 计算失败：' + e.message)
        continue
      }
      for (const r of got) rows.push({ prov, kind, day, ...r })
    }
  }
}

const n = rows.length
if (!n) throw new Error('一条都没算出来')
const scores = rows.map((r) => r.score).sort((a, b) => a - b)
const sum = scores.reduce((a, b) => a + b, 0)
const pct = (c) => ((c / n) * 100).toFixed(2) + '%'

console.log('\n样本数：' + n + '（' + files.length + ' 省 × 2 时次 × 2 天 × 各省机位）')
console.log('平均分 ' + (sum / n).toFixed(2) + ' · 中位 ' + scores[Math.floor((n - 1) / 2)] +
  ' · 最高 ' + scores[n - 1] + ' · 满分上限 ' + Math.max(...LV.LEVELS.map((l) => l.min)))

console.log('\n=== ① 分数直方图（每 10 分一档）===')
const hist = new Array(11).fill(0)
for (const s of scores) hist[Math.min(10, Math.floor(s / 10))]++
for (let i = 0; i <= 10; i++) {
  if (!hist[i]) continue
  const lo = i * 10
  const hi = i === 10 ? 100 : lo + 9
  console.log('  ' + String(lo).padStart(3) + '–' + String(hi).padEnd(3) + ' ' +
    String(hist[i]).padStart(6) + '  ' + pct(hist[i]) + '  ' + '█'.repeat(Math.round(hist[i] / n * 120)))
}

console.log('\n=== ② 六档占用（阈值取自 src/data/forecast/levels.ts）===')
const cnt = new Map()
for (const r of rows) cnt.set(r.level, (cnt.get(r.level) || 0) + 1)
for (const l of LV.LEVELS) {
  const c = cnt.get(l.name) || 0
  console.log('  ' + l.name.padEnd(5, '　') + ' ≥' + String(l.min).padStart(3) + '  ' +
    String(c).padStart(6) + '  ' + pct(c) + (c === 0 ? '   ← 死档：没有任何样本落进来' : ''))
}

console.log('\n=== ③ 离档位分界的距离（决定区间半径）===')
/* 每个分数到最近一条等级分界线的距离；距离 < 半径就会被写成「A 到 B」区间 */
const bounds = LV.LEVELS.map((l) => l.min).filter((m) => m > 0).sort((a, b) => a - b)
const dist = (s) => Math.min(...bounds.map((b) => Math.abs(s - b)))
for (const d of [3, 4, 5, 6, 8, 10, 12]) {
  const c = rows.filter((r) => dist(r.score) < d).length
  console.log('  半径 ±' + String(d).padStart(2) + ' 分 → ' + String(c).padStart(6) + ' 条写成区间  ' + pct(c))
}
const dCnt = new Array(13).fill(0)
for (const r of rows) dCnt[Math.min(12, dist(r.score))]++
console.log('  最近的 12 个距离上的条数：' + dCnt.slice(0, 13).map((v, i) => i + ':' + v).join('  '))

console.log('\n=== ④ 逐条 diff' + (BASE ? '（对照 ' + BASE + '）' : '') + ' ===')
if (BASE) {
  if (!existsSync(BASE)) throw new Error('--base 文件不存在：' + BASE)
  const prev = JSON.parse(await readFile(BASE, 'utf8'))
  const key = (r) => r.prov + '|' + r.kind + '|' + r.day + '|' + r.n
  const before = new Map(prev.map((r) => [key(r), r]))
  let same = 0, up = 0, down = 0, sumD = 0, maxD = 0, lvFlip = 0
  const worst = []
  for (const r of rows) {
    const b = before.get(key(r))
    if (!b) continue
    const d = r.score - b.score
    if (d === 0) { same++; continue }
    if (d > 0) up++; else down++
    sumD += d
    if (Math.abs(d) > Math.abs(maxD)) maxD = d
    if (r.level !== b.level) lvFlip++
    if (Math.abs(d) >= 3) worst.push({ k: key(r), from: b.score, to: r.score, d })
  }
  console.log('  相同 ' + same + ' · 上浮 ' + up + ' · 下降 ' + down +
    ' · 平均变化 ' + ((sumD / Math.max(1, up + down)).toFixed(3)) + ' · 最大 ' + (maxD > 0 ? '+' : '') + maxD)
  console.log('  等级翻转 ' + lvFlip + ' 条' + (worst.length ? '，|变化|≥3 的 ' + worst.length + ' 条：' : ''))
  for (const w of worst.slice(0, 12)) console.log('    ' + w.k + '  ' + w.from + ' → ' + w.to + '  (' + (w.d > 0 ? '+' : '') + w.d + ')')
}

if (SAVE) {
  await (await import('node:fs/promises')).writeFile(SAVE, JSON.stringify(rows.map((r) => ({
    prov: r.prov, kind: r.kind, day: r.day, n: r.n, score: r.score, level: r.level
  }))))
  console.log('\n原始分数已存：' + SAVE)
}
