#!/usr/bin/env node
/**
 * 阶段七 全国 224 机位可支撑性审计（只读，不改任何数据）。
 *
 * 检查：坐标有效性 / 海拔是否缺失 / 省份分布 / 经纬度范围 / 与 GFS 0.25° 网格的距离 /
 *      50 km 剖面在各方位所需的 GFS 取数窗口 / 剖面数据体量估算。
 *
 * 用法：node tools/xsec/audit_spots_224.mjs
 */
import { readFile } from 'node:fs/promises'

const ROOT = 'C:/dsh椰青/18n-mspa'
const spots = JSON.parse(await readFile(`${ROOT}/src/data/forecast/spots.json`, 'utf8'))

const AXES = [240, 255, 265, 280, 295]     // 当前试点方位（日落向）
const LENGTH_KM = 50
const SAMPLES = 5
const LEVELS = 9
const FIELDS = 10

const R = 6371.0088
const dest = (lat, lon, az, km) => {
  const d = km / R, a = (az * Math.PI) / 180
  const la1 = (lat * Math.PI) / 180, lo1 = (lon * Math.PI) / 180
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(a))
  const lo2 = lo1 + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return [(la2 * 180) / Math.PI, ((((lo2 * 180) / Math.PI + 540) % 360) - 180)]
}

console.log(`=== 机位总数：${spots.length} ===`)
const byProv = {}
for (const s of spots) byProv[s.prov] = (byProv[s.prov] || 0) + 1
console.log('省份分布：', Object.entries(byProv).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '))

/* 1) 字段与坐标有效性 */
const keys = new Set()
for (const s of spots) for (const k of Object.keys(s)) keys.add(k)
console.log('机位字段：', [...keys].join(', '))
let bad = []
for (const s of spots) {
  if (typeof s.lat !== 'number' || typeof s.lon !== 'number' || !isFinite(s.lat) || !isFinite(s.lon)) bad.push([s.n, '坐标非数字'])
  else if (s.lat < -90 || s.lat > 90 || s.lon < -180 || s.lon > 180) bad.push([s.n, '坐标越界'])
  if (typeof s.n !== 'string' || !s.n.trim()) bad.push(['(空名)', '缺机位名'])
}
console.log(`坐标/名称异常：${bad.length} 处`, bad.slice(0, 5))
console.log(`海拔字段：${keys.has('elev') || keys.has('elevation') || keys.has('alt') ? '有' : '缺失（全部 224 个）'}`)

const lats = spots.map((s) => s.lat), lons = spots.map((s) => s.lon)
console.log(`纬度范围：${Math.min(...lats).toFixed(2)} ~ ${Math.max(...lats).toFixed(2)}；经度范围：${Math.min(...lons).toFixed(2)} ~ ${Math.max(...lons).toFixed(2)}`)

/* 2) 与 GFS 0.25° 网格的最大距离 */
const gridDist = (lat, lon) => {
  const dla = (lat - Math.round(lat * 4) / 4) * 111.32
  const dlo = (lon - Math.round(lon * 4) / 4) * 111.32 * Math.cos((lat * Math.PI) / 180)
  return Math.hypot(dla, dlo)
}
const dists = spots.map((s) => gridDist(s.lat, s.lon))
dists.sort((a, b) => b - a)
console.log(`机位到最近 GFS 0.25° 格点距离：中位 ${dists[Math.floor(dists.length / 2)].toFixed(1)} km，最大 ${dists[0].toFixed(1)} km`)

/* 3) 50 km 剖面所需取数窗口（每个机位、5 方位合起来） */
const windows = spots.map((s) => {
  let latMin = s.lat, latMax = s.lat, lonMin = s.lon, lonMax = s.lon
  for (const az of AXES) {
    const [la, lo] = dest(s.lat, s.lon, az, LENGTH_KM)
    latMin = Math.min(latMin, la); latMax = Math.max(latMax, la)
    lonMin = Math.min(lonMin, lo); lonMax = Math.max(lonMax, lo)
  }
  return { n: s.n, dLat: latMax - latMin, dLon: lonMax - lonMin }
})
const maxWin = windows.reduce((a, b) => (b.dLat > a.dLat || b.dLon > a.dLon ? b : a))
console.log(`单机位 5 方位 50 km 所需窗口：最大 Δlat ${maxWin.dLat.toFixed(2)}° / Δlon ${maxWin.dLon.toFixed(2)}°（${maxWin.n}）`)

/* 4) 数据体量估算：224 机位 × 4 时次 × 5 方位 */
const perSection = SAMPLES * LEVELS * FIELDS
const nums = spots.length * 4 * AXES.length * perSection
console.log(`\n=== 体量估算（沿用当前格式）===`)
console.log(`每 section ${perSection} 个数值；每机位 4 时次 × 5 方位 = 20 sections = ${20 * perSection} 个数值`)
console.log(`224 机位合计 ${nums.toLocaleString()} 个数值`)
console.log(`按当前实测 43 KB/机位（8 机位 341 KB）线性外推 ≈ ${((341 / 8) * spots.length / 1024).toFixed(1)} MB`)
console.log(`基准：当前 8 机位 341 KB；若 4 次/天覆盖写，git 每日增长需实测（参考预报缓存 8 次/天 73–85 KB）`)

/* 5) 地形/气候分区抽样（用于选 12–16 个分区验证机位） */
const sel = ['hk-xihai', 'sy-tianya', 'wzs-main']   // 已有试点
console.log(`\n=== 分区验证候选（按 province 覆盖 + 地形类型）===`)
const provSeen = new Set()
const picks = []
for (const s of spots) {
  const prov = s.prov
  if (provSeen.has(prov)) continue
  // 每个省取第一个「非机场观测点」机位
  if (s.obs) continue
  provSeen.add(prov)
  picks.push({ n: s.n, prov, lat: s.lat, lon: s.lon, face: s.face, area: s.area })
}
console.log(`覆盖全部 ${provSeen.size} 个省份只需 ${picks.length} 个代表机位（每省 1 个）`)
console.log('前 16 个：', picks.slice(0, 16).map((p) => `${p.prov}/${p.n}`).join('，'))
