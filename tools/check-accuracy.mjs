/**
 * 用每天存的 METAR 实况 + 预报快照，算「端到端误报 / 漏报」。
 *
 * 不需要任何人填表：METAR 是机场自动观测，每 30 分钟一条。
 *
 * ★ 两种配对（2026-10-25 起）：
 *   A 级：机位库里就有「XX机场观测点」（spots.json 里带 obs 字段的点）。
 *         这种点的预报分和实况是同一个坐标，误差里只剩「模式 vs 真值」，
 *         是唯一能拿来改算法的样本。设 A 级样本为 0 时说明观测点还没算进缓存。
 *   B 级：没有观测点时，用 45 km 内分数最高的机位代表机场（旧逻辑）。
 *         机场在郊区、云是局地的，这类样本只作参考，不计入主口径。
 *
 * 判定口径（故意保守，宁可少判也不冤枉算法）：
 *   实况无云（CAVOK / NSC / SKC）        → 天上没有「画布」，不可能有火烧云
 *      若算法给 ≥ 48 分（小烧及以上）    → 记一次【误报】
 *   实况有 BKN/OVC 且云底低于 2000 ft    → 低云封挡，也几乎不可能有霞
 *      若算法给 ≥ 48 分                  → 记一次【误报】
 *   实况有 SCT/BKN 中高云（≥ 2000 ft）   → 有可能出霞，但不能证明一定烧
 *      若算法给 < 30 分（微烧以下）      → 记一次【待复核】
 *   其余                                  → 不判定
 *
 * 用法：
 *   node tools/check-accuracy.mjs
 *   node tools/check-accuracy.mjs --from 2026-10-01 --to 2026-10-31
 *   node tools/check-accuracy.mjs --top 30
 *   node tools/check-accuracy.mjs --only-a     # 只看 A 级样本
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OBS_DIR = path.join(ROOT, 'data', 'obs')
const STATION_TABLE = path.join(OBS_DIR, 'stations-cn.json')
const SPOTS_JSON = path.join(ROOT, 'src', 'data', 'forecast', 'spots.json')

const MAX_SPOT_KM = 45

function km(aLat, aLon, bLat, bLon) {
  const R = 6371
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLon = (bLon - aLon) * Math.PI / 180
  const y = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(y))
}

/* ---------- CSV ---------- */
function parseCsv(text) {
  const lines = text.split('\n')
  const head = lines[0].split(',')
  const out = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cols = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ',') { cols.push(cur); cur = '' }
      else cur += c
    }
    cols.push(cur)
    const o = {}
    head.forEach((h, i) => (o[h.trim()] = (cols[i] ?? '').trim()))
    out.push(o)
  }
  return out
}

async function loadMetar() {
  if (!existsSync(OBS_DIR)) return []
  const files = (await readdir(OBS_DIR)).filter((f) => f.startsWith('metar-') && f.endsWith('.csv'))
  const rows = []
  for (const f of files) rows.push(...parseCsv(await readFile(path.join(OBS_DIR, f), 'utf8')))
  return rows
}

async function loadStations() {
  if (!existsSync(STATION_TABLE)) return new Map()
  const j = JSON.parse(await readFile(STATION_TABLE, 'utf8'))
  const m = new Map()
  for (const s of j.stations || []) m.set(s.id, s)
  return m
}

/** 机场 ICAO → 观测点机位名（spots.json 里带 obs 字段的那些） */
async function loadObsSpots() {
  if (!existsSync(SPOTS_JSON)) return new Map()
  const raw = JSON.parse(await readFile(SPOTS_JSON, 'utf8'))
  const list = Array.isArray(raw) ? raw : raw.spots || []
  const m = new Map()
  for (const s of list) if (s.obs) m.set(s.obs, s.n)
  return m
}

async function loadSnapshots() {
  if (!existsSync(OBS_DIR)) return []
  const files = (await readdir(OBS_DIR)).filter((f) => f.startsWith('forecast-') && f.endsWith('.json'))
  const snaps = []
  for (const f of files) {
    try { snaps.push(JSON.parse(await readFile(path.join(OBS_DIR, f), 'utf8'))) } catch { /* 跳过坏文件 */ }
  }
  return snaps
}

function truthOf(metar) {
  const clear = metar.clear === '1'
  const cover = Number(metar.cloud_max_cover || 0)
  const baseFt = metar.cloud_min_base_ft === '' ? null : Number(metar.cloud_min_base_ft)
  const NAME = ['', 'FEW', 'SCT', 'BKN', 'OVC']

  if (clear) return { kind: 'clear', text: '无云' }
  if (cover >= 3 && baseFt != null && baseFt < 2000) {
    return { kind: 'blocked', text: '低云封挡 ' + NAME[cover] + ' ' + baseFt + 'ft' }
  }
  if (cover >= 2) {
    return { kind: 'cloudy', text: '有中高云 ' + NAME[cover] + (baseFt != null ? ' ' + baseFt + 'ft' : '') }
  }
  return { kind: 'few', text: '少云 ' + (cover === 1 ? 'FEW' : '无分组') }
}

/** 日落时刻 ±90 分钟内最近的观测 */
function nearestMetar(list, isoLocal) {
  const target = Date.parse(isoLocal.replace(' ', 'T') + ':00+08:00')
  if (isNaN(target)) return null
  let best = null
  let bestD = Infinity
  for (const m of list) {
    const t = Date.parse(m.time_utc)
    if (isNaN(t)) continue
    const d = Math.abs(t - target)
    if (d < bestD) { bestD = d; best = m }
  }
  return bestD <= 90 * 60 * 1000 ? best : null
}

