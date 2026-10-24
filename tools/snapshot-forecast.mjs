/**
 * 每天存一份「当天日落时刻的预报快照」，用于和 METAR 实况配对、事后算误报率。
 *
 * 为什么需要：data/forecast/*.json 每 6 小时被覆盖一次，历史分数留不下来。
 * 没有历史快照，就没法回答「那次预报到底准不准」。
 *
 * 存什么：只存分析要用的字段（每机位一行），不存原始 hourly。
 *   机位、分区、分数、等级、三层云量、AOD、降水概率、湿度、模式分歧
 *   一份约 4 KB；git 压缩后约 1 KB。
 *
 * 用法：
 *   node tools/snapshot-forecast.mjs            # 所有有缓存的省份
 *   node tools/snapshot-forecast.mjs hn gd      # 只做这几个
 *
 * 依赖 esbuild 打包 src/ 里的评分代码（算法不在这里抄第二遍）。
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'data', 'obs')
const SRC_DIR = path.join(ROOT, 'data', 'forecast')

/** 只打一次包，然后对每个省调用 */
async function makeComputer() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-snap-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
import { load } from '@/lib/forecast/api'
import { state } from '@/lib/forecast/state'

export async function computeFor(prov: string, fixture: string) {
  ;(globalThis as any).fetch = async () => new Response(fixture, { status: 200 })
  ;(globalThis as any).location = { search: '', href: 'http://localhost/forecast' }
  ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

  state.prov = prov
  state.kind = 'sunset'
  state.day = 0
  state.model = 'multi'
  state.area = '全部'

  load()
  await new Promise((r) => setTimeout(r, 60))

  return {
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

  const mod = await import(pathToFileURL(outfile).href)
  return mod.computeFor
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  let provs = args

  if (!provs.length) {
    if (!existsSync(SRC_DIR)) throw new Error('找不到 data/forecast/')
    provs = (await readdir(SRC_DIR))
      .filter((f) => f.endsWith('.json') && !f.startsWith('forecast-'))
      .map((f) => f.replace(/\.json$/, ''))
  }
  if (!provs.length) throw new Error('没有可处理的省份')

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  const computeFor = await makeComputer()
  let ok = 0
  let skipped = 0
  let totalRows = 0

  for (const prov of provs) {
    const file = path.join(SRC_DIR, prov + '.json')
    if (!existsSync(file)) { skipped++; continue }

    let snap
    try {
      snap = await computeFor(prov, await readFile(file, 'utf8'))
    } catch (e) {
      console.error('[skip] ' + prov + ' → ' + e.message)
      skipped++
      continue
    }
    if (!snap || !snap.rows || !snap.rows.length) { skipped++; continue }

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
    ok++
    totalRows += snap.rows.length
  }

  const sample = provs[0]
  const sampleDay = new Date().toISOString().slice(0, 10)
  console.log('写好了 ' + ok + ' 个省（跳过 ' + skipped + '），共 ' + totalRows + ' 行机位快照')
  console.log('示例文件：data/obs/forecast-' + sample + '-<日期>.json')
  void sampleDay
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
