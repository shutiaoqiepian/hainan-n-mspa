/**
 * 候选实现 vs 基线的对照报告。
 *
 * 只做对照，不改生产代码。输出四组数字：
 *   ① 9 个自测用例在两种实现下的分数（看有没有跑偏）
 *   ② 今天 169 个机位的分数变化（看整体有没有平移、排序动没动）
 *   ③ 阈值附近还跳不跳（抖动测试）
 *   ④ 等级变化（多少机位从"小烧"变成"中烧"之类）
 *
 * 用法：node tools/compare-candidates.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

async function bundleCandidate() {
  const { build } = await import('esbuild')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-cand-'))
  const entry = path.join(tmp, 'entry.ts')
  await (await import('node:fs/promises')).writeFile(entry, `
export {
  scoreOfContinuous, scoreOfStep, fAodContinuous, fWetContinuous, K_AOD, K_POP, K_RH
} from '@/lib/forecast/candidates/continuous'
`, 'utf8')

  const outfile = path.join(tmp, 'cand.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

/** 与生产 levels.ts 一致的等级 */
const LEVELS = [
  { min: 92, name: '火烧云' }, { min: 82, name: '大烧' }, { min: 66, name: '中烧' },
  { min: 48, name: '小烧' }, { min: 30, name: '微烧' }, { min: 0, name: '不烧' }
]
const levelOf = (s) => LEVELS.find((l) => s >= l.min) ?? LEVELS[LEVELS.length - 1]

const CASES = [
  ['教科书级大烧', { high: 62, mid: 20, low: 8, aod: 0.12, pop: 5, rh: 70 }, 86],
  ['晴空无云', { high: 3, mid: 5, low: 10, aod: 0.1, pop: 0, rh: 60 }, 0],
  ['薄卷云偏少', { high: 20, mid: 10, low: 15, aod: 0.15, pop: 0, rh: 65 }, 7],
  ['云量最佳窗口', { high: 66, mid: 30, low: 12, aod: 0.18, pop: 0, rh: 72 }, 80],
  ['低云封地平线', { high: 60, mid: 20, low: 80, aod: 0.2, pop: 10, rh: 85 }, 12],
  ['厚云阴天', { high: 95, mid: 85, low: 90, aod: 0.4, pop: 70, rh: 92 }, 1],
  ['有霾', { high: 60, mid: 20, low: 10, aod: 0.85, pop: 5, rh: 70 }, 43],
  ['高云过厚', { high: 92, mid: 40, low: 20, aod: 0.25, pop: 10, rh: 78 }, 21],
  ['全部缺数据', { high: null, mid: null, low: null, aod: 0.2, pop: null, rh: null }, 4]
]

function spearman(a, b) {
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
    const r = new Array(arr.length)
    idx.forEach(([, i], k) => (r[i] = k))
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const d2 = ra.reduce((s, _, i) => s + (ra[i] - rb[i]) ** 2, 0)
  return 1 - (6 * d2) / (n * (n * n - 1))
}