async function main() {
  const args = process.argv.slice(2)
  const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : ''
  const to = args.includes('--to') ? args[args.indexOf('--to') + 1] : ''
  const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 40
  const onlyA = args.includes('--only-a')

  const metars = await loadMetar()
  const snapshots = await loadSnapshots()
  const stations = await loadStations()
  const obsSpots = await loadObsSpots()

  if (!metars.length) { console.log('还没有 METAR 数据，先跑 node tools/fetch-metar.mjs'); return }
  if (!snapshots.length) { console.log('还没有预报快照，先跑 node tools/snapshot-forecast.mjs'); return }

  const byStation = new Map()
  for (const m of metars) {
    if (!byStation.has(m.station)) byStation.set(m.station, [])
    byStation.get(m.station).push(m)
  }
  console.log('METAR 观测 ' + metars.length + ' 条 / ' + byStation.size + ' 个站；预报快照 ' + snapshots.length + ' 份')
  console.log('机位库里的机场观测点 ' + obsSpots.size + ' 个（有对应点的才是 A 级样本）')

  const results = []

  for (const snap of snapshots) {
    const day = snap.targetDate
    if (!day) continue
    if (from && day < from) continue
    if (to && day > to) continue
    const sunsetLocal = day + ' ' + (snap.targetTime || '18:00')

    for (const [sid, list] of byStation) {
      const st = stations.get(sid)
      if (!st) continue

      const m = nearestMetar(list, sunsetLocal)
      if (!m) continue
      const truth = truthOf(m)

      /* ---- A 级：机场自己有观测点机位，坐标完全一致 ---- */
      const obsName = obsSpots.get(sid)
      const obsRow = obsName ? snap.rows.find((r) => r.n === obsName) : null

      let row = null
      let grade = ''
      let dist = 0

      if (obsRow) {
        row = obsRow
        grade = 'A'
        dist = 0
      } else if (!onlyA) {
        /* ---- B 级：没有观测点，用 45 km 内最近的机位代表机场 ---- */
        const near = snap.rows
          .map((r) => ({ ...r, d: km(st.lat, st.lon, r.lat, r.lon) }))
          .filter((r) => r.d <= MAX_SPOT_KM)
          .sort((a, b) => a.d - b.d)
        if (!near.length) continue
        row = near[0]
        grade = 'B'
        dist = Math.round(near[0].d)
      }
      if (!row) continue

      let verdict = '—'
      if (truth.kind === 'clear' || truth.kind === 'blocked') {
        verdict = row.score >= 48 ? '❌ 误报' : '✅ 合理'
      } else if (truth.kind === 'cloudy') {
        verdict = row.score < 30 ? '⚠ 待复核' : '✅ 合理'
      } else {
        verdict = row.score >= 48 ? '⚠ 待复核' : '✅ 合理'
      }

      results.push({
        day, station: st.name || sid, sid, grade,
        obs: m.time_bj.slice(11, 16),
        truth: truth.text,
        spot: row.n, km: dist,
        score: row.score, level: row.level,
        verdict
      })
    }
  }

  if (!results.length) {
    console.log('没有可配对的日子（需要同一天的 METAR 与预报快照）')
    return
  }

  results.sort((a, b) => (a.day === b.day ? a.station.localeCompare(b.station) : a.day.localeCompare(b.day)))

  console.log('\n级别 日期        机场            观测  实况                    机位              距离   分  等级    判定')
  console.log('-'.repeat(112))
  for (const r of results.slice(0, topN)) {
    console.log(
      ' ' + r.grade + '   ' +
      r.day + '  ' +
      String(r.station).slice(0, 12).padEnd(13, '　') + ' ' +
      r.obs + '  ' +
      r.truth.padEnd(22, ' ') + ' ' +
      r.spot.slice(0, 10).padEnd(11, '　') + ' ' +
      (r.km === 0 ? '  同址' : String(r.km).padStart(3) + 'km') + ' ' +
      String(r.score).padStart(3) + '  ' +
      r.level.padEnd(5, '　') + ' ' +
      r.verdict
    )
  }
  if (results.length > topN) console.log('… 还有 ' + (results.length - topN) + ' 条，用 --top 调大')

  /* A / B 分开汇总：A 才是能拿来改算法的口径 */
  for (const grade of ['A', 'B']) {
    const g = results.filter((r) => r.grade === grade)
    const judged = g.filter((r) => r.verdict !== '—')
    console.log('\n===== ' + grade + ' 级' + (grade === 'A' ? '（同址配对，主口径）' : '（就近代表，仅参考）') + ' =====')
    if (!g.length) {
      console.log('没有样本' + (grade === 'A' ? '（观测点还没进省级缓存，跑一次 tools/build-cache.mjs 就有了）' : ''))
      continue
    }
    const fa = judged.filter((r) => r.verdict === '❌ 误报')
    const ok = judged.filter((r) => r.verdict === '✅ 合理')
    const rv = judged.filter((r) => r.verdict.startsWith('⚠'))
    console.log('样本 ' + g.length + '　可判定 ' + judged.length + '　误报 ' + fa.length + '　合理 ' + ok.length + '　待复核 ' + rv.length)
    if (judged.length) console.log('误报率 ' + (100 * fa.length / judged.length).toFixed(1) + '%')
    if (fa.length) {
      console.log('误报明细：')
      for (const r of fa) {
        console.log('  ' + r.day + ' ' + r.station + '｜实况『' + r.truth + '』但 ' + r.spot + ' 给了 ' + r.score + ' 分（' + r.level + '）')
      }
    }
  }

  console.log('\n注：「待复核」不是算法结论——要等照片或卫星图才能定；「误报」也只说明预报与机场实况不符。')
  console.log('注：A 级是机场观测点与机场同址配对，可直接用来改算法；B 级机场离机位 11–45 km，只看趋势。')
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
