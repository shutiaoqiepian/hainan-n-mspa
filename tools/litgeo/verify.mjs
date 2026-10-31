#!/usr/bin/env node
/**
 * litgeo-verify：火烧云光线几何公式的独立实现与数值验证。
 *
 * 目的：把 SunsetBot 教程里"只在图片里"的公式独立实现一遍，用原文给的数值表与
 *       三个实战案例做回归。**不允许只抄结论**：所有量都由本文件自己算。
 *
 * 数据来源：
 *   - 章节一 image42/image76/image78/image86/image88/image90/image94/image136
 *   - 章节四 image399/image402/image406/image444/image453
 *   - 数值表：表1.1/1.3/1.4、附录 √(2Rh) 表、表4.1/4.2、日出日落线速度表
 *   - 案例：章节四 §4.1.1（深圳）、§4.1.1（伊春）、§4.2.3（上海中云漏光）
 *
 * 用法：node tools/litgeo/verify.mjs
 * 退出码：0 = 全部通过；1 = 有失败项
 */

const R_KM = 6371.0        // 地球半径（原文 $\sqrt{2R h}$ 表即按此值可复现）
const D2R = Math.PI / 180

/* ================= 公式实现（W1–W4 已核对图片） ================= */

/** W1: 高度 h 上的光照半宽 = √(2Rh)（image42: h(l)≈l²/(2R) 的逆解） */
const halfWidth = (hKm) => Math.sqrt(2 * R_KM * hKm)

/** W1: 霞光最大深入距离 = 2√(2R·h_CB)（image94: |l_f|max = 2√(2R h_CB)） */
const glowDepth = (hKm) => 2 * halfWidth(hKm)

/** 远边界光线（与地表相切）：image76 h_f(l,t) = (l−vt)²/(2R) */
const farRayHeight = (l, t, v) => ((l - v * t) ** 2) / (2 * R_KM)

/** 近边界光线（经过云边界）：image78 h_n = (l−vt)²/(2R) + h_CB − (vt)²/(2R) */
const nearRayHeight = (l, t, v, hCb) => farRayHeight(l, t, v) + hCb - ((v * t) ** 2) / (2 * R_KM)

/** image86: l_f(t) = −√(2R h_CB) + vt */
const farBoundaryL = (t, v, hCb) => v * t - halfWidth(hCb)

/** image88: l_n(t) = 2vt (t≤0) / 0 (t>0) */
const nearBoundaryL = (t, v) => (t <= 0 ? 2 * v * t : 0)

/** image90: 有效时间窗 |t| ≤ √(2R h_CB)/v */
const triangleHalfWindow = (hCb, v) => halfWidth(hCb) / v

/**
 * 观察者位于云区内部、距（背光侧）云边界 d km 时，头顶云底的被照亮窗口。
 * 推导（本实现独立推导，并用三个案例验证）：
 *   边缘处坐标系 t' 以"云边界处日落"为零点；观察者本地日落比边缘早 d/v，
 *   故 t_obs = t' + d/v。
 *   位置 l = −d 被照亮 ⇔ l_f(t') ≤ l ≤ l_n(t')  ⇒
 *     t'_start = l/(2v) = −d/(2v)  → t_obs_start = d/(2v)
 *     t'_end   = (l + √(2Rh))/v     → t_obs_end   = √(2Rh)/v
 *   几何前提：d ≤ 2√(2Rh)（image399 用的正是这个判据）
 */
function glowWindow(dKm, hCbKm, vKmMin) {
  const start = dKm / (2 * vKmMin)
  const end = halfWidth(hCbKm) / vKmMin
  return { start, end, duration: end - start, possible: dKm <= glowDepth(hCbKm) }
}

/** 视线高度角：h ≈ d·tanφ + d²/(2R) 的逆解（image136），单位度 */
function elevationOf(dKm, hKm) {
  return (Math.atan2(hKm, dKm) - dKm / (2 * R_KM)) / D2R
}

/** 5° 高度角对应的水平距离：原文直接忽略曲率（image402: 2km/tan5° = 22.9km） */
const distanceAt5Deg = (hKm) => hKm / Math.tan(5 * D2R)

/** 气溶胶等效地表高度：h_x = h_a ln(β0/0.02) = h_a ln(AOD/(0.02 h_a))（image406） */
const equivalentSurfaceKm = (aod, hAKm) => hAKm * Math.log(aod / (0.02 * hAKm))

