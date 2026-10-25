/**
 * 生成机场站点表：data/obs/stations-cn.json
 *
 * 数据源：OurAirports 公开机场库（公共领域，无需注册）
 *   https://davidmegginson.github.io/ourairports-data/airports.csv
 *
 * 为什么不用 aviationweather 的 bbox 接口：它单次返回条数有限，
 * 分块扫全国会漏站（实测只扫到 58 个，且第一块还 502）。
 * 机场坐标变化极慢，一次性从公开库导出更稳。
 *
 * 用法：node tools/build-station-table.mjs
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'data', 'obs', 'stations-cn.json')
const SRC = 'https://davidmegginson.github.io/ourairports-data/airports.csv'

/** 极简 CSV 解析（字段里有引号与逗号） */
function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

/** 只要「例行民航航班」的机场：这些才会稳定发 METAR */
const WANT_TYPES = new Set(['large_airport', 'medium_airport'])

async function main() {
  console.log('下载 OurAirports 机场库…')
  const r = await fetch(SRC, { headers: { 'user-agent': '18n-mspa/1.0' } })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const text = await r.text()
  console.log('  下载完成 ' + Math.round(text.length / 1024) + ' KB')

  const rows = parseCsv(text)
  const head = rows[0]
  const idx = (name) => head.indexOf(name)
  const iIdent = idx('ident')
  const iType = idx('type')
  const iName = idx('name')
  const iLat = idx('latitude_deg')
  const iLon = idx('longitude_deg')
  const iElev = idx('elevation_ft')
  const iCountry = idx('iso_country')
  const iSched = idx('scheduled_service')
  const iGps = idx('gps_code')
  const iIcao = idx('icao_code')

  const list = []
  for (const row of rows.slice(1)) {
    if (row.length < head.length) continue
    if (row[iCountry] !== 'CN') continue
    if (!WANT_TYPES.has(row[iType])) continue
    if (row[iSched] !== 'yes') continue
    const ic = (row[iGps] || row[iIcao] || row[iIdent] || '').trim()
    if (!/^[A-Z]{4}$/.test(ic)) continue
    const lat = Number(row[iLat])
    const lon = Number(row[iLon])
    if (!isFinite(lat) || !isFinite(lon)) continue
    list.push({
      id: ic,
      name: row[iName],
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      elevFt: Number(row[iElev]) || null
    })
  }

  /* 去重（同一机场可能有多条记录） */
  const byId = new Map()
  for (const s of list) if (!byId.has(s.id)) byId.set(s.id, s)
  const final = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))

  if (!existsSync(path.dirname(OUT))) await mkdir(path.dirname(OUT), { recursive: true })
  /* ★ 保留上一版里人工补过的 city / prov。
     没有这一步，重跑这个脚本会把 enrich-stations.mjs 的成果全部抹掉，
     机场观测点就再也生成不出来 —— 而且不会报错，只会悄悄少 55 个点。 */
  if (existsSync(OUT)) {
    try {
      const old = JSON.parse(await readFile(OUT, 'utf8'))
      const byId = new Map((old.stations || []).map((s) => [s.id, s]))
      let kept = 0
      for (const s of final) {
        const o = byId.get(s.id)
        if (!o) continue
        if (o.city) { s.city = o.city; kept++ }
        if (o.prov) s.prov = o.prov
      }
      if (kept) console.log('保留人工补的城市名 ' + kept + ' 个（重跑完记得 node tools/build-obs-spots.mjs）')
    } catch { console.log('旧站点表读不出来，忽略（城市名需要重新跑 enrich-stations.mjs）') }
  }

  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: SRC, count: final.length, stations: final }), 'utf8')

  console.log('写入 ' + path.relative(process.cwd(), OUT) + '：' + final.length + ' 个站')

  const hn = final.filter((s) => s.lat > 17.5 && s.lat < 20.5 && s.lon > 108 && s.lon < 111.5)
  console.log('海南范围内：' + (hn.length ? hn.map((s) => s.id + '(' + s.name + ')').join(' ') : '（无）'))
  const gd = final.filter((s) => s.lat > 20 && s.lat < 25.5 && s.lon > 109.5 && s.lon < 117.5)
  console.log('广东范围：' + gd.length + ' 个站（' + gd.slice(0, 8).map((s) => s.id).join(' ') + '…）')
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1) })
