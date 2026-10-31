/**
 * 数据缺口自检：找出「本应有但没有」的每日数据，并给出补跑命令。
 *
 *   node tools/check-gaps.mjs            # 只报告
 *   node tools/check-gaps.mjs --strict   # 有缺口就 exit 1（给 CI 用）
 *
 * 查三类缺口（基准 = data/obs/metar-*.csv 里出现过的观测日）：
 *   1) 缺预报快照   data/obs/forecast-<省>-<日期>.json
 *   2) 缺 accuracy 存档  data/obs/accuracy/<日期>T*.json
 *   3) 快照「日期和内容对不上」：目标日期 ≠ 文件名日期（2026-10-28 那种）
 *
 * 为什么要有它：2026-10-28 那天快照看起来有，实际用的是前一天晚上的缓存，
 * 结果 A 级校验样本静默丢了一天，7 天后才被发现。机器应该自己发现这种事。
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OBS = path.join(ROOT, 'data', 'obs')
const ACC = path.join(OBS, 'accuracy')

/** 北京时间今天 */
function bjToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

async function metarDays() {
  if (!existsSync(OBS)) return []
  const files = (await readdir(OBS)).filter((f) => f.startsWith('metar-') && f.endsWith('.csv'))
  const days = new Set()
  for (const f of files) {
    const text = await readFile(path.join(OBS, f), 'utf8')
    for (const line of text.split('\n').slice(1)) {
      /* time_bj 是第 4 列，形如 2026-10-24 21:30 */
      const col = line.split(',')[3]
      if (col && /^\d{4}-\d{2}-\d{2}/.test(col)) days.add(col.slice(0, 10))
    }
  }
  return [...days].sort()
}

async function snapshotDays() {
  if (!existsSync(OBS)) return new Map()
  const files = (await readdir(OBS)).filter((f) => /^forecast-.+-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  const byDay = new Map()
  for (const f of files) {
    const m = f.match(/-(\d{4}-\d{2}-\d{2})\.json$/)
    const day = m ? m[1] : ''
    byDay.set(day, (byDay.get(day) || 0) + 1)
  }
  return byDay
}

async function accuracyDays() {
  if (!existsSync(ACC)) return new Set()
  const files = (await readdir(ACC)).filter((f) => /^\d{4}-\d{2}-\d{2}T/.test(f))
  const days = new Set()
  for (const f of files) {
    days.add(f.slice(0, 10))
    try {
      const j = JSON.parse(await readFile(path.join(ACC, f), 'utf8'))
      for (const d of j.days || []) days.add(d)
    } catch { /* 坏档跳过 */ }
  }
  return days
}

/** 快照文件名日期 vs 内部 targetDate 对不上的文件 */
async function mismatchedSnapshots() {
  if (!existsSync(OBS)) return []
  const files = (await readdir(OBS)).filter((f) => /^forecast-.+-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  const bad = []
  for (const f of files) {
    const m = f.match(/-(\d{4}-\d{2}-\d{2})\.json$/)
    const fileDay = m ? m[1] : ''
    try {
      const j = JSON.parse(await readFile(path.join(OBS, f), 'utf8'))
      const inner = j.targetDate || ''
      if (fileDay && inner && fileDay !== inner) bad.push({ file: f, fileDay, inner })
    } catch {
      bad.push({ file: f, fileDay, inner: '(读不出来)' })
    }
  }
  return bad
}

async function main() {
  const strict = process.argv.includes('--strict')

  const metar = await metarDays()
  const snaps = await snapshotDays()
  const acc = await accuracyDays()
  const bad = await mismatchedSnapshots()

  if (!metar.length) {
    console.log('没有 METAR 数据，先跑 node tools/fetch-metar.mjs')
    return
  }

  const today = bjToday()
  /* 「应快照」的日子 = 有 METAR 且早于今天（今天那次可能还没跑） */
  const should = metar.filter((d) => d < today)

  const missSnap = should.filter((d) => !snaps.has(d))
  const missAcc = should.filter((d) => !acc.has(d))

  console.log('===== 数据缺口自检 =====')
  console.log('METAR 覆盖 ' + metar.length + ' 天（' + metar[0] + ' ~ ' + metar[metar.length - 1] + '）')
  console.log('快照覆盖   ' + [...snaps.keys()].sort().filter((d) => snaps.get(d)).length + ' 天')
  console.log('accuracy   ' + acc.size + ' 天')
  console.log('')

  let problems = 0

  if (missSnap.length) {
    problems++
    console.log('❌ 缺预报快照 ' + missSnap.length + ' 天：' + missSnap.join(', '))
    for (const d of missSnap) {
      console.log('   该日期已过，当天的 A 级校验样本不可补（快照是当天算出来的），只能下次不再漏。')
    }
  } else {
    console.log('✅ 预报快照无缺口')
  }

  if (missAcc.length) {
    problems++
    console.log('❌ 缺 accuracy 存档 ' + missAcc.length + ' 天：' + missAcc.join(', '))
    console.log('   可补：node tools/check-accuracy.mjs --save（会按现有数据重算并写一份存档）')
  } else {
    console.log('✅ accuracy 存档无缺口')
  }

  if (bad.length) {
    problems++
    console.log('❌ 快照文件名与内部目标日期不一致 ' + bad.length + ' 个（这类文件等于脏数据）：')
    for (const b of bad.slice(0, 10)) console.log('   ' + b.file + '  文件名 ' + b.fileDay + ' / 内部 ' + b.inner)
    console.log('   处理：删除这些文件后重跑该日会产出正确版本（历史日期无法重算，直接删）')
  } else {
    console.log('✅ 快照日期全部自洽')
  }

  const yesterday = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10)
  if (!metar.includes(yesterday)) {
    console.log('⚠ 昨天（' + yesterday + '）没有 METAR 观测 —— 检查 metar-obs 定时任务是否成功')
    problems++
  }

  console.log('')
  if (problems) {
    console.log('共 ' + problems + ' 类问题。')
    if (strict) {
      console.log('::error::数据链路有缺口，见上面的清单')
      process.exit(1)
    }
  } else {
    console.log('✅ 数据链路完好，没有缺口。')
  }
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
