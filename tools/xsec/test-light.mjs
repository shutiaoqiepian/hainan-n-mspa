#!/usr/bin/env node
/**
 * light.ts（太阳光路 / 照明几何引擎）的数值回归测试。
 *
 * 覆盖：
 *   1. 球面几何：dip、当地太阳高度角、阴影边界高度、受光判据的互相自洽；
 *   2. 与原文公式的一致性：el=0、Δ=0 时 h_b = l²/(2R)（docs/阶段六-03 image76/image86）；
 *   3. 日落线位置与移动速度（数值差分，不依赖原文附录表口径）；
 *   4. Beer-Lambert：大气质量、透过率；
 *   5. 地形：视线高度角、光路遮挡；
 *   6. 逐云带受光窗口：用真实太阳位置扫描，验证"高处/向阳侧受光更久"。
 *
 * 用法：node tools/xsec/test-light.mjs
 */

import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-light-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
export {
  R_KM, dipDeg, localSunElDeg, boundaryHeightKm, litAt, terminatorKm,
  terminatorSpeedKmMin, airmass, transmittance, terrainHorizonDeg,
  terrainBlocksRay, bandLightWindow, describeMin
} from '@/lib/xsec/light'
export { sunsetMs } from '@/lib/xsec/sun'
`, 'utf8')
  const outfile = path.join(tmp, 'm.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

const L = await load()
let pass = 0
let fail = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (detail != null ? '  → ' + detail : '')) }
}
const near = (label, got, want, tol, unit = '') =>
  check(`${label}：${got?.toFixed?.(4) ?? got}${unit} vs ${want}${unit}（容差 ${tol}）`,
    typeof got === 'number' && Math.abs(got - want) <= tol)

const SUNSET_ISO = '2026-11-01T10:30:00Z'   // 海南约 18:20 北京时间的日落前后
const LAT = 20.0271
const LON = 110.2786

/* ================= 1. 球面几何 ================= */
console.log('\n=== 1. 球面几何 ===')
near('dip(0 m)', L.dipDeg(0), 0, 1e-9, '°')
near('dip(2000 m)', L.dipDeg(2000), 1.4263, 0.01, '°')
near('dip(10000 m)', L.dipDeg(10000), Math.acos(L.R_KM / (L.R_KM + 10)) * 180 / Math.PI, 1e-9, '°')
check('dip 随高度单调递增', L.dipDeg(500) < L.dipDeg(2000) && L.dipDeg(2000) < L.dipDeg(8000))

near('localSunElDeg(0°, 200 km)', L.localSunElDeg(0, 200), (200 / L.R_KM) * 180 / Math.PI, 1e-9, '°')

/* el=0、Δ=0 时，背阳侧（l<0）的阴影边界必须等于原文的 h = l²/(2R) */
for (const l of [10, 50, 100, 200, 300]) {
  const want = (l * l) / (2 * L.R_KM)
  near(`el=0 时背阳侧 h_b(-${l} km) = l²/(2R)`, L.boundaryHeightKm(-l, 0, 0), want, 2e-4, ' km')
}
near('el=0 时向阳侧没有阴影边界（l>0）', L.boundaryHeightKm(100, 0, 0), 0, 1e-12, ' km')
near('el=+5° 时 100 km 内没有阴影', L.boundaryHeightKm(100, 5, 0), 0, 1e-12, ' km')
near('el=-2° 时 0 km 处阴影上缘', L.boundaryHeightKm(0, -2, 0), 3.88, 0.03, ' km')

/* ================= 2. 受光判据自洽 ================= */
console.log('\n=== 2. 受光判据自洽（边界曲线与 litAt 必须互相印证）===')
for (const [el, l] of [[-1, 50], [-0.5, 120], [0, -200], [-2, 0], [3, 80]]) {
  const hb = L.boundaryHeightKm(l, el, 0)
  if (hb > 0.02) {
    check(`el=${el}°, l=${l} km：略低于边界 h_b=${hb.toFixed(3)} km 应在阴影中`,
      L.litAt(hb * 1000 - 20, l, el) === false)
    check(`el=${el}°, l=${l} km：略高于边界应在直射光中`,
      L.litAt(hb * 1000 + 20, l, el) === true)
  } else {
    check(`el=${el}°, l=${l} km：无阴影，地面亦在直射光中`, L.litAt(10, l, el) === true)
  }
}
/* 日落时刻：云在向阳侧 200 km、2 km 高处仍受光；背阳侧 200 km 不再受光 */
check('el=0 时，向阳侧 200 km / 2 km 高处受光', L.litAt(2000, 200, 0) === true)
check('el=0 时，背阳侧 200 km / 2 km 高处已在阴影', L.litAt(2000, -200, 0) === false)
check('el=0 时，背阳侧 100 km / 2 km 高处仍受光（< √(2Rh)=159.6 km）', L.litAt(2000, -100, 0) === true)
check('天空较高处比云底更晚失光', L.litAt(6000, -200, 0) === true)

/* ================= 3. 日落线位置与速度 ================= */
console.log('\n=== 3. 地面日落线 ===')
near('el=0 时日落线在 0 km', L.terminatorKm(0, 0), 0, 1e-9, ' km')
near('el=-1° 时日落线在前方 111.2 km', L.terminatorKm(-1, 0), Math.PI / 180 * L.R_KM, 0.01, ' km')
near('太阳偏离 60° 时投影距离加倍', L.terminatorKm(-1, 60), (Math.PI / 180 * L.R_KM) / Math.cos(Math.PI / 3), 0.02, ' km')
check('太阳方向与剖面垂直时无法判定', L.terminatorKm(-1, 89) === null)

const tRef = new Date(SUNSET_ISO).getTime()
const spd = L.terminatorSpeedKmMin(tRef, LAT, LON, 0)
near('日落前后的边界速度（km/min，数值差分）', Math.abs(spd), 24.5, 6, ' km/min')
check('边界速度为正（太阳落下时日落线远离机位）', spd > 0, spd)

/* ================= 4. Beer-Lambert ================= */
console.log('\n=== 4. 气溶胶直射削弱 ===')
near('airmass(90°)', L.airmass(90), 1, 0.002, '')
near('airmass(30°)', L.airmass(30), 2, 0.01, '')
near('airmass(10°)', L.airmass(10), 5.6, 0.05, '')
near('airmass(0°)（地平线，≈37.9，封顶 38）', L.airmass(0), 37.92, 0.05, '')
near('airmass(-3°) 与 0° 同为封顶值（不随负角度继续增大）', L.airmass(-3), L.airmass(0), 1e-9, '')
near('透过率 AOD=0.2、el=90°', L.transmittance(0.2, 90), Math.exp(-0.2), 1e-3, '')
near('透过率 AOD=0.2、el=30°', L.transmittance(0.2, 30), Math.exp(-0.4), 0.002, '')
check('AOD 缺测时透过率为 null（不默认 0.2）', L.transmittance(null, 10) === null)
check('低太阳比高太阳更暗', L.transmittance(0.3, 3) < L.transmittance(0.3, 60))

/* ================= 5. 地形 ================= */
console.log('\n=== 5. 地形视线与光路遮挡 ===')
const flat = new Array(41).fill(0)
near('平坦地形视线高度角（最近点在 1.25 km，曲率 −0.006°）', L.terrainHorizonDeg(flat, 1.25), -1.25 / (2 * 6371) * 180 / Math.PI, 0.003, '°')
const ridge = flat.slice()
ridge[8] = 600    // 10 km 处 600 m 山脊
near('10 km 处 600 m 山脊的视线仰角', L.terrainHorizonDeg(ridge, 1.25), 3.4, 0.15, '°')
const missing = flat.slice()
missing[8] = null
check('缺测点不参与视线计算也不当 0 处理', L.terrainHorizonDeg(missing, 1.25) !== null)

const wall = flat.slice()
wall[8] = 3000
check('2 km 高的云、太阳 0°：10 km 外 3 km 山脊挡住光路', L.terrainBlocksRay(2000, 0, wall, 1.25, 0) === true)
check('太阳 6° 时同一山脊不再遮挡', L.terrainBlocksRay(2000, 0, wall, 1.25, 6) === false)
check('平坦地形不遮挡', L.terrainBlocksRay(2000, 0, flat, 1.25, 0) === false)
check('地形全缺测时返回 null（不猜）', L.terrainBlocksRay(2000, 0, new Array(41).fill(null), 1.25, 0) === null)

/* ================= 6. 逐云带受光窗口（真实太阳位置） ================= */
console.log('\n=== 6. 逐云带受光窗口（真实太阳位置 + 真实日落时刻）===')
const setMs = L.sunsetMs(LAT, LON, SUNSET_ISO)
check('能求到当地日落时刻', Number.isFinite(setMs), setMs)
const base = L.bandLightWindow({ hM: 2000, dSunKm: 0, lat: LAT, lon: LON, sunsetMs: setMs, refMs: setMs - 3600e3 })
check('云底 2 km 头顶：日落前后由受光转为阴影（约 2–7 min，随纬度/季节）', base.lit === true && base.endMin !== null && base.endMin > 1.5 && base.endMin < 7, JSON.stringify(base))
const toward = L.bandLightWindow({ hM: 2000, dSunKm: 100, lat: LAT, lon: LON, sunsetMs: setMs, refMs: setMs - 3600e3 })
const away = L.bandLightWindow({ hM: 2000, dSunKm: -100, lat: LAT, lon: LON, sunsetMs: setMs, refMs: setMs - 3600e3 })
check('向阳侧云带比背阳侧更晚失光', (toward.endMin ?? 0) > (base.endMin ?? 0) && (base.endMin ?? 0) > (away.endMin ?? 0),
  `向阳 ${toward.endMin} / 头顶 ${base.endMin} / 背阳 ${away.endMin}`)
const high = L.bandLightWindow({ hM: 8000, dSunKm: 0, lat: LAT, lon: LON, sunsetMs: setMs, refMs: setMs - 3600e3 })
check('8 km 高的云比 2 km 的云更晚失光', (high.endMin ?? 0) > (base.endMin ?? 0), `8 km ${high.endMin} vs 2 km ${base.endMin}`)
check('分钟描述可读', L.describeMin(7.5).includes('日落后') && L.describeMin(-2).includes('日落前'))

/* ================= 汇总 ================= */
console.log(`\n=== 汇总：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail === 0 ? 0 : 1)