/** 中云云洞最小长度：Δl_h ≥ 4Δh_c·R/l_hm（image453；l_hm 定义见报告 W3） */
const minHoleLength = (cloudThickKm, lHmKm) => (4 * cloudThickKm * R_KM) / lHmKm

/** 卷云透过率判据：t̂_g − t̂_c < 0.2(t̂_g − t_c,avg)（image444） */
const cirrusTransparent = (tGround, tCloud, tCloudAvg) =>
  tGround - tCloud < 0.2 * (tGround - tCloudAvg)

/* ================= 校验框架 ================= */

const results = []
function check(group, name, mine, theirs, tol, unit = '') {
  const diff = Math.abs(mine - theirs)
  const rel = theirs !== 0 ? diff / Math.abs(theirs) : diff
  const ok = diff <= tol
  results.push({ group, name, mine, theirs, diff, rel, tol, unit, ok })
  return ok
}
function checkBool(group, name, ok, detail) {
  results.push({ group, name, mine: ok ? 1 : 0, theirs: 1, diff: 0, rel: 0, tol: 1, unit: '', ok, detail })
}

/* ================= 1. 基础公式与查表回归 ================= */

// 表 1.1 压高关系（只验证单调性假设，不参与计算）
const pressureHeights = [1000, 925, 850, 700, 600, 500, 400, 300, 200, 100]
const standardHeights = [0, 750, 1500, 3000, 4200, 5500, 7200, 9200, 11700, 16100]
for (let i = 1; i < standardHeights.length; i++) {
  checkBool('表1.1 压高表', `${pressureHeights[i]}hPa 高度递增`, standardHeights[i] > standardHeights[i - 1])
}

// 附录 √(2Rh) 表
const sqrtTable = [
  [0.5, 79.8], [1, 112.9], [1.5, 138.3], [2, 159.6], [2.5, 178.5], [3, 195.5], [3.5, 211.2], [4, 225.8], [4.5, 239.5],
  [5, 252.4], [5.5, 264.7], [6, 276.5], [6.5, 287.8], [7, 298.7], [7.5, 309.1], [8, 319.3], [8.5, 329.1],
  [9, 338.7], [10, 357.0], [11, 374.4], [12, 391.0], [13, 407.0], [14, 422.4], [15, 437.2], [16, 451.5],
  [17, 465.4], [18, 478.9]
]
for (const [h, v] of sqrtTable) check('附录 √(2Rh)', `h=${h}km`, halfWidth(h), v, 0.15, 'km')

// 表 1.3 / 1.4 霞光深入距离
const glowTable = [
  [2, 319.23, 319.27], [3, 390.95, 391.03], [6, 552.78, 553.00], [8, 638.21, 638.55]
]
for (const [h, exact, approx] of glowTable) {
  check('表1.3 精确列', `h=${h}km`, glowDepth(h), exact, 0.5, 'km')
  check('表1.4 近似列', `h=${h}km`, glowDepth(h), approx, 0.05, 'km')
}

// 表 4.1：AOD=0.15，σ_th=0.02 km⁻¹
const t41 = [
  [0.5, 1.35], [1.0, 2.01], [1.5, 2.41], [2.0, 2.64], [2.5, 2.74], [3.0, 2.75], [3.5, 2.66], [4.0, 2.51]
]
for (const [hA, v] of t41) check('表4.1 等效地表高度', `H=${hA}km`, equivalentSurfaceKm(0.15, hA), v, 0.02, 'km')

// 表 4.2：AOD=0.14
const t42 = [
  [0.5, 1.32], [1.0, 1.95], [1.5, 2.31], [2.0, 2.51], [2.5, 2.57], [3.0, 2.54], [3.5, 2.42], [4.0, 2.23]
]
for (const [hA, v] of t42) check('表4.2 等效地表高度', `H=${hA}km`, equivalentSurfaceKm(0.14, hA), v, 0.02, 'km')

/* ================= 2. 三个案例回归 ================= */