async function main() {
  const C = await bundleCandidate()

  console.log('校准系数：K_AOD=' + C.K_AOD.toFixed(4) + '  K_POP=' + C.K_POP.toFixed(4) + '  K_RH=' + C.K_RH.toFixed(4))
  console.log('（系数让连续曲线的平均值与原阶梯一致，避免整体平移）\n')

  /* ① 自测用例 */
  console.log('=== ① 9 个自测用例 ===')
  console.log('用例'.padEnd(14, '　') + ' 基线  连续   差  期望')
  let drift = 0
  for (const [name, m, expect] of CASES) {
    const base = C.scoreOfStep(m)
    const cand = C.scoreOfContinuous(m)
    const d = cand - base
    drift = Math.max(drift, Math.abs(d))
    console.log(
      name.padEnd(12, '　') + ' ' +
      String(base).padStart(4) + ' ' +
      String(cand).padStart(4) + ' ' +
      (d >= 0 ? '+' : '') + String(d).padStart(3) + '  ' +
      String(expect)
    )
  }
  console.log('自测用例上最大偏差：' + drift + ' 分')

  /* ② 今天的 169 个机位 */
  const obsDir = path.join(ROOT, 'data', 'obs')
  const files = existsSync(obsDir)
    ? (await readdir(obsDir)).filter((f) => f.startsWith('forecast-') && f.endsWith('.json'))
    : []

  const rows = []
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(obsDir, f), 'utf8'))
    for (const r of j.rows) {
      if (r.high == null || r.low == null || r.mid == null) continue
      rows.push({
        n: r.n, prov: j.prov,
        m: {
          high: r.high, mid: r.mid, low: r.low,
          rh: r.rh, pop: r.pop,
          aod: r.aod == null ? 0.2 : r.aod
        }
      })
    }
  }

  if (rows.length) {
    const baseScores = rows.map((r) => C.scoreOfStep(r.m))
    const candScores = rows.map((r) => C.scoreOfContinuous(r.m))
    const diffs = candScores.map((v, i) => v - baseScores[i])
    const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length
    const absMean = diffs.reduce((s, x) => s + Math.abs(x), 0) / diffs.length
    const maxAbs = Math.max(...diffs.map(Math.abs))
    const rho = spearman(baseScores, candScores)

    let levelChanged = 0
    const levelPairs = {}
    for (let i = 0; i < rows.length; i++) {
      const a = levelOf(baseScores[i]).name
      const b = levelOf(candScores[i]).name
      if (a !== b) {
        levelChanged++
        const k = a + '→' + b
        levelPairs[k] = (levelPairs[k] || 0) + 1
      }
    }

    console.log('\n=== ② 今天 ' + rows.length + ' 个机位 ===')
    console.log('平均变化：' + (mean >= 0 ? '+' : '') + mean.toFixed(2) + ' 分')
    console.log('平均绝对变化：' + absMean.toFixed(2) + ' 分')
    console.log('最大变化：' + (maxAbs >= 0 ? '+' : '') + maxAbs.toFixed(0) + ' 分')
    console.log('排序相关（Spearman）：' + rho.toFixed(4) + (rho > 0.99 ? '（排序几乎不变）' : rho > 0.95 ? '（排序基本稳定）' : '（排序明显变动）'))
    console.log('等级变化：' + levelChanged + ' / ' + rows.length + ' 个' + (Object.keys(levelPairs).length ? '　' + JSON.stringify(levelPairs) : ''))

    /* 变化最大的前 5 个 */
    const worst = rows.map((r, i) => ({ n: r.n, prov: r.prov, base: baseScores[i], cand: candScores[i], d: diffs[i] }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5)
    console.log('\n变化最大的 5 个：')
    for (const w of worst) {
      console.log('  ' + String(w.n).padEnd(14, '　') + ' ' + w.base + ' → ' + w.cand +
        '（' + (w.d >= 0 ? '+' : '') + w.d + '）')
    }
  }

  /* ③ 抖动测试：阈值两侧 0.2 个单位 */
  console.log('\n=== ③ 阈值附近还跳不跳（同一输入只挪 0.2 个单位）===')
  const probe = { high: 62, mid: 20, low: 8, aod: 0.12, pop: 5, rh: 70 }
  const edges = [
    ['降水 40%', { pop: 39.9 }, { pop: 40.1 }],
    ['降水 70%', { pop: 69.9 }, { pop: 70.1 }],
    ['湿度 88%', { rh: 87.9 }, { rh: 88.1 }],
    ['湿度 93%', { rh: 92.9 }, { rh: 93.1 }],
    ['AOD 0.3', { aod: 0.299 }, { aod: 0.301 }],
    ['AOD 0.5', { aod: 0.499 }, { aod: 0.501 }]
  ]
  console.log('阈值'.padEnd(10, '　') + ' 基线跳变   连续跳变')
  let baseMax = 0
  let candMax = 0
  for (const [name, lo, hi] of edges) {
    const b = Math.abs(C.scoreOfStep({ ...probe, ...hi }) - C.scoreOfStep({ ...probe, ...lo }))
    const c = Math.abs(C.scoreOfContinuous({ ...probe, ...hi }) - C.scoreOfContinuous({ ...probe, ...lo }))
    baseMax = Math.max(baseMax, b)
    candMax = Math.max(candMax, c)
    console.log(name.padEnd(10, '　') + ' ' + String(b).padStart(6) + ' 分    ' + String(c).padStart(6) + ' 分')
  }
  console.log('最大跳变：基线 ' + baseMax + ' 分 → 连续 ' + candMax + ' 分')

  console.log('\n结论要点：')
  console.log('- 若"平均变化"接近 0 而"平均绝对变化"小，说明只是抹平了跳变，没有整体平移；')
  console.log('- 若"排序相关"接近 1，说明推荐顺序基本不变，用户不会觉得"换了个网站"；')
  console.log('- 若"等级变化"较多，需要人工确认这些变化是否符合物理直觉，再决定是否替换。')
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
