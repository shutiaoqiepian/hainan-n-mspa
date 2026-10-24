/**
 * 抓取海口美兰（ZJHK）、三亚凤凰（ZJSY）的 METAR 实况，按月追加到
 * data/obs/metar-YYYY-MM.csv。
 *
 * 为什么用它：这是唯一「不需要任何人配合」的真实观测源。
 * METAR 每小时一条，含云组（FEW/SCT/BKN/OVC + 云底高度）和能见度，
 * 可以直接判断那一刻「天上有没有画布」——而这正是检验误报率所需的数据。
 *
 * 用法：
 *   node tools/fetch-metar.mjs          # 抓最近 24 小时
 *   node tools/fetch-metar.mjs --days 72
 *
 * 由 .github/workflows/metar-obs.yml 每天跑一次。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const SITES = [
  { id: 'ZJHK', name: '海口美兰', key: 'haikou' },
  { id: 'ZJSY', name: '三亚凤凰', key: 'sanya' }
]

const OUT_DIR = path.join(process.cwd(), 'data', 'obs')

/** 北京时间（UTC+8）的 YYYY-MM-DD HH:mm */
function bj(ms) {
  const d = new Date(ms + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 16).replace('T', ' ')
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

  /* CAVOK / NSC / SKC / CLR 都表示「无云（或有云但无重要天气）」 */
  const clear = /\bCAVOK\b/.test(raw) || /\b(NSC|SKC|CLR)\b/.test(raw)

  /* 能见度：CAVOK = ≥10 km；4 位数字 = 米；9999 = ≥10 km */
  let vis = null
  if (/\bCAVOK\b/.test(raw)) vis = 10000
  else {
    const v = raw.match(/\s(\d{4})\s/)
    if (v) vis = Number(v[1]) === 9999 ? 10000 : Number(v[1])
  }

  /* 天气现象：RA 雨 / TS 雷暴 / BR 轻雾 / FG 雾 / HZ 霾 */
  const wx = (raw.match(/\s([-+]?)(TS|RA|SH|BR|FG|HZ|DZ|SN|GR)\w*\s/) || [])
    .slice(1)
    .join('')

  const ms = reportTime ? Date.parse(reportTime) : NaN
  return {
    timeUtc: reportTime || '',
    timeBj: isNaN(ms) ? '' : bj(ms),
    clear: clear ? 1 : 0,
    cloud: cloud.map((c) => c.cover + (c.baseFt != null ? c.baseFt : '')).join(' ') || '',
    cloudMaxCover: cloud.length
      ? ['FEW', 'SCT', 'BKN', 'OVC'].indexOf(cloud.map((c) => c.cover).sort((a, b) =>
          ['FEW', 'SCT', 'BKN', 'OVC'].indexOf(b) - ['FEW', 'SCT', 'BKN', 'OVC'].indexOf(a))[0]) + 1
      : 0,
    cloudMinBaseFt: cloud.filter((c) => c.baseFt != null).length
      ? Math.min(...cloud.filter((c) => c.baseFt != null).map((c) => c.baseFt))
      : '',
    visM: vis == null ? '' : vis,
    wx,
    raw
  }
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

async function main() {
  const daysArg = process.argv.indexOf('--days')
  const hours = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 24

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  let added = 0
  let skipped = 0

  for (const st of SITES) {
    const url =
      'https://aviationweather.gov/api/data/metar?ids=' + st.id +
      '&format=json&hours=' + Math.min(240, Math.max(1, hours))

    let json
    try {
      const res = await fetch(url, { headers: { 'user-agent': '18n-mspa-obs/1.0' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      json = await res.json()
    } catch (e) {
      console.error('[skip] ' + st.id + ' 取数失败：' + e.message)
      continue
    }
    if (!Array.isArray(json) || !json.length) {
      console.log('[skip] ' + st.id + ' 没有返回数据')
      continue
    }

    /* 按月份分文件，避免单个 CSV 无限增长 */
    const byMonth = new Map()
    for (const item of json) {
      const o = parseMetar(item.rawOb || '', item.reportTime)
      if (!o.timeUtc) continue
      const key = o.timeBj.slice(0, 7) // YYYY-MM
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key).push(o)
    }

    for (const [month, list] of byMonth) {
      const file = path.join(OUT_DIR, 'metar-' + month + '.csv')
      const existed = existsSync(file)
      let body = existed ? await readFile(file, 'utf8') : CSV_HEAD

      /* 去重键必须是「站号 + 时刻」：两个机场都在整点发报，
         只按时刻去重会把第二个站的整批数据当重复丢掉。 */
      const seen = new Set()
      if (existed) {
        for (const line of body.split('\n').slice(1)) {
          const parts = line.split(',')
          if (parts.length > 2 && parts[0]) seen.add(parts[0] + '|' + parts[2])
        }
      }

      let chunk = ''
      let n = 0
      for (const o of list) {
        const key = st.id + '|' + o.timeUtc
        if (seen.has(key)) { skipped++; continue }
        chunk += csvRow(st, o)
        seen.add(key)
        added++
        n++
      }
      if (chunk) {
        if (!existed) body = CSV_HEAD
        await writeFile(file, body + chunk, 'utf8')
        console.log('写入 ' + path.relative(process.cwd(), file) + ' +' + n + ' 行')
      }
    }
  }

  console.log('完成：新增 ' + added + ' 条，跳过重复 ' + skipped + ' 条')
  if (added === 0) console.log('（没有新观测，属正常：METAR 每小时才有一条）')
}

main().catch((e) => {
  console.error('失败：', e)
  process.exit(1)
})