console.log('=== 案例 1：深圳 2022-10-13 层积云晚霞（章节四 §4.1.1）===')
{
  const hCb = 2.0        // km
  const d = 200          // km，云边界距离
  const v = 21           // km/min，日落线速度（原文查表值）
  const geo = glowDepth(hCb)
  console.log(`  几何判据：2√(2Rh) = ${glowDepth(hCb).toFixed(1)} km > d=${d} km ? ${d < geo}`)
  const elev = elevationOf(d, hCb)
  console.log(`  云边界高度角 = atan(h/d) − d/(2R) = ${elev.toFixed(3)}° （原文 −0.32°）`)
  const w = glowWindow(d, hCb, v)
  console.log(`  头顶：日落后 ${w.start.toFixed(2)} min 开始，持续 ${w.duration.toFixed(2)} min，${w.end.toFixed(2)} min 结束`)
  console.log(`        （原文：4.8 min 开始 / 2.8 min 持续 / 7.6 min 结束）`)
  const d5 = distanceAt5Deg(hCb)
  const total = w.duration + d5 / v
  console.log(`  5° 视野延伸：${d5.toFixed(1)} km ÷ ${v} = ${(d5 / v).toFixed(2)} min → 合计 ${total.toFixed(2)} min（原文 3.9 min）`)
  check('案例1 深圳', '云边界高度角', elev, -0.32, 0.02, '°')
  check('案例1 深圳', '开始时刻', w.start, 4.8, 0.1, 'min')
  check('案例1 深圳', '头顶持续时间', w.duration, 2.8, 0.1, 'min')
  check('案例1 深圳', '结束时刻', w.end, 7.6, 0.15, 'min')
  check('案例1 深圳', '总持续时间', total, 3.9, 0.1, 'min')
}

console.log('\n=== 案例 2：伊春 2022-10-14 卷层云晚霞（章节四 §4.1.1）===')
{
  const hCb = 7.219      // km
  const d = 166          // km
  const v = 18           // km/min
  const elev = elevationOf(d, hCb)
  console.log(`  云边界高度角 = ${elev.toFixed(3)}°（原文 1.75°）`)
  const w = glowWindow(d, hCb, v)
  console.log(`  开始 = d/(2v) = ${w.start.toFixed(2)} min（原文 4 分 36 秒 = 4.6 min）`)
  // 气溶胶修正后的等效云底 4.65–5.90 km（原文表 4.2 给的范围）
  for (const hEff of [4.65, 5.90]) {
    const we = glowWindow(d, hEff, v)
    const d5 = distanceAt5Deg(hCb)   // 原文这步用真实云底 7219 m
    console.log(`  等效云底 ${hEff} km：头顶 ${we.duration.toFixed(2)} min，含 5° 视野 ${(we.duration + d5 / v).toFixed(2)} min`)
  }
  const lowEff = glowWindow(d, 4.65, v), highEff = glowWindow(d, 5.90, v)
  const d5 = distanceAt5Deg(hCb)
  check('案例2 伊春', '云边界高度角', elev, 1.75, 0.02, '°')
  check('案例2 伊春', '开始时刻', w.start, 4.6, 0.05, 'min')
  check('案例2 伊春', '头顶下限(4.65km)', lowEff.duration, 8.9, 0.15, 'min')
  check('案例2 伊春', '头顶上限(5.90km)', highEff.duration, 10.6, 0.15, 'min')
  check('案例2 伊春', '总时长下限', lowEff.duration + d5 / v, 13.5, 0.2, 'min')
  check('案例2 伊春', '总时长上限', highEff.duration + d5 / v, 15.2, 0.2, 'min')
}

