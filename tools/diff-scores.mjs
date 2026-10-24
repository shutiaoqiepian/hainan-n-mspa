/**
 * 新旧评分对照：拿 .cmp-old（旧管线的快照）对比 data/obs（当前管线）。
 * 用法：node tools/diff-scores.mjs [旧目录]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const OLD = process.argv[2] || '.cmp-old'
const NEW = 'data/obs'

const LV = [[92, '火烧云'], [82, '大烧'], [66, '中烧'], [48, '小烧'], [30, '微烧'], [0, '不烧']]
const lv = (s) => LV.find(([m]) => s >= m)[1]

const files = readdirSync(NEW).filter((f) => f.startsWith('forecast-') && f.endsWith('.json'))
let n = 0, sum = 0, absSum = 0, maxAbs = 0, up = 0, down = 0, flip = 0
const flips = {}, worst = []

for (const f of files) {
  if (!existsSync(path.join(OLD, f))) continue
  const nw = JSON.parse(readFileSync(path.join(NEW, f), 'utf8'))
  const od = JSON.parse(readFileSync(path.join(OLD, f), 'utf8'))
  const om = new Map(od.rows.map((r) => [r.n, r.score]))
  for (const r of nw.rows) {
    const o = om.get(r.n)
    if (o == null) continue
    const d = r.score - o
    n++; sum += d; absSum += Math.abs(d)
    maxAbs = Math.max(maxAbs, Math.abs(d))
    if (d > 0) up++; else if (d < 0) down++
    const a = lv(o), b = lv(r.score)
    if (a !== b) { flip++; const k = a + '→' + b; flips[k] = (flips[k] || 0) + 1 }
    if (Math.abs(d) >= 2) worst.push([r.n, o, r.score, d])
  }
}

if (!n) { console.log('没有可比对的样本（目录里没有同名文件）'); process.exit(0) }

console.log('样本 ' + n)
console.log('平均变化 ' + (sum / n).toFixed(2) + ' 分｜平均绝对 ' + (absSum / n).toFixed(2) + '｜最大 ' + maxAbs)
console.log('升高 ' + up + '｜降低 ' + down)
console.log('等级变化 ' + flip + ' 个 ' + JSON.stringify(flips))
worst.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))
console.log('变化最大 10 个：')
worst.slice(0, 10).forEach((w) => console.log('  ' + String(w[0]).padEnd(12, '　') + ' ' + w[1] + ' → ' + w[2] + '（' + (w[3] > 0 ? '+' : '') + w[3] + '）'))
