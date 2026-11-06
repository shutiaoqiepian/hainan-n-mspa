/**
 * 边界与缺测测试（不需要测试框架，跑一遍看有没有 FAIL）。
 * 覆盖 GPT 那份任务书 §5 要求的全部输入类型：
 *   0 / 100 / null / undefined / NaN / Infinity / 负数 / 超范围
 *
 * 用法：node tools/test-boundaries.mjs
 */

import { readFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-test-'))
  const entry = path.join(tmp, 'entry.ts')
  await (await import('node:fs/promises')).writeFile(entry, `
export { scoreOf } from '@/lib/forecast/scoring'
export { levelOf, gradeRangeOf, RANGE_DELTA, SCORE_MAX } from '@/data/forecast/levels'
export { qualityOf, validNumber } from '@/lib/forecast/api'
`, 'utf8')
  const outfile = path.join(tmp, 'm.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

const M = await load()

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (detail ? '  → ' + detail : '')) }
}

const finiteInRange = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= M.SCORE_MAX

console.log('\n=== ① 任意输入下分数必须是 0–100 的有限数 ===')
const base = { high: 62, mid: 20, low: 8, rh: 70, pop: 5, aod: 0.12 }
const weird = [
  ['全部 null', { high: null, mid: null, low: null, rh: null, pop: null, aod: 0 }],
  ['全部 undefined', { high: undefined, mid: undefined, low: undefined, rh: undefined, pop: undefined, aod: undefined }],
  ['全部 NaN', { high: NaN, mid: NaN, low: NaN, rh: NaN, pop: NaN, aod: NaN }],
  ['全部 Infinity', { high: Infinity, mid: Infinity, low: Infinity, rh: Infinity, pop: Infinity, aod: Infinity }],
  ['全部 -Infinity', { high: -Infinity, mid: -Infinity, low: -Infinity, rh: -Infinity, pop: -Infinity, aod: -Infinity }],
  ['全 0', { high: 0, mid: 0, low: 0, rh: 0, pop: 0, aod: 0 }],
  ['全 100', { high: 100, mid: 100, low: 100, rh: 100, pop: 100, aod: 100 }],
  ['负数', { ...base, high: -50, mid: -10, low: -10, pop: -1, rh: -5, aod: -0.2 }],
  ['超范围', { ...base, high: 1e6, mid: 1e6, low: 1e6, pop: 1e6, rh: 1e6, aod: 1e6 }],
  ['字符串混入', { ...base, high: '60', mid: 'x', aod: '0.2' }]
]
for (const [name, m] of weird) {
  const s = M.scoreOf(m)
  check(name + ' → ' + s, finiteInRange(s), '得到 ' + String(s))
}

console.log('\n=== ② 缺测不被当成真实观测（qualityOf）===')
const q1 = M.qualityOf({ high: 60, mid: 20, low: 10, rh: 70, pop: 5, aod: 0.1 })
check('全齐 → ok/100', q1.status === 'ok' && q1.completeness === 100, JSON.stringify(q1))

const q2 = M.qualityOf({ high: 60, mid: null, low: 10, rh: 70, pop: 5, aod: 0.1 })
check('缺中云 → partial，且列出字段', q2.status === 'partial' && q2.missing.includes('中云量'), JSON.stringify(q2))

const q3 = M.qualityOf({ high: NaN, mid: 20, low: 10, rh: 70, pop: 5, aod: 0.1 })
check('高云是 NaN → 视作缺测', q3.missing.includes('高云量'), JSON.stringify(q3))

const q4 = M.qualityOf({ high: -5, mid: 20, low: 10, rh: 70, pop: 5, aod: 0.1 })
check('高云是负数 → 视作缺测', q4.missing.includes('高云量'), JSON.stringify(q4))

const q5 = M.qualityOf({ high: 60, mid: 20, low: 10, rh: 70, pop: 5, aod: 0.1, aodMissing: true })
check('aodMissing 标记 → 列出 AOD', q5.missing.includes('气溶胶(AOD)'), JSON.stringify(q5))

const q6 = M.qualityOf({ high: null, mid: null, low: null, rh: null, pop: null, aod: 0 })
check('全缺 → poor/0', q6.status === 'poor' && q6.completeness <= 34, JSON.stringify(q6))

console.log('\n=== ③ 0 是合法值，不能被当缺测 ===')
const q7 = M.qualityOf({ high: 0, mid: 0, low: 0, rh: 0, pop: 0, aod: 0 })
check('六个 0 → ok/100（0 是观测值）', q7.status === 'ok' && q7.completeness === 100, JSON.stringify(q7))
check('high=0 时分数为 0（无高云就无画布）', M.scoreOf({ ...base, high: 0 }) === 0)

console.log('\n=== ④ 单调性：更好的天气不该更低分 ===')
const lo = M.scoreOf({ high: 60, mid: 10, low: 40, rh: 70, pop: 0, aod: 0.2 })
const hi = M.scoreOf({ high: 60, mid: 10, low: 5, rh: 70, pop: 0, aod: 0.2 })
check('低云变少 → 分数不降（' + lo + ' → ' + hi + '）', hi >= lo)

const wet = M.scoreOf({ high: 60, mid: 10, low: 10, rh: 70, pop: 0, aod: 0.2 })
const wetter = M.scoreOf({ high: 60, mid: 10, low: 10, rh: 96, pop: 90, aod: 0.2 })
check('降水/湿度变差 → 分数不升（' + wet + ' → ' + wetter + '）', wetter <= wet)