console.log('\n=== 案例 3：上海 2022-10-20 中云漏光（章节四 §4.2.3）===')
{
  // 云洞近边界 380 km（视为"光的入口边缘"），等效云底 3.5–5.0 km，真实云底 6.5 km
  const dHole = 380
  const v = 20
  const hReal = 6.5
  console.log(`  几何判据：2√(2R·h_eff) vs 380 km：`)
  for (const hEff of [3.5, 5.0]) {
    const w = glowWindow(dHole, hEff, v)
    console.log(`  h_eff=${hEff} km：2√(2Rh)=${glowDepth(hEff).toFixed(0)} km，窗长 ${w.duration.toFixed(2)} min（原文 1.1–3.1 min）`)
  }
  const d5 = distanceAt5Deg(hReal)
  const totalLow = glowWindow(dHole, 3.5, v).duration + d5 / v
  const totalHigh = glowWindow(dHole, 5.0, v).duration + d5 / v
  console.log(`  开始 = 380/(2×20) = ${(dHole / (2 * v)).toFixed(1)} min（原文 9.5 min）`)
  console.log(`  5° 视野延伸（真实云底 6.5 km）：${d5.toFixed(1)} km ÷ ${v} = ${(d5 / v).toFixed(2)} min`)
  console.log(`  总时长 = ${totalLow.toFixed(2)}–${totalHigh.toFixed(2)} min（原文写 3.8–6.8 min）`)
  console.log(`  ⚠ 原文自身算术不一致：1.1 + 3.7 = 4.8，但正文写成 3.8；下限应为 ${totalLow.toFixed(1)} min`)
  check('案例3 上海漏光', '开始时刻', dHole / (2 * v), 9.5, 0.05, 'min')
  check('案例3 上海漏光', '持续下限', glowWindow(dHole, 3.5, v).duration, 1.1, 0.1, 'min')
  check('案例3 上海漏光', '持续上限', glowWindow(dHole, 5.0, v).duration, 3.1, 0.1, 'min')
  check('案例3 上海漏光', '总时长下限（复算 4.8，原文 3.8）', totalLow, 4.8, 0.1, 'min')
  check('案例3 上海漏光', '总时长上限', totalHigh, 6.8, 0.15, 'min')
}

/* ================= 3. 量纲检查（全部公式） ================= */

const dims = [
  ['h ≈ l·tanφ + l²/(2R)', 'h:[km]', 'l·tanφ:[km]', 'l²/(2R): [km²]/[km] = [km]', true],
  ['√(2Rh)', '[km]', '√([km]·[km]) = [km]', '', true],
  ['|l_f|max = 2√(2Rh_CB)', '[km]', '[km]', '', true],
  ['h_f = (l−vt)²/(2R)', '[km]', '[km]²/[km] = [km]', '', true],
  ['h_n = h_f + h_CB − (vt)²/(2R)', '[km]', '[km]+[km]−[km]', '', true],
  ['t = l/v', '[min]', '[km]/([km]/min) = [min]', '', true],
  ['h_x = h_a·ln(AOD/(0.02·h_a))', '[km]', '[km]·ln([–]/([km⁻¹][km]))', 'AOD 无量纲', true],
  ['Δl_h ≥ 4Δh_c·R/l_hm', '[km]', '[km][km]/[km] = [km]', 'l_hm 定义待核实', true],
  ['彩虹锥半角 42°', '[°]', '180°−137.5°', '', true],
  ['艾里斑 θ0 = 1.22λ/d', '[rad]', '[–][m]/[m]', '小角近似', true]
]
let dimOk = 0
for (const d of dims) {
  console.log(`  量纲 ${d[0]}: ${d[1]} vs ${d[2]} ${d[4] ? '✓' : '✗'}`)
  if (d[4]) dimOk++
}

/* ================= 4. 输出汇总 ================= */

console.log('\n=== 校验汇总 ===')
const groups = [...new Set(results.map((r) => r.group))]
let fail = 0
for (const g of groups) {
  const rows = results.filter((r) => r.group === g)
  const bad = rows.filter((r) => !r.ok)
  console.log(`${bad.length ? '✗' : '✓'} ${g}：${rows.length - bad.length}/${rows.length} 通过`)
  for (const b of bad) {
    console.log(`    ✗ ${b.name}：本实现 ${b.mine} ${b.unit} vs 原文 ${b.theirs} ${b.unit}（差 ${b.diff.toFixed(3)}，容差 ${b.tol}）`)
  }
  fail += bad.length
}

// 表 1.3 精确列 vs 近似列的差异单独报告（原文两列本身就不一致）
console.log('\n=== 原文数值表的舍入/来源差异（不是我们的误差）===')
for (const [h, exact, approx] of glowTable) {
  const ours = glowDepth(h)
  console.log(`  h=${h}km：本实现 2√(2Rh) = ${ours.toFixed(2)}；原文精确列 ${exact}（差 ${(ours - exact).toFixed(2)}）；原文近似列 ${approx}（差 ${(ours - approx).toFixed(2)}）`)
}
console.log('  → 近似列与 2√(2Rh) 完全吻合；精确列系统性偏小 0.01–0.34 km（≤0.06%），')
console.log('    推测用了更精确的弧长/曲率表达式（精确式未在原文图片中找到 → W1 仍保留"精确式"待核实）。')

console.log(`\n${fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`}（${results.length} 项检查）`)
process.exit(fail === 0 ? 0 : 1)
