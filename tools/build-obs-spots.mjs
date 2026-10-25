import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/**
 * 把「观测互补机场」作为独立点位追加进 spots.json。
 *
 *   node tools/build-obs-spots.mjs            # 只看候选，不写文件
 *   node tools/build-obs-spots.mjs --write    # 写进 spots.json
 *
 * 为什么要这些点：
 *   METAR 实况只能证明「机场那个点当时有没有画布」。
 *   现在校验时拿 45 km 内的机位去代表机场，等于拿错的格点做检验；
 *   把机场本身变成机位之后，机场的预报分和机场的实况是同一个地点，
 *   校验才成立。
 *
 * 收点规则（宁可少收，不要把预报列表淹没）：
 *   1) 机场必须有机位库里的省份（否则没有省级缓存可算）
 *   2) 同省里离最近机位 ≤60 km —— 这样的机场才算「机位没覆盖的地方」
 *   3) 城市不要重复（成都双流 / 天府只留离机位更近的那个）
 *   4) 已经有 ≤3 km 的真实机位的城市，不再补观测点
 *
 * 产出字段：
 *   n     '<城市>机场观测点'
 *   area  '<省>·观测点'（只在观测点模式下展示）
 *   obs   机场 ICAO —— 检验脚本靠它认出「这个点的实况在哪」
 *   face  '—'（机场不是拍摄机位，不参与朝向判定）
 *
 * 幂等：已存在的观测点跳过。
 */

const ROOT = process.cwd()
const SPOTS = ROOT + '/src/data/forecast/spots.json'
const STATIONS = ROOT + '/data/obs/stations-cn.json'

const PROV_NAME = {
  hn: '海南', gd: '广东', gx: '广西', sh: '上海', js: '江苏', zj: '浙江',
  ah: '安徽', fj: '福建', jx: '江西', sd: '山东', bj: '北京', tj: '天津',
  he: '河北', sx: '山西', nm: '内蒙古', ha: '河南', hb: '湖北', hu: '湖南',
  cq: '重庆', sc: '四川', gz: '贵州', yn: '云南', xz: '西藏', sn: '陕西',
  gs: '甘肃', qh: '青海', nx: '宁夏', xj: '新疆', hk: '香港', mo: '澳门', tw: '台湾'
}

const MAX_KM = 60
const TOO_CLOSE_KM = 3

function km(aLat, aLon, bLat, bLon) {
  const R = 6371
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLon = (bLon - aLon) * Math.PI / 180
  const y = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(y))
}

const spots = JSON.parse(await readFile(SPOTS, 'utf8'))
/* 兼容两种形状：spots.json 目前是裸数组；以后若改成 {spots:[...]} 也能跑 */
const list = Array.isArray(spots) ? spots : spots.spots
const stations = JSON.parse(await readFile(STATIONS, 'utf8')).stations

const has = new Set(list.map((s) => s.n))
const realSpots = list.filter((s) => !s.n.includes('机场观测点'))

/** 同省最近真实机位的距离 */
function nearestKm(prov, lat, lon) {
  let best = Infinity
  for (const s of realSpots) {
    if (s.prov !== prov) continue
    const d = km(s.lat, s.lon, lat, lon)
    if (d < best) best = d
  }
  return best
}

/* 先按城市分组，同城多机场取离机位更近的那个 */
const byCity = new Map()
const dropped = []
for (const st of stations) {
  if (!st.city || !st.prov || !PROV_NAME[st.prov]) continue
  const d = nearestKm(st.prov, st.lat, st.lon)
  if (!isFinite(d)) continue
  if (d > MAX_KM) { dropped.push([st.id, st.city, '离最近机位 ' + Math.round(d) + 'km (>' + MAX_KM + ')']); continue }
  if (d <= TOO_CLOSE_KM) { dropped.push([st.id, st.city, '已有 ' + d.toFixed(1) + 'km 内的真实机位']); continue }
  const key = st.prov + '|' + st.city
  const cur = byCity.get(key)
  if (!cur || d < cur.d) byCity.set(key, { ...st, d })
  else dropped.push([st.id, st.city, '同城已有更近的 ' + cur.id])
}

const added = []
for (const st of byCity.values()) {
  const n = st.city + '机场观测点'
  if (has.has(n)) continue
  has.add(n)
  added.push({
    n,
    lat: Math.round(st.lat * 1000) / 1000,
    lon: Math.round(st.lon * 1000) / 1000,
    face: '—',
    area: PROV_NAME[st.prov] + '·观测点',
    prov: st.prov,
    obs: st.id
  })
}

added.sort((a, b) => a.prov.localeCompare(b.prov) || a.n.localeCompare(b.n, 'zh'))

console.log('新增观测点 ' + added.length + ' 个（同名已存在则跳过）')
for (const a of added) console.log('  + ' + a.n.padEnd(12, '　') + ' ' + a.prov + '  ' + a.obs)
if (dropped.length) {
  console.log('\n未收 ' + dropped.length + ' 个：')
  for (const d of dropped) console.log('  - ' + String(d[0]).padEnd(5) + ' ' + String(d[1]).padEnd(7, '　') + d[2])
}

if (process.argv.includes('--write')) {
  list.push(...added)
  await writeFile(SPOTS, JSON.stringify(Array.isArray(spots) ? list : spots, null, 1) + '\n', 'utf8')
  console.log('\n已写入 spots.json，机位总数 ' + list.length + '（其中观测点 ' + list.filter((s) => s.obs).length + '）')
} else {
  console.log('\n（未写入。加 --write 才会改 spots.json）')
}
