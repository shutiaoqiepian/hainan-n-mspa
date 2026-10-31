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
      rawScore: r.rawScore,
      level: r.level.name,
      /* 原始输入（缺测保留 null，不要填默认值）——
         存下来才能「用新公式重算历史」，否则只能比总分 */
      high: r.m.high == null ? null : Math.round(r.m.high * 10) / 10,
      mid: r.m.mid == null ? null : Math.round(r.m.mid * 10) / 10,
      low: r.m.low == null ? null : Math.round(r.m.low * 10) / 10,
      rh: r.m.rh == null ? null : Math.round(r.m.rh * 10) / 10,
      pop: r.m.pop == null ? null : Math.round(r.m.pop * 10) / 10,
      aod: r.m.aodMissing ? null : Math.round(r.m.aod * 100) / 100,
      t2m: r.m.t2m == null ? null : Math.round(r.m.t2m * 10) / 10,
      td2m: r.m.td2m == null ? null : Math.round(r.m.td2m * 10) / 10,
      vis: r.m.vis == null ? null : Math.round(r.m.vis),
      sunAz: r.sunAz,
      sunEl: r.detail.sunEl,
      spread: r.spread,
      models: r.models,
      faceOff: r.faceOff,
      quality: r.quality
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
  let stale = 0
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

    /* ★ 快照的「目标日期」必须是今天（北京时间），不能盲信缓存里的第一行日期。
       2026-10-28 那次就是吃了这个亏：
         预报缓存每天 4 次（UTC 01/07/13/19），本 workflow 在 UTC 12 跑。
         UTC 10-28 12:00 时最新缓存还是 UTC 10-27 19:42 生成的那份，
         它只覆盖 10-28~10-29 —— 算出来的目标日期是 10-28，文件名也是 10-28，
         但用的其实是前一天晚上的数据，当天 01:55 生成的新缓存根本没赶上。
         结果：10-28 的快照「看起来有」，实际是旧数据，还和 10-27 的重复。
       现在强制用北京时间的今天；对不上就跳过并报错，不再静默写错文件。 */
    const bjToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const day = snap.targetDate || bjToday
    if (day !== bjToday) {
      console.error(
        '[skip] ' + prov + ' → 目标日期 ' + day + ' ≠ 北京时间今天 ' + bjToday +
        '（缓存太旧，等 forecast-cache 更新完再跑）'
      )
      stale++
      continue
    }
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
  console.log('写好了 ' + ok + ' 个省（跳过 ' + skipped + '，缓存过旧 ' + stale + ' 个），共 ' + totalRows + ' 行机位快照')
  console.log('示例文件：data/obs/forecast-' + sample + '-<日期>.json')
  if (stale && !ok) {
    console.error(
      '::error::全部省份的缓存都早于北京时间今天，今天的快照没有生成。' +
      '这会让当天的 A 级校验样本缺失 —— 检查 forecast-cache 定时任务是否成功。'
    )
    process.exit(1)
  }
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
