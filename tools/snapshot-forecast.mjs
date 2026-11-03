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
 *   node tools/snapshot-forecast.mjs --date 2026-10-31   # 补跑某一天（缓存目录需指向那天的缓存）
 *
 * 补跑某天时的规矩：缓存必须是**那天日落之前**生成的，否则等于用事后数据冒充事前预报。
 * 脚本会检查 generatedAt，晚了就拒绝。
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
      /* 线上评分实际用到的三个修正项系数。
         影子分数要用「同一口径的基线」，否则会拿裸分当基线（首版踩过：
         线上 7 个误报被影子算成 19 个）。缺测保持 null。 */
      horizonBlock: r.horizonBlock ?? null,
      rainRelief: r.rainRelief ?? null,
      aodRefMass: r.aodRefMass ?? null,
      aodRefEl: r.aodRefEl ?? null,
      /* 9 层气压云量：影子分数判断「薄卷云 / 厚层云」用；缺测保留 null */
      levelCover: r.levelCover ?? null,
      /* 降水量（该小时 mm）：影子分数判断「雨停转好」用 */
      precipMm: r.m.precipMm ?? null,
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
  const argv = process.argv.slice(2)
  const dateIdx = argv.indexOf('--date')
  const backfillDate = dateIdx >= 0 ? argv[dateIdx + 1] : null
  if (backfillDate && !/^\d{4}-\d{2}-\d{2}$/.test(backfillDate)) {
    throw new Error('--date 格式应为 YYYY-MM-DD，收到：' + backfillDate)
  }
  let provs = argv.filter((a, i) => !a.startsWith('-') && !(dateIdx >= 0 && i === dateIdx + 1))

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
  let late = 0
  let totalRows = 0

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const wantDay = backfillDate || today

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

    const day = snap.targetDate || wantDay
    if (backfillDate) {
      /* 补跑：缓存必须真的是「那天」的预报，且必须在日落之前生成 */
      if (day !== backfillDate) {
        console.error('[skip] ' + prov + ' → 缓存的目标日期是 ' + day + '，不是要补的 ' + backfillDate)
        stale++
        continue
      }
      const gen = Date.parse(JSON.parse(await readFile(file, 'utf8')).generatedAt || '')
      const sunset = Date.parse(backfillDate + 'T' + (snap.targetTime || '18:00') + ':00+08:00')
      if (!isNaN(gen) && !isNaN(sunset) && gen > sunset) {
        console.error(
          '[skip] ' + prov + ' → 缓存生成于 ' + new Date(gen).toISOString().slice(11, 16) + 'Z，' +
          '晚于当地日落（' + snap.targetTime + '）——那是事后数据，不能当预报用'
        )
        late++
        continue
      }
    } else if (day !== today) {
      /* 正常模式：快照的「目标日期」必须是今天（北京时间）。
         2026-10-28 那次就是吃了这个亏：缓存只覆盖当天+次日，
         UTC 12:00 跑的时候最新缓存是前一晚 19:42 生成的，
         算出来的目标日期是旧的，文件名却是当天 —— 静默写出脏数据。
         现在强制对齐，对不上就跳过并报错。 */
      console.error(
        '[skip] ' + prov + ' → 目标日期 ' + day + ' ≠ 北京时间今天 ' + today +
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
  console.log(
    '写好了 ' + ok + ' 个省（跳过 ' + skipped + '，缓存过旧 ' + stale + ' 个' +
    (late ? '，生成晚于日落 ' + late + ' 个' : '') + '），共 ' + totalRows + ' 行机位快照'
  )
  console.log('示例文件：data/obs/forecast-' + sample + '-' + wantDay + '.json')
  if (!backfillDate && stale && !ok) {
    console.error(
      '::error::全部省份的缓存都早于北京时间今天，今天的快照没有生成。' +
      '这会让当天的 A 级校验样本缺失 —— 检查 forecast-cache 定时任务是否成功。'
    )
    process.exit(1)
  }

  /* ── 「一个都没写出来」必须报错 ──
     2026-10-31 起，本脚本因为一个 const/let 笔误每天崩在 main() 里，
     CI 那一步是 continue-on-error，Actions 一直是绿的，连崩 3 天才被发现。
     上面第 126 行那个笔误已经改成 let，但同类「静默少写」的失败还会再来，
     所以在这里兜底：正常模式下 0 个省份写出 = 失败，不许 exit 0。
     （--date 补跑模式允许 0，因为「那天的缓存不在了」是正常情况） */
  if (!backfillDate && ok === 0) {
    console.error(
      '::error::一个省份的快照都没写出来（跳过 ' + skipped + '，缓存过旧 ' + stale + '）。' +
      '当天的 A 级校验样本会缺失 —— 先确认脚本本身没坏，再看缓存是否更新。'
    )
    process.exit(1)
  }
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
