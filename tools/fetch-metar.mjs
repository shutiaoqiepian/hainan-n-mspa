/**
 * 抓取「离机位最近的机场」的 METAR 实况，按月追加到 data/obs/metar-YYYY-MM.csv。
 *
 * 为什么用它：这是唯一「不需要任何人配合」的真实观测源。
 * METAR 每小时一条，含云组（FEW/SCT/BKN/OVC + 云底高度）和能见度，
 * 可以直接判断那一刻「天上有没有画布」——检验误报率所需的正是这个。
 *
 * 站点选择：读 data/obs/stations-cn.json（机场坐标表），
 * 挑出离任一机位 ≤60 km 的机场；没建表就退回海口/三亚两个站。
 *
 * 体积控制：只保留日出与日落窗口（当地 04:00–09:00、15:00–21:00）的观测。
 * 全国 70 个站 × 每天约 11 条 ≈ 770 行 ≈ 80 KB/天 ≈ 30 MB/年。
 *
 * 用法：
 *   node tools/fetch-metar.mjs               # 最近 24 小时
 *   node tools/fetch-metar.mjs --days 72     # 补三天
 *   node tools/fetch-metar.mjs --all-hours   # 不按窗口过滤（排错用）
 *
 * 由 .github/workflows/metar-obs.yml 每天跑一次。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'data', 'obs')
const STATION_TABLE = path.join(OUT_DIR, 'stations-cn.json')
const SPOTS = path.join(ROOT, 'src', 'data', 'forecast', 'spots.json')

/** 兜底：没有站点表时至少还有这两个 */
const FALLBACK = [
  { id: 'ZJHK', name: '海口美兰' },
  { id: 'ZJSY', name: '三亚凤凰' }
]

const MAX_SPOT_KM = 60
const CHUNK = 18

/** 北京时间（UTC+8）的 YYYY-MM-DD HH:mm */
function bj(ms) {
  const d = new Date(ms + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function km(aLat, aLon, bLat, bLon) {
  const R = 6371
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLon = (bLon - aLon) * Math.PI / 180
  const y = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(y))
}

/** 从原始 METAR 报文里解析云组、能见度、天气现象 */
export function parseMetar(raw, reportTime) {
  const cloud = []
  const re = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/g
  let m
  while ((m = re.exec(raw)) !== null) {
    cloud.push({
      cover: m[1],
      baseFt: m[2] === '///' ? null : Number(m[2]) * 100,
      type: m[3] || ''
    })
  }

  const clear = /\bCAVOK\b/.test(raw) || /\b(NSC|SKC|CLR)\b/.test(raw)

  let vis = null
  if (/\bCAVOK\b/.test(raw)) vis = 10000
  else {
    const v = raw.match(/\s(\d{4})\s/)
    if (v) vis = Number(v[1]) === 9999 ? 10000 : Number(v[1])
  }

  const wx = (raw.match(/\s([-+]?)(TS|RA|SH|BR|FG|HZ|DZ|SN|GR)\w*\s/) || []).slice(1).join('')

  const ORDER = ['FEW', 'SCT', 'BKN', 'OVC']
  const maxCover = cloud.length
    ? Math.max(...cloud.map((c) => ORDER.indexOf(c.cover) + 1))
    : 0
  const bases = cloud.filter((c) => c.baseFt != null).map((c) => c.baseFt)

  const ms = reportTime ? Date.parse(reportTime) : NaN
  return {
    timeUtc: reportTime || '',
    timeBj: isNaN(ms) ? '' : bj(ms),
    clear: clear ? 1 : 0,
    cloud: cloud.map((c) => c.cover + (c.baseFt != null ? c.baseFt : '')).join(' ') || '',
    cloudMaxCover: maxCover,
    cloudMinBaseFt: bases.length ? Math.min(...bases) : '',
    visM: vis == null ? '' : vis,
    wx,
    raw
  }
}

/** 只在日出/日落窗口留观测，控制仓库体积 */
function inWindow(timeBj, allHours) {
  if (allHours) return true
  const h = Number(timeBj.slice(11, 13))
  if (!isFinite(h)) return false
  return (h >= 4 && h <= 9) || (h >= 15 && h <= 21)
}

/** 选出离任一机位足够近的机场 */
async function pickStations() {
  if (!existsSync(STATION_TABLE)) {
    console.log('没有站点表，退回海口/三亚两个站（跑 node tools/build-station-table.mjs 可以扩到全国）')
    return FALLBACK
  }
  const table = JSON.parse(await readFile(STATION_TABLE, 'utf8'))
  if (!existsSync(SPOTS)) {
    console.log('找不到 spots.json，退回海口/三亚两个站')
    return FALLBACK
  }
  const spots = JSON.parse(await readFile(SPOTS, 'utf8'))
  const list = Array.isArray(spots) ? spots : (spots.spots || [])

  const picked = []
  for (const st of table.stations || []) {
    let best = Infinity
    for (const s of list) {
      const d = km(st.lat, st.lon, s.lat, s.lon)
      if (d < best) best = d
      if (best <= MAX_SPOT_KM) break
    }
    if (best <= MAX_SPOT_KM) picked.push({ id: st.id, name: st.name })
  }

  /* 兜底站永远保留：海口/三亚是主场 */
  for (const f of FALLBACK) if (!picked.some((p) => p.id === f.id)) picked.push(f)
  return picked
}

const CSV_HEAD =
  'station,station_name,time_utc,time_bj,clear,cloud,cloud_max_cover,cloud_min_base_ft,vis_m,wx,raw\n'

function csvRow(st, o) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [
    st.id, st.name, o.timeUtc, o.timeBj, o.clear, o.cloud,
    o.cloudMaxCover, o.cloudMinBaseFt, o.visM, o.wx, o.raw
  ].map(esc).join(',') + '\n'
}

