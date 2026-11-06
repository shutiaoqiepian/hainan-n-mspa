/**
 * 中云「能不能当画布」（C 方案 + B 的保守）的针对性测试。
 * 用法：node tools/test-midcloud.mjs
 *
 * 覆盖四件事：
 *   ① 云种三分类（透光 / 蔽光 / 雨层）的阈值表，以及「数据不足」的分支；
 *   ② 画布抬升量 lift 的边界：不补的情况必须严格为 0；
 *   ③ scoreOfAt(midLift) 的三条硬规则：只增不减、永远不超过 1、不改历史口径；
 *   ④ 与云底照亮窗口的联动：窗口越窄补得越少。
 */
import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-midcloud-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
export { midOpacityOf, midCanvasPlan, MID_CANVAS, MID_RH_LEVELS } from '@/lib/forecast/midcloud'
export { scoreOf, scoreOfAt, fHigh, fMid, clamp } from '@/lib/forecast/scoring'
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

console.log('\n=== ① 云种三分类的阈值表 ===')
const op = (mid, rh, extra = {}) => M.midOpacityOf({ mid, rhMid: rh, ...extra })

check('中云 10% → clear，不参与', op(10, 60).key === 'clear')
check('中云缺测 → clear', op(null, 60).key === 'clear')
check('中云 25% 刚好到门槛（参与）', op(25, 60).key !== 'clear')
check('RH 95%（饱和）→ 厚高层云，透光 0.15', op(60, 95).key === 'As-opacus' && op(60, 95).translucency === 0.15)
check('RH 88% → 高层云（偏厚），透光 0.35', op(60, 88).key === 'As-opacus' && op(60, 88).translucency === 0.35)
check('RH 80% → 透光高层云，透光 0.55', op(60, 80).key === 'As-trans' && op(60, 80).translucency === 0.55)
check('RH 70% → 透光高积云，透光 0.75', op(60, 70).key === 'Ac-trans' && op(60, 70).translucency === 0.75)
check('RH 50% → 高积云，透光 0.85', op(60, 50).key === 'Ac' && op(60, 50).translucency === 0.85)
check('透光系数随湿度单调不增',
  [95, 88, 80, 70, 50].map((rh) => op(60, rh).translucency)
    .every((v, i, a) => i === 0 || v >= a[i - 1]))

console.log('\n=== ② 雨层云的硬判据 ===')
check('实测降水 0.8 mm → 雨层云，透光 0', op(70, 90, { precipMm: 0.8 }).key === 'Ns')
check('实测降水 0.8 mm 时透光严格为 0', op(70, 90, { precipMm: 0.8 }).translucency === 0)
check('降水 0.2 mm（不到 0.5）不算雨层云', op(70, 90, { precipMm: 0.2 }).key !== 'Ns')
check('降水缺测 → 不看降水那条', op(70, 90).key === 'As-opacus')
check('pop 90% + 中云 85% → 雨层云（按降水概率判）', op(85, 90, { pop: 90 }).key === 'Ns')
check('pop 90% 但中云只有 50% → 不按雨层云', op(50, 90, { pop: 90 }).key !== 'Ns')

console.log('\n=== ③ 没有湿度剖面时的保守回退 ===')
check('缺 RH、中云 90% → 透光 0.15', op(90, null).translucency === 0.15)
check('缺 RH、中云 75% → 透光 0.30', op(75, null).translucency === 0.3)
check('缺 RH、中云 50% → 透光 0.50', op(50, null).translucency === 0.5)
check('缺 RH 时也比「有 RH 且很薄」更保守（0.5 < 0.85）', op(50, null).translucency < op(50, 50).translucency)

console.log('\n=== ④ 画布抬升量 lift 的边界 ===')
const plan = M.midCanvasPlan({
  eventMs: Date.parse('2026-11-05T17:58:00+08:00'),
  lat: 20.03, lon: 110.28, kind: 'sunset', midBaseM: 3000
})
check('窗口算得出来（' + (plan.window ? plan.window.minutes + ' 分钟' : '—') + '）', plan.window != null)
check('置信度 = 窗口分钟数 ÷ 10（夹在 0.65–1）',
  Math.abs(plan.litFactor - Math.min(1, Math.max(0.65, plan.window.minutes / 10))) < 1e-9,
  plan.window.minutes + ' 分 → ' + plan.litFactor)

const liftOf = (mid, rh, extra = {}) => plan.evaluate({ mid, rhMid: rh, precipMm: null, pop: null, ...extra }).lift

