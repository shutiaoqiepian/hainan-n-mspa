/**
 * 每天存一份「当天日落时刻的预报快照」，用于和 METAR 实况配对、事后算误报率。
 *
 * 为什么需要：data/forecast/*.json 每 6 小时被覆盖一次，历史分数留不下来。
 * 没有历史快照，就没法回答「那次预报到底准不准」。
 *
 * 存什么：只存分析要用的字段（每省每机位一行），不存原始 hourly，避免仓库膨胀。
 *   机位、分区、分数、等级、三层云量、AOD、降水概率、湿度、模式分歧、日落时刻
 *
 * 用法：
 *   node tools/snapshot-forecast.mjs            # 海南
 *   node tools/snapshot-forecast.mjs hn gd      # 指定省份
 *
 * 依赖 esbuild 打包 src/ 里的评分代码（避免在这里重抄一遍算法）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'data', 'obs')

/** 用真实源码跑一遍评分，返回每个机位一行 */
async function computeRows(prov) {
  const file = path.join(ROOT, 'data', 'forecast', prov + '.json')
  if (!existsSync(file)) throw new Error('缺数据文件：data/forecast/' + prov + '.json')
  const fixture = await readFile(file, 'utf8')

  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-snap-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
import { load } from '@/lib/forecast/api'
import { state } from '@/lib/forecast/state'

const FIXTURE = ${JSON.stringify(fixture)}
;(globalThis as any).fetch = async () => new Response(FIXTURE, { status: 200 })
;(globalThis as any).location = { search: '', href: 'http://localhost/forecast' }
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

state.prov = '${prov}'
state.kind = 'sunset'
state.day = 0
state.model = 'multi'

load()
await new Promise((r) => setTimeout(r, 60))

;(globalThis as any).__SNAP__ = {
  targetDate: state.targetDate,
  targetTime: state.targetTime,
  rows: state.rows.map((r) => ({
    n: r.spot.n,
    area: r.spot.area,
    face: r.spot.face,
    lat: r.spot.lat,
    lon: r.spot.lon,
    score: r.score,
    level: r.level.name,
    high: r.m.high == null ? null : Math.round(r.m.high),
    mid: r.m.mid == null ? null : Math.round(r.m.mid),
    low: r.m.low == null ? null : Math.round(r.m.low),
    aod: Math.round((r.m.aod ?? 0) * 100) / 100,
    pop: r.m.pop == null ? null : Math.round(r.m.pop),
    rh: r.m.rh == null ? null : Math.round(r.m.rh),
    spread: r.spread,
    faceOff: r.faceOff
  }))
}
`, 'utf8')

  const outfile = path.join(tmp, 'bundle.mjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': path.join(ROOT, 'src') },
    logLevel: 'error'
  })

  await import(pathToFileURL(outfile).href + '?t=' + Date.now())
  return globalThis.__SNAP__
}

async function main() {
  const provs = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (!provs.length) provs.push('hn')

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  for (const prov of provs) {
    const snap = await computeRows(prov)
    if (!snap || !snap.rows || !snap.rows.length) {
      console.error('[skip] ' + prov + ' 没有算出任何机位')
      continue
    }
    const day = snap.targetDate || new Date().toISOString().slice(0, 10)
    const out = path.join(OUT_DIR, 'forecast-' + prov + '-' + day + '.json')
    const payload = {
      prov,
      targetDate: snap.targetDate,
      targetTime: snap.targetTime,
      generatedAt: new Date().toISOString(),
      spots: snap.rows.length,
      rows: snap.rows
    }
    await writeFile(out, JSON.stringify(payload), 'utf8')
    const kb = Math.round(JSON.stringify(payload).length / 1024)
    console.log('写入 ' + path.relative(ROOT, out) + '（' + snap.rows.length + ' 个机位，约 ' + kb + ' KB）')
  }
}

main().catch((e) => {
  console.error('失败：', e)
  process.exit(1)
})
