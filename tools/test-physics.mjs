/**
 * 物理修正项的针对性测试（不需要框架）。
 * 覆盖 2026-10-25 新增的四个改动：
 *   ① 斜程 AOD（大气质量）
 *   ② 地平线遮挡
 *   ③ 雨停转好
 *   ④ 峰值窗口（在 api 层，这里只测它在评分上的前提条件）
 *
 * 用法：node tools/test-physics.mjs
 */

import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-phys-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
export { scoreOf, scoreOfAt, airmass, aodSlant, clamp } from '@/lib/forecast/scoring'
export { horizonBlockOf } from '@/lib/forecast/api'
`, 'utf8')
  const outfile = path.join(tmp, 'm.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

const M = await load()
let pass = 0, fail = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (detail != null ? '  → ' + detail : '')) }
}

const base = { high: 62, mid: 20, low: 8, rh: 70, pop: 5, aod: 0.12 }

console.log('\n=== ① 大气质量与斜程 AOD ===')
check('天顶 airmass ≈ 1', Math.abs(M.airmass(90) - 1) < 0.01, M.airmass(90))
check('2° 时 airmass ≈ 19', Math.abs(M.airmass(2) - 19) < 1.5, M.airmass(2))
check('地平线 0° 时约 37.9（Kasten–Young）', Math.abs(M.airmass(0) - 37.9) < 0.2, M.airmass(0))
check('负高度与 0° 同值（不出现负光程）', M.airmass(-5) === M.airmass(0), M.airmass(-5))
check('airmass 随太阳升高单调下降', M.airmass(0) > M.airmass(5) && M.airmass(5) > M.airmass(20))

const aodHigh = M.aodSlant(0.3, 30, { refEl: 2 })   // 太阳高 → 等效 AOD 更小
const aodLow = M.aodSlant(0.3, 0, { refEl: 2 })     // 太阳贴地 → 等效 AOD 更大
check('太阳高时等效 AOD 变小（' + aodHigh.toFixed(3) + ' < 0.3）', aodHigh < 0.3)
check('太阳贴地时等效 AOD 变大（' + aodLow.toFixed(3) + ' > 0.3）', aodLow > 0.3)
check('等效 AOD 不超过 1.6 倍', aodLow <= 0.3 * 1.6 + 1e-9, aodLow)

/* 用窗口平均光程做基准时，同一窗口「高太阳+低太阳」应大致互相抵消 */
const mHigh = M.airmass(12)
const mLow = M.airmass(-1)
const refMass = (mHigh + mLow) / 2
const up = M.aodSlant(0.3, 12, { refMass })
const dn = M.aodSlant(0.3, -1, { refMass })
check('窗口基准下：高太阳变松、低太阳变紧（' + up.toFixed(3) + ' / ' + dn.toFixed(3) + '）', up < 0.3 && dn > 0.3)
check('两者偏离 0.3 的幅度同量级（不偏向某一侧）', Math.abs(dn - 0.3) / Math.abs(up - 0.3) < 3)

console.log('\n=== ② 斜程修正不改变「没有太阳高度」时的行为 ===')
check('sunEl 为 null 时等效 AOD 不变', M.aodSlant(0.3, null) === 0.3)
check('scoreOfAt 不传 opts = scoreOf', M.scoreOfAt(base) === M.scoreOf(base), M.scoreOfAt(base) + ' vs ' + M.scoreOf(base))

console.log('\n=== ③ 地平线遮挡 ===')
const mk = (low, mid) => ({
  west: { hourly: { cloud_cover_low: [low], cloud_cover_mid: [mid], cloud_cover_high: [40] } },
  east: null
})
check('西边无低云 → 1.0', M.horizonBlockOf(mk(0, 0), 'sunset', 0) === 1)
check('西边低云 55% → 约 0.78', Math.abs(M.horizonBlockOf(mk(55, 0), 'sunset', 0) - 0.775) < 0.02, M.horizonBlockOf(mk(55, 0), 'sunset', 0))
check('西边低云 100% → 0.55', Math.abs(M.horizonBlockOf(mk(100, 0), 'sunset', 0) - 0.55) < 0.01, M.horizonBlockOf(mk(100, 0), 'sunset', 0))
check('低云+中云都厚 → 压到 0.4 下限', M.horizonBlockOf(mk(100, 100), 'sunset', 0) === 0.4)
check('没有地平线数据 → 1.0（不启用）', M.horizonBlockOf(null, 'sunset', 0) === 1)
check('日出看东边：西边脏、东边缺数据 → 1.0', M.horizonBlockOf(mk(100, 100), 'sunrise', 0) === 1)

const clean = M.scoreOfAt(base, { horizonBlock: 1 })
const blocked = M.scoreOfAt(base, { horizonBlock: 0.55 })
check('地平线被挡时分数下降（' + clean + ' → ' + blocked + '）', blocked < clean && blocked > 0)

console.log('\n=== ④ 雨停转好只回补、不凭空加分 ===')
const dry = M.scoreOfAt(base, { rainRelief: 0 })
const relieved = M.scoreOfAt(base, { rainRelief: 1 })
check('回补后分数不降低（' + dry + ' → ' + relieved + '）', relieved >= dry)
check('回补幅度有限（≤ +6 分）', relieved - dry <= 6, relieved - dry)
const wetCase = { high: 62, mid: 20, low: 8, rh: 70, pop: 85, aod: 0.12 }
check('高降水概率时回补也只到「小烧」级别以内', M.scoreOfAt(wetCase, { rainRelief: 1 }) < 70, M.scoreOfAt(wetCase, { rainRelief: 1 }))

console.log('\n=== ⑤ 合成：坏天气 + 干净地平线 vs 好天气 + 脏地平线 ===')
const goodWeather = { high: 65, mid: 15, low: 10, rh: 70, pop: 5, aod: 0.12 }
const sClean = M.scoreOfAt(goodWeather, { horizonBlock: 1 })
const sDirty = M.scoreOfAt(goodWeather, { horizonBlock: 0.55 })
console.log('  头顶很好、西边干净：' + sClean + ' 分')
console.log('  头顶很好、西边一排低云：' + sDirty + ' 分')
check('同样头顶条件，西边脏会明显降分（差值 ≥ 20）', sClean - sDirty >= 20, sClean - sDirty)

console.log('\n' + (fail === 0 ? '✅ 全部通过（' + pass + ' 项）' : '❌ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项'))
process.exit(fail === 0 ? 0 : 1)