console.log('\n=== ⑤ 等级映射边界（六档：不烧/微烧/小烧/中烧/大烧/世纪大烧）===')
const exp = [
  [100, '世纪大烧'], [96, '世纪大烧'], [92, '世纪大烧'],
  [91, '大烧'], [82, '大烧'],
  [81, '中烧'], [66, '中烧'],
  [65, '小烧'], [48, '小烧'],
  [47, '微烧'], [30, '微烧'],
  [29, '不烧'], [0, '不烧']
]
for (const [s, name] of exp) {
  check(s + ' → ' + name, M.levelOf(s).name === name, M.levelOf(s).name)
}
check('满分上限是 100', M.SCORE_MAX === 100, String(M.SCORE_MAX))
check('scoreOf 在理想输入下不超过 100', M.scoreOf({ high: 65, mid: 0, low: 0, rh: 60, pop: 0, aod: 0.05 }) <= 100)

console.log('\n=== ⑥ 区间档位（gradeRangeOf）===')
const D = M.RANGE_DELTA
const ORDER = ['世纪大烧', '大烧', '中烧', '小烧', '微烧', '不烧']
const ig = (s) => M.gradeRangeOf(s)
check('区间半径是 5 分', D === 5, String(D))
check('0 分 → 不烧（顶端/底端不写成区间）', ig(0).text === '不烧' && !ig(0).isRange, ig(0).text)
check('29 分 → 不烧到微烧（离 30 只有 1 分）', ig(29).isRange && ig(29).text === '不烧到微烧', ig(29).text)
check('35 分 → 微烧（离 30 正好 5 分，边界开区间，不算跨档）', !ig(35).isRange && ig(35).text === '微烧', ig(35).text)
check('36 分 → 微烧', !ig(36).isRange && ig(36).text === '微烧', ig(36).text)
check('44 分 → 微烧到小烧（离 48 只有 4 分）', ig(44).isRange && ig(44).text === '微烧到小烧', ig(44).text)
check('53 分 → 小烧（离 48 正好 5 分，不算）', !ig(53).isRange && ig(53).text === '小烧', ig(53).text)
check('52 分 → 小烧到微烧（离 48 有 4 分）', ig(52).isRange && ig(52).text === '微烧到小烧', ig(52).text)
check('60 分 → 小烧（离两条分界都 ≥6 分）', !ig(60).isRange && ig(60).text === '小烧', ig(60).text)
check('66 分 → 小烧到中烧（正压在 66 分界上）', ig(66).isRange && ig(66).text === '小烧到中烧', ig(66).text)
check('82 分 → 中烧到大烧（正压在 82 分界上）', ig(82).isRange && ig(82).text === '中烧到大烧', ig(82).text)
check('92 分 → 大烧到世纪大烧（正压在 92 分界上）', ig(92).isRange && ig(92).text === '大烧到世纪大烧', ig(92).text)
check('100 分 → 世纪大烧（顶端不写成区间）', ig(100).text === '世纪大烧' && !ig(100).isRange, ig(100).text)

/* 不变量 1：0–100 每一分都只跨一档，绝不出现「中烧到世纪大烧」 */
let maxSpan = 0
let spanBad = ''
for (let s = 0; s <= 100; s++) {
  const r = ig(s)
  if (!r.isRange) continue
  const span = ORDER.indexOf(r.low.name) - ORDER.indexOf(r.high.name)
  if (span > maxSpan) { maxSpan = span; spanBad = s + ' 分 → ' + r.text }
}
check('0–100 每一分都不跨两档（最大跨 ' + maxSpan + ' 档）', maxSpan <= 1, spanBad)

/* 不变量 2：区间写法必须「低档在前」，不能出现「大烧到中烧」这种倒序 */
check('区间一律低档在前', (() => {
  for (let s = 0; s <= 100; s++) {
    const r = ig(s)
    if (r.isRange && r.low.min >= r.high.min) return false
  }
  return true
})())

/* 不变量 3：isRange 与 why 必须同进同出（界面上拿 why 当悬停提示） */
check('isRange 时 why 一定有内容，反之必为空', (() => {
  for (let s = 0; s <= 100; s++) {
    const r = ig(s)
    if (r.isRange !== (r.why.length > 0)) return false
  }
  return true
})())

/* 不变量 4：非有限输入不许炸（界面上可能拿到 NaN） */
check('NaN / Infinity / null / undefined 不炸', (() => {
  for (const v of [NaN, Infinity, -Infinity, null, undefined]) {
    const r = M.gradeRangeOf(v)
    if (!r || typeof r.text !== 'string' || ORDER.indexOf(r.low.name) < 0) return false
  }
  return true
})())

/* 不变量 5：区间端点必须真的把「分数±半径」包住 —— 否则就是算错了 */
check('区间两端确实覆盖 ±半径 的两个点', (() => {
  for (let s = 0; s <= 100; s++) {
    const r = ig(s)
    const lo = s - D
    const hi = s + D
    if (M.levelOf(Math.max(0, lo)) !== r.low) return false
    if (!r.isRange) continue
    if (M.levelOf(hi).min > r.high.min) return false
  }
  return true
})())

console.log('\n' + (fail === 0 ? '✅ 全部通过（' + pass + ' 项）' : '❌ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项'))
process.exit(fail === 0 ? 0 : 1)
