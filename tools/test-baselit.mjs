/**
 * 云底照亮几何的验算（不需要框架）。
 * 用法：node tools/test-baselit.mjs
 *
 * 验的是三件事：
 *   ① 地球阴影角 θ = arccos(R/(R+h)) 的数值对不对（本文件的表格是全套推导的地基）；
 *   ② 窗口长度随高度单调增加，且和「θ ÷ 太阳下沉速率」的粗算一致；
 *   ③ 算不出的时候必须返回 null，不许编一个窗口出来。
 */
import { mkdtempSync, writeFile } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile as writeFileP } from 'node:fs/promises'

const ROOT = process.cwd()

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-baselit-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFileP(entry, `
export { earthShadowAngleDeg, baseLitWindow, litWindowFactor, baseLitFactor, EARTH_R_KM } from '@/lib/forecast/baselit'
export { sunPosition } from '@/lib/forecast/sun'
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

void writeFile

console.log('\n=== ① 地球阴影角 θ = arccos(R/(R+h)) ===')
/* 手算基准：h=1 km → R/(R+1)=6371/6372=0.99984294… → acos=0.0177225 rad=1.0154°
   h=3 km → 6371/6374=0.99952933… → acos=0.0306781 rad=1.7577° */
const cases = [
  [1000, 1.0154], [2000, 1.4362], [3000, 1.7577], [5000, 2.2693],
  [6000, 2.4853], [10000, 3.2084]
]
for (const [h, want] of cases) {
  const got = M.earthShadowAngleDeg(h)
  check(h + ' m → ' + got.toFixed(4) + '°（期望 ≈ ' + want + '）', Math.abs(got - want) < 0.01, got)
}
check('h=0 → 0（地面本身没有阴影角）', M.earthShadowAngleDeg(0) === 0)
check('h 为负 → 0（不产生负角）', M.earthShadowAngleDeg(-500) === 0)
check('h 缺测 → 0', M.earthShadowAngleDeg(NaN) === 0)
check('θ 随高度单调增加', [1000, 2000, 3000, 5000, 6000, 10000]
  .map((h) => M.earthShadowAngleDeg(h))
  .every((v, i, a) => i === 0 || v > a[i - 1]))

console.log('\n=== ② 照亮窗口的长度 ===')
/* 用海口（20.03N, 110.28E）秋分附近的一天：日落约 18:30 */
const LAT = 20.03
const LON = 110.28
const DAY = Date.parse('2026-11-05T00:00:00+08:00')

/** 找当天的日落时刻（太阳高度下降穿过 0） */
function sunsetMs() {
  const el = (ms) => M.sunPosition(ms, LAT, LON).el
  let prev = el(DAY + 3600000)
  for (let h = 2; h <= 24; h++) {
    const ms = DAY + h * 3600000
    const cur = el(ms)
    if (prev > 0 && cur <= 0) {
      let lo = ms - 3600000
      let hi = ms
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (el(mid) > 0) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    prev = cur
  }
  return null
}
const ss = sunsetMs()
check('能找到当天的日落时刻', ss != null)
/* 海口 11-05 日落应在 18:00 前后（北京时间 17:30–18:30） */
const ssHH = ss == null ? '' : new Date(ss + 8 * 3600000).toISOString().slice(11, 16)
check('日落时刻在合理范围（' + ssHH + '）', ss != null && ssHH >= '17:30' && ssHH <= '18:30', ssHH)

const heights = [1000, 2000, 3000, 6000, 10000]
const wins = heights.map((h) => M.baseLitWindow({ eventMs: ss, lat: LAT, lon: LON, cloudBaseM: h, kind: 'sunset' }))
wins.forEach((w, i) => {
  check(heights[i] + ' m 的窗口算得出来', w != null)
})
console.log('  实际窗口长度：' + heights.map((h, i) => h + 'm→' + (wins[i] ? wins[i].minutes : '—') + '分').join('，'))
check('窗口长度随高度单调不减', wins.every((w, i) => i === 0 || (w && wins[i - 1] && w.minutes >= wins[i - 1].minutes)))
check('1 km 约 4–6 分钟', wins[0] && wins[0].minutes >= 3 && wins[0].minutes <= 6, wins[0] && wins[0].minutes)
check('3 km 约 6–9 分钟', wins[2] && wins[2].minutes >= 6 && wins[2].minutes <= 9, wins[2] && wins[2].minutes)
check('10 km 约 12–16 分钟', wins[4] && wins[4].minutes >= 11 && wins[4].minutes <= 17, wins[4] && wins[4].minutes)
check('日落窗口从事件时刻开始', wins[2] && Math.abs(wins[2].startMs - ss) < 1000)
check('窗口终点在事件时刻之后', wins[2] && wins[2].endMs > ss)
check('窗口起点的阴影角与 3 km 的 θ 一致', wins[2] && Math.abs(wins[2].shadowAngleDeg - M.earthShadowAngleDeg(3000)) < 1e-9)

/* 日出方向相反：窗口在事件时刻**之前** */
const sr = (() => {
  const el = (ms) => M.sunPosition(ms, LAT, LON).el
  let prev = el(DAY + 3600000)
  for (let h = 2; h <= 30; h++) {
    const ms = DAY + h * 3600000
    const cur = el(ms)
    if (prev < 0 && cur >= 0) {
      let lo = ms - 3600000
      let hi = ms
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (el(mid) < 0) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    prev = cur
  }
  return null
})()
const wSr = sr == null ? null : M.baseLitWindow({ eventMs: sr, lat: LAT, lon: LON, cloudBaseM: 3000, kind: 'sunrise' })
check('日出窗口在事件时刻之前开始（' + (wSr ? wSr.minutes + ' 分钟' : '—') + '）', wSr != null && wSr.startMs < sr && Math.abs(wSr.endMs - sr) < 1000)

console.log('\n=== ③ 算不出时必须返回 null，不许编 ===')
check('云底缺测 → null', M.baseLitWindow({ eventMs: ss, lat: LAT, lon: LON, cloudBaseM: null, kind: 'sunset' }) === null)
check('云底 ≤ 0 → null', M.baseLitWindow({ eventMs: ss, lat: LAT, lon: LON, cloudBaseM: 0, kind: 'sunset' }) === null)
check('事件时刻不是真实日落（太阳已低于 −θ）→ null',
  M.baseLitWindow({ eventMs: ss + 2 * 3600000, lat: LAT, lon: LON, cloudBaseM: 3000, kind: 'sunset' }) === null)
check('极区（北纬 89°，冬半年太阳不升起）→ null',
  M.baseLitWindow({ eventMs: Date.parse('2026-12-21T12:00:00+08:00'), lat: 89, lon: 0, cloudBaseM: 3000, kind: 'sunset' }) === null)

console.log('\n=== ④ 窗口长度 → 置信度 ===')
check('缺测 → 0.65（保守下限）', M.litWindowFactor(null) === 0.65)
check('4 分钟 → 0.65（被下限夹住）', M.litWindowFactor(4) === 0.65)
check('7 分钟 → 0.70', Math.abs(M.litWindowFactor(7) - 0.7) < 1e-9, M.litWindowFactor(7))
check('10 分钟 → 1.00', M.litWindowFactor(10) === 1)
check('13 分钟 → 封顶 1.00', M.litWindowFactor(13) === 1)
check('置信度始终在 0.65–1', [1, 4, 7, 10, 20, 999].every((m) => {
  const v = M.litWindowFactor(m)
  return v >= 0.65 && v <= 1
}))

console.log('\n=== ⑤ 某一时刻的受光程度（解释用） ===')
check('太阳在地平线上 → 1', M.baseLitFactor(1, 3000) === 1)
check('太阳在 −1°（3 km 的 θ=1.76°）→ 1', M.baseLitFactor(-1, 3000) === 1)
check('太阳在 −4° → 0（云底已进阴影）', M.baseLitFactor(-4, 3000) === 0)
check('太阳在 −10° → 0', M.baseLitFactor(-10, 3000) === 0)
check('同一太阳高度，云越高越容易被照亮',
  M.baseLitFactor(-2.4, 6000) > M.baseLitFactor(-2.4, 1500),
  M.baseLitFactor(-2.4, 6000) + ' vs ' + M.baseLitFactor(-2.4, 1500))

console.log('\n=== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ===')
process.exit(fail === 0 ? 0 : 1)
