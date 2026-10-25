/**
 * 一句话汇报：现在算法到底准不准
 *
 *   node tools/accuracy-trend.mjs
 *
 * 只读 data/obs/accuracy/*.json（check-accuracy.mjs --save 每天写一份），
 * 不需要联网、不会改任何东西。周日回来看这一条就够。
 *
 * 判定分三档：
 *   样本不足   A 级可判定 <10 个 → 不下结论（这是前两周的正常状态）
 *   正常       A 级误报率 <25%
 *   要处理     A 级误报率 ≥25% 且样本 ≥10
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'data', 'obs', 'accuracy')

if (!existsSync(DIR)) {
  console.log('还没有 accuracy 存档。先跑：node tools/check-accuracy.mjs --save')
  process.exit(0)
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()
if (!files.length) {
  console.log('accuracy 目录是空的。先跑：node tools/check-accuracy.mjs --save')
  process.exit(0)
}

const snaps = []
for (const f of files) {
  try { snaps.push(JSON.parse(await readFile(path.join(DIR, f), 'utf8'))) } catch { /* 跳过坏档 */ }
}
if (!snaps.length) {
  console.log('accuracy 存档都读不出来')
  process.exit(0)
}

const last = snaps[snaps.length - 1]
const A = last.grades?.A ?? { samples: 0, judged: 0, falseAlarm: 0, falseAlarmRate: null }
const B = last.grades?.B ?? { samples: 0, judged: 0, falseAlarm: 0, falseAlarmRate: null }
const dates = [...new Set(snaps.flatMap((s) => s.days || []))].sort()

/* 最近 7 次存档里 A 级是否一直是 0 —— 那是链路坏了，不是"没样本" */
const tail = snaps.slice(-7)
const aZeroAlways = tail.length >= 3 && tail.every((s) => (s.grades?.A?.samples ?? 0) === 0)

console.log('===== 霞光预报 · 算法校验现状 =====')
console.log('存档 ' + snaps.length + ' 份，覆盖观测日 ' + (dates.length ? dates[0] + ' ~ ' + dates[dates.length - 1] + '（' + dates.length + ' 天）' : '无'))
console.log('最新一份：' + last.generatedAt + '　METAR ' + last.metarRows + ' 条 / ' + last.stations + ' 站 / 观测点 ' + last.obsSpots + ' 个')
console.log('')
console.log('A 级（同址配对，主口径）　样本 ' + A.samples + '　可判定 ' + A.judged +
  '　误报 ' + A.falseAlarm + (A.falseAlarmRate == null ? '' : '　误报率 ' + A.falseAlarmRate + '%'))
console.log('B 级（就近代表，仅参考）　样本 ' + B.samples + '　可判定 ' + B.judged +
  '　误报 ' + B.falseAlarm + (B.falseAlarmRate == null ? '' : '　误报率 ' + B.falseAlarmRate + '%'))
console.log('')

if (aZeroAlways) {
  console.log('⚠ A 级连着 ' + tail.length + ' 次存档都是 0 个样本 —— 不是"还没数据"，是链路断了。依次查：')
  console.log('   1) data/obs/stations-cn.json 里有没有 city/prov')
  console.log('   2) data/forecast/<省>.json 的 spots 数是否等于 spots.json 里的机位数')
  console.log('   3) data/obs/forecast-<省>-<日期>.json 里有没有「XX机场观测点」这一行')
} else if (A.judged < 10) {
  console.log('结论：样本还不够（' + A.judged + '/10），暂不下结论。继续每天自动累积，周日再看。')
} else if (A.falseAlarmRate >= 25) {
  console.log('结论：A 级误报率 ' + A.falseAlarmRate + '%，偏高（' + A.falseAlarm + '/' + A.judged + '）。')
  console.log('下一步：先看误报明细是"报高了"还是"漏报了"，再决定动哪个因子 —— 别先动 scoreOf。')
} else {
  console.log('结论：A 级误报率 ' + A.falseAlarmRate + '%，在可接受范围（' + A.falseAlarm + '/' + A.judged + '）。')
}

console.log('')
console.log('看明细：node tools/check-accuracy.mjs --only-a --top 40')

/* ---------- 挂起决定：条件到了就在这里点名 ----------
   tools/todo.mjs 是台账的单一事实来源。这里只做一件事：
   把「已经到期」的挂起决定喊出来，免得它沉在交接文档里被忘掉。 */
try {
  const { ITEMS } = await import('./todo.mjs')
  const due = []
  for (const item of ITEMS) {
    const m = item.trigger?.metric
    if (!m) continue
    if (m === 'aSamples30d' && dates.length >= 30) due.push([item, 'A 级已覆盖 ' + dates.length + ' 天'])
    if (m === 'aFalseAlarmWarning' && A.judged >= 10 && typeof A.falseAlarmRate === 'number' && A.falseAlarmRate >= 25) {
      due.push([item, 'A 级误报率 ' + A.falseAlarmRate + '%（n=' + A.judged + '）'])
    }
  }
  if (due.length) {
    console.log('')
    console.log('🔔 有 ' + due.length + ' 条挂起决定的条件已经满足，回来看：')
    for (const [it, why] of due) {
      console.log('   · [' + it.id + '] ' + it.title)
      console.log('     依据：' + why + '　详见：' + (it.doc || 'tools/todo.mjs'))
    }
    console.log('   处理步骤：node tools/todo.mjs --due')
  } else {
    console.log('挂起决定：0 条到期（全部清单：node tools/todo.mjs --all）')
  }
} catch {
  /* 台账文件不在也不影响主结论 */
}