async function fetchChunk(ids, hours) {
  const url = 'https://aviationweather.gov/api/data/metar?ids=' + ids.join(',') +
    '&format=json&hours=' + Math.min(240, Math.max(1, hours))
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': '18n-mspa-obs/1.0' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const j = await res.json()
      return Array.isArray(j) ? j : []
    } catch (e) {
      if (attempt === 3) {
        console.error('  [skip] ' + ids.join(',') + ' → ' + e.message)
        return []
      }
      await new Promise((r) => setTimeout(r, 1200 * attempt))
    }
  }
  return []
}

async function main() {
  const daysArg = process.argv.indexOf('--days')
  const hours = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 24
  const allHours = process.argv.includes('--all-hours')

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  const stations = await pickStations()
  const byId = new Map(stations.map((s) => [s.id, s]))
  console.log('站点 ' + stations.length + ' 个（离机位 ≤' + MAX_SPOT_KM + ' km）')

  /* 按月分组写入 */
  const monthData = new Map()   // 'YYYY-MM' -> Map(key -> line)
  let apiRows = 0
  let kept = 0
  let dropped = 0

  for (let i = 0; i < stations.length; i += CHUNK) {
    const chunk = stations.slice(i, i + CHUNK).map((s) => s.id)
    const list = await fetchChunk(chunk, hours)
    apiRows += list.length

    for (const item of list) {
      const st = byId.get(item.icaoId)
      if (!st) continue
      const o = parseMetar(item.rawOb || '', item.reportTime)
      if (!o.timeUtc || !o.timeBj) continue
      if (!inWindow(o.timeBj, allHours)) { dropped++; continue }

      const month = o.timeBj.slice(0, 7)
      if (!monthData.has(month)) monthData.set(month, new Map())
      const key = st.id + '|' + o.timeUtc
      if (!monthData.get(month).has(key)) {
        monthData.get(month).set(key, csvRow(st, o))
        kept++
      }
    }
    await new Promise((r) => setTimeout(r, 400))   // 别把接口打急
  }

  let added = 0
  for (const [month, rows] of monthData) {
    const file = path.join(OUT_DIR, 'metar-' + month + '.csv')
    const existed = existsSync(file)
    let body = existed ? await readFile(file, 'utf8') : CSV_HEAD

    const seen = new Set()
    if (existed) {
      for (const line of body.split('\n').slice(1)) {
        const parts = line.split(',')
        if (parts.length > 2 && parts[0]) seen.add(parts[0] + '|' + parts[2])
      }
    }

    let chunk = ''
    let n = 0
    for (const [key, line] of rows) {
      if (seen.has(key)) continue
      chunk += line
      seen.add(key)
      n++
    }
    if (chunk) {
      if (!existed) body = CSV_HEAD
      await writeFile(file, body + chunk, 'utf8')
      console.log('写入 ' + path.relative(ROOT, file) + ' +' + n + ' 行')
      added += n
    }
  }

  console.log('接口返回 ' + apiRows + ' 条 → 窗口内保留 ' + kept + ' 条（窗口外丢弃 ' + dropped + ' 条）→ 新增 ' + added + ' 行')
  if (added === 0) console.log('（没有新观测，正常：METAR 每小时才有一条）')
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