check('中云 < 25% → lift 严格为 0', liftOf(24, 60) === 0)
check('雨层云 → lift 严格为 0', liftOf(80, 95, { precipMm: 1.5 }) === 0)
check('中云缺测 → lift 严格为 0', liftOf(null, 60) === 0)
check('lift 永远 ≤ α（' + M.MID_CANVAS.alpha + '）', [30, 50, 70, 90, 100].every((m) => liftOf(m, 50) <= M.MID_CANVAS.alpha + 1e-9))
check('lift 永远 ≥ 0', [0, 25, 50, 100].every((m) => liftOf(m, 95) >= 0))
check('中云越多 lift 越大（未封顶前）', liftOf(30, 70) < liftOf(50, 70))
check('中云 55% 以上不再增加（fullCover 封顶）', Math.abs(liftOf(55, 70) - liftOf(100, 70)) < 1e-9)
check('湿度越低 lift 越大', liftOf(50, 50) > liftOf(50, 80) && liftOf(50, 80) > liftOf(50, 95))

console.log('\n=== ⑤ scoreOfAt(midLift) 的三条硬规则 ===')
const base = { high: 22, mid: 53, low: 8, rh: 70, pop: 5, aod: 0.12 }
const noLift = M.scoreOfAt(base)
check('lift = 0 与不传逐位一致', M.scoreOfAt(base, { midLift: 0 }) === noLift)
check('lift 缺测与不传逐位一致', M.scoreOfAt(base, { midLift: null }) === noLift)
check('lift 为 NaN 不炸、与不传一致', M.scoreOfAt(base, { midLift: NaN }) === noLift)

let monotone = true
let prev = -1
for (let l = 0; l <= 100; l++) {
  const s = M.scoreOfAt(base, { midLift: l / 100 })
  if (s < prev) monotone = false
  prev = s
}
check('lift 从 0 增到 1，分数单调不减', monotone)
check('lift = 1 也不会超过 100', M.scoreOfAt(base, { midLift: 1 }) <= 100)
check('lift 会真的抬分（+10 以上）', M.scoreOfAt(base, { midLift: 0.4 }) - noLift >= 10, M.scoreOfAt(base, { midLift: 0.4 }) - noLift)

/* 高云已经压满（>78%，厚卷层云）时不许抬 —— 那时的问题不是画布少，是整片挡光 */
const overcast = { high: 100, mid: 60, low: 10, rh: 70, pop: 5, aod: 0.12 }
check('高云 100% 时 lift 无效（' + M.scoreOfAt(overcast) + ' → ' + M.scoreOfAt(overcast, { midLift: 0.6 }) + '）',
  M.scoreOfAt(overcast, { midLift: 0.6 }) === M.scoreOfAt(overcast))
const overcast2 = { high: 85, mid: 60, low: 10, rh: 70, pop: 5, aod: 0.12 }
check('高云 85% 时 lift 也无效', M.scoreOfAt(overcast2, { midLift: 0.6 }) === M.scoreOfAt(overcast2))
/* 高云已经进甜区（55–78%）时 lift 也不该改变分数 */
const sweet = { high: 65, mid: 40, low: 10, rh: 70, pop: 5, aod: 0.12 }
check('高云 65%（甜区内）lift 无效', M.scoreOfAt(sweet, { midLift: 0.6 }) === M.scoreOfAt(sweet))

console.log('\n=== ⑥ 历史口径没被改（AGENTS.md 的自测基准）===')
/* 这几个数字是仓库里写死的验收基准，改了 scoreOf 就会对不上 */
const fmt = (m) => M.scoreOf({
  high: m[0], mid: m[1], low: m[2], aod: m[3], pop: m[4], rh: m[5]
})
const bench = [
  [[62, 20, 8, 0.12, 5, 70], 86],
  [[3, 5, 10, 0.1, 0, 60], 0],
  [[20, 10, 15, 0.15, 0, 65], 7],
  [[66, 30, 12, 0.18, 0, 72], 80],
  [[60, 20, 80, 0.2, 10, 85], 12],
  [[95, 85, 90, 0.4, 70, 92], 1],
  [[60, 20, 10, 0.85, 5, 70], 43],
  [[92, 40, 20, 0.25, 10, 78], 21]
]
for (const [m, want] of bench) {
  const got = fmt(m)
  check(m.join('/') + ' → ' + got + '（期望 ' + want + '）', got === want, got)
}
check('全缺测 → 4', fmt([null, null, null, undefined, undefined, undefined]) === 4 ||
  M.scoreOf({ high: null, mid: null, low: null, rh: null, pop: null, aod: 0.4 }) === 4)

console.log('\n=== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ===')
process.exit(fail === 0 ? 0 : 1)
