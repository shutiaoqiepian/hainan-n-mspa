#!/usr/bin/env node
/**
 * 降水场（rainMmH）的契约测试：**缺测绝不能变成 0**。
 *
 * 为什么单独测这一条：降水是"看不见就以为没下雨"最容易出错的字段。
 * 规则：
 *   ① 缓存里 rainMmH 为 null → expandPoints 必须给 null（不是 0）；
 *   ② 下标 10（rainMmH）必须与 levelFields 里的位置一致；
 *   ③ 降水率量级合理（0–200 mm/h），负值或超量级 = 单位搞错了。
 *
 * 用法：node tools/test-rain.mjs
 */
import { mkdtempSync } from 'node:fs'
import { writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const { build } = await import('esbuild')
const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-rain-'))
const entry = path.join(tmp, 'entry.ts')
await writeFile(entry, `export { expandPoints, fieldIndex } from '@/lib/xsec/model'`, 'utf8')
const outfile = path.join(tmp, 'm.mjs')
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error' })
const M = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (detail != null ? '  → ' + detail : '')) }
}

const index = JSON.parse(await readFile(path.join(ROOT, 'data/cross/index.json'), 'utf8'))
let sections = 0
let rainNonNull = 0
let outOfRange = 0
for (const meta of index.spots) {
  const f = JSON.parse(await readFile(path.join(ROOT, 'data/cross', meta.file), 'utf8'))
  check(`${meta.id} levelFields 含 rainMmH`, f.levelFields.includes('rainMmH'), f.levelFields.join(','))
  const idx = M.fieldIndex(f.levelFields)
  check(`${meta.id} rainMmH 下标 = ${f.levelFields.length - 1}`, idx.rainMmH === f.levelFields.length - 1, idx.rainMmH)
  for (const sec of f.sections) {
    sections++
    for (const p of M.expandPoints(f, sec)) {
      for (const lv of p) {
        if (lv.rainMmH === null) continue
        rainNonNull++
        if (!(lv.rainMmH >= 0 && lv.rainMmH <= 200)) outOfRange++
      }
    }
  }
}
check(`共检查 ${sections} 条剖面`, sections > 0)
check(`降水值都在 0–200 mm/h`, outOfRange === 0, `越界 ${outOfRange}`)
console.log(`  ℹ 非空降水点 ${rainNonNull} 个（其余为 0 或 null；null 与 0 在 expandPoints 里是区分的）`)

/* 造一条"全是 null"的最小 section，验证不会被当成 0 */
const fakeFile = {
  levelFields: ['hgtM', 'tC', 'rhPct', 'clwMgKg', 'iciMgKg', 'uMs', 'vMs', 'wPaS', 'cfPct', 'belowGround', 'rainMmH'],
  levelsHpa: [1000]
}
const fakeSection = {
  az: 0, t: 0, leadHours: 0, gridNodes: [],
  samples: [{ d: 0, lat: 0, lon: 0, terrainM: 0, levels: [[100, 20, 50, null, null, null, null, null, null, 0, null]] }]
}
const pts = M.expandPoints(fakeFile, fakeSection)
check('缺测降水读出来仍是 null（不是 0）', pts[0][0].rainMmH === null, pts[0][0].rainMmH)

console.log(`\n=== 汇总：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail === 0 ? 0 : 1)
