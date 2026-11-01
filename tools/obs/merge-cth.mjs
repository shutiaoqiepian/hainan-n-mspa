/**
 * 把当天卫星取样并入按月存档（去重：同一天同一机位只保留一条）。
 *
 * 为什么要单独一个脚本：`sample-cth.mjs` 只负责取样（可单跑、可排错），
 * 合并进历史存档需要"幂等"——CI 每天跑一次，重跑不能产生重复行。
 *
 * 用法：
 *   node tools/obs/merge-cth.mjs --input /tmp/cth-today.json
 *   node tools/obs/merge-cth.mjs --input a.json --input b.json --check
 *
 * 输出：data/obs/cth-YYYY-MM.json（按 data.rows 数组，按月分文件，约 1 KB/机位/天）
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'data', 'obs')

async function main() {
  const args = process.argv.slice(2)
  const inputs = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputs.push(args[i + 1])
  }
  const check = args.includes('--check')
  if (!inputs.length) {
    console.error('用法：node tools/obs/merge-cth.mjs --input file.json [--input file2.json] [--check]')
    process.exit(2)
  }

  const fresh = []
  for (const f of inputs) {
    const raw = JSON.parse(await readFile(f, 'utf8'))
    /* 接受两种输入：取样脚本输出的数组，或按月存档的 {rows: []} */
    const list = Array.isArray(raw) ? raw : raw.rows
    if (!Array.isArray(list)) throw new Error(`${f} 既不是数组也没有 rows[]`)
    fresh.push(...list)
  }

  /* 按月分组 */
  const byMonth = new Map()
  for (const row of fresh) {
    if (!row?.date || !row?.spot) continue
    if (row.error) continue
    const m = row.date.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m).push(row)
  }

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })
  let added = 0
  let skipped = 0
  for (const [month, rows] of byMonth) {
    const p = path.join(OUT_DIR, `cth-${month}.json`)
    const raw = existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : { version: 1, rows: [] }
    /* 兼容早期格式：早期直接存数组 */
    const old = Array.isArray(raw) ? { version: 1, rows: raw } : raw
    if (!Array.isArray(old.rows)) old.rows = []
    const seen = new Set(old.rows.map((r) => `${r.date}|${r.spot}`))
    for (const r of rows) {
      const key = `${r.date}|${r.spot}`
      if (seen.has(key)) { skipped++; continue }
      old.rows.push(r)
      seen.add(key)
      added++
    }
    old.rows.sort((a, b) => (a.date === b.date ? a.spot.localeCompare(b.spot) : a.date.localeCompare(b.date)))
    old.generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    old.layer = 'MODIS_Terra_Cloud_Top_Height_Day (NASA GIBS)'
    if (!check) await writeFile(p, JSON.stringify(old, null, 1))
    console.log(`${check ? '[check] ' : ''}${p}：新增 ${added} 条，跳过重复 ${skipped} 条，现有 ${old.rows.length} 条`)
  }
  if (!byMonth.size) console.log('没有可合并的新数据')
}

main().catch((e) => { console.error(e); process.exit(1) })
