#!/usr/bin/env node
/**
 * 影子分的单元测试：证明「影子分不会比线上更容易报'能烧'」。
 *
 * 为什么要单独测这条：影子分的三个修正项都是乘法，首版实测就把 275 条
 * A 级样本的误报从 7 推到 19 —— 原因就是加分方向的系数把 45–47 分的样本
 * 推过了 48 的误报阈值。现在规则是：
 *   ① 加分方向一律打折（f>1 → 1 + 0.5(f−1)）；
 *   ② 最终分数封顶在基线（shadow ≤ base 恒成立）；
 *   ③ 基线为 0 时影子必须也是 0（不许凭空"修出"分数）。
 *
 * 用法：node tools/test-shadow.mjs
 */

import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-st-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
export { scoreShadow, continuityFactor, terrainFactor, precipFactor } from '@/lib/forecast/shadow'
export { scoreOfAt } from '@/lib/forecast/scoring'
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
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (detail != null ? '  → ' + detail : '')) }
}

const m = (o = {}) => ({
  high: 70, mid: 20, low: 10, rh: 80, pop: 0, t2m: 20, td2m: 10, vis: null,
  aod: 0.2, aodReal: 0.2, aodMissing: false, ...o
})

/* ---------- 1. 三个修正项的行为 ---------- */
console.log('\n=== 1. 修正项 ===')
const thin = M.continuityFactor([
  { hPa: 500, coverPct: 40, heightM: 5600 },
  { hPa: 400, coverPct: 10, heightM: 7200 }
])
check('薄卷云（1 层 ≥20%）→ 轻微加分', thin.f > 1 && thin.f <= 1.1, thin.f)
const thick = M.continuityFactor([
  { hPa: 500, coverPct: 90, heightM: 5600 },
  { hPa: 400, coverPct: 90, heightM: 7200 },
  { hPa: 300, coverPct: 85, heightM: 9200 }
])
check('厚层云（3 层连续且接近满云）→ 扣分', thick.f < 1, thick.f)
const none = M.continuityFactor(null)
check('无 9 层云量 → 不启用（×1）', none.f === 1 && none.on === false)

check('地形挡住 → 扣分', M.terrainFactor(true).f < 1)
check('地形不挡 → ×1', M.terrainFactor(false).f === 1)
check('没有 DEM → 不启用', M.terrainFactor(null).on === false)

check('正在下雨（≥1 mm）→ 扣分', M.precipFactor(2.5, 0).f < 1)
check('雨已停（过去 3 h ≥1 mm，当前 <0.2）→ 轻微加分', M.precipFactor(0, 3).f > 1 && M.precipFactor(0, 3).f <= 1.05)
check('无降水数据 → 不启用', M.precipFactor(null, null).on === false)

/* ---------- 2. 铁律：影子 ≤ 基线 ---------- */
console.log('\n=== 2. 影子分数封顶规则（shadow ≤ base） ===')
let worst = -Infinity
let upCount = 0
for (let high = 0; high <= 100; high += 5) {
  for (const mid of [0, 30, 60, 90]) {
    for (const low of [0, 25, 50, 80]) {
      for (const sunEl of [2, 0, -1, -3]) {
        const input = m({ high, mid, low })
        const base = M.scoreOfAt(input, { sunEl })
        const s = M.scoreShadow({
          m: input, sunEl,
          levels: [{ hPa: 500, coverPct: 40, heightM: 5600 }],
          terrainBlocks: false,
          precipMm: 0, precipPrev3hMm: 2
        })
        if (s.score > s.base) upCount++
        worst = Math.max(worst, s.score - s.base)
        if (s.base !== base) { upCount++ }   /* 基线必须与 scoreOfAt 完全一致 */
      }
    }
  }
}
check('全网格扫描：没有任何样本影子 > 基线', upCount === 0, `越界 ${upCount} 次，最大差 ${worst}`)

const zero = M.scoreShadow({ m: m({ high: 0 }), levels: [{ hPa: 500, coverPct: 100, heightM: 5600 }], precipMm: 0, precipPrev3hMm: 5 })
check('基线为 0 时影子也是 0（不许"修出"分数）', zero.score === 0, zero.score)

/* ---------- 3. 归因字段 ---------- */
console.log('\n=== 3. 归因 ===')
const r = M.scoreShadow({ m: m(), sunEl: 0, terrainBlocks: true, precipMm: 2, precipPrev3hMm: 3 })
check('三个系数都在结果里', typeof r.factors.continuity === 'number' && typeof r.factors.terrain === 'number' && typeof r.factors.precip === 'number')
check('notes 三条都写清楚', r.notes.length === 3 && r.notes.every((n) => typeof n === 'string' && n.length > 2))
check('地形扣分真的生效', r.score < r.base, `${r.base} → ${r.score}`)

console.log(`\n=== 汇总：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail === 0 ? 0 : 1)
