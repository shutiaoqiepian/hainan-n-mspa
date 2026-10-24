/**
 * 用每天存的 METAR 实况 + 预报快照，算「端到端误报 / 漏报」。
 *
 * 不需要任何人填表：METAR 是机场自动观测，每小时一条。
 *
 * 判定口径（故意保守，宁可少判也不冤枉算法）：
 *   实况无云（CAVOK / NSC / SKC）        → 天上没有「画布」，真值 = 不可能有火烧云
 *      若算法给 ≥ 48 分（小烧及以上）    → 记一次【误报】
 *   实况有 BKN/OVC 且云底低于 2000 ft    → 低云封挡，也几乎不可能有霞
 *      若算法给 ≥ 48 分                  → 记一次【误报】
 *   实况有 SCT/BKN 中高云（≥ 2000 ft）   → 有可能出霞，但不能证明一定烧
 *      若算法给 < 30 分（微烧以下）      → 记一次【待复核】（可能是漏报，需人看照片才能定）
 *   其余                                  → 不判定
 *
 * 用法：
 *   node tools/check-accuracy.mjs
 *   node tools/check-accuracy.mjs --from 2026-10-01 --to 2026-10-31
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OBS_DIR = path.join(ROOT, 'data', 'obs')

/* 机场坐标（用于把机位配到最近的机场） */
const STATIONS = {
  ZJHK: { name: '海口美兰', lat: 19.93, lon: 110.46 },
  ZJSY: { name: '三亚凤凰', lat: 18.30, lon: 109.41 }
}

const MAX_SPOT_KM = 45

function km(aLat, aLon, bLat, bLon) {
  const R = 6371
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLon = (bLon - aLon) * Math.PI / 180
  const y = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(y))
}

/* ---------- 读 METAR ---------- */
function parseCsv(text) {
  const lines = text.split('\n')
  const head = lines[0].split(',')
  const out = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    /* raw 字段可能含逗号并被引号包住：简单状态机拆 */
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
  for (const f of files) {
    const list = parseCsv(await readFile(path.join(OBS_DIR, f), 'utf8'))
    rows.push(...list)
  }
  return rows
}

/* ---------- 读快照 ---------- */
async function loadSnapshots() {
  if (!existsSync(OBS_DIR)) return []
  const files = (await readdir(OBS_DIR)).filter((f) => f.startsWith('forecast-') && f.endsWith('.json'))
  const snaps = []
  for (const f of files) {
    try {
      snaps.push(JSON.parse(await readFile(path.join(OBS_DIR, f), 'utf8')))
    } catch { /* 跳过坏文件 */ }
  }
  return snaps
}

/* ---------- 判定 ---------- */
function truthOf(metar) {
  const clear = metar.clear === '1'
  const cover = Number(metar.cloud_max_cover || 0)   // 0 无 1 FEW 2 SCT 3 BKN 4 OVC
  const baseFt = metar.cloud_min_base_ft === '' ? null : Number(metar.cloud_min_base_ft)

  if (clear) return { kind: 'clear', text: '无云' }
  if (cover >= 3 && baseFt != null && baseFt < 2000) {
    return { kind: 'blocked', text: '低云封挡 (' + (cover === 4 ? 'OVC' : 'BKN') + ' ' + baseFt + 'ft)' }
  }
  if (cover >= 2) {
    return { kind: 'cloudy', text: '有中高云 (' + (cover === 4 ? 'OVC' : cover === 3 ? 'BKN' : 'SCT') + (baseFt != null ? ' ' + baseFt + 'ft' : '') + ')' }
  }
  return { kind: 'few', text: '少云 (' + (cover === 1 ? 'FEW' : '无分组') + ')' }
}

/** 找到离某个日落时刻最近的 METAR（±90 分钟） */
function nearestMetar(metars, stationId, isoLocal) {
  const target = Date.parse(isoLocal.replace(' ', 'T') + ':00+08:00')
  if (isNaN(target)) return null
  let best = null
  let bestD = Infinity
  for (const m of metars) {
    if (m.station !== stationId) continue
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

  const metars = await loadMetar()
  const snaps = await loadSnapshots()

  if (!metars.length) { console.log('还没有 METAR 数据，先跑 node tools/fetch-metar.mjs'); return }
  if (!snaps.length) { console.log('还没有预报快照，先跑 node tools/snapshot-forecast.mjs'); return }

  console.log('METAR 观测 ' + metars.length + ' 条，预报快照 ' + snaps.length + ' 份\n')

  const results = []

  for (const snap of snaps) {
    const day = snap.targetDate
    if (!day) continue
    if (from && day < from) continue
    if (to && day > to) continue

    const sunsetLocal = day + ' ' + (snap.targetTime || '18:00')

    for (const [sid, st] of Object.entries(STATIONS)) {
      const near = snap.rows
        .map((r) => ({ ...r, km: km(st.lat, st.lon, r.lat, r.lon) }))
        .filter((r) => r.km <= MAX_SPOT_KM)
        .sort((a, b) => a.km - b.km)
      if (!near.length) continue

      const m = nearestMetar(metars, sid, sunsetLocal)
      if (!m) continue

      const truth = truthOf(m)
      const top = near[0]

      let verdict = '—'
      if (truth.kind === 'clear' || truth.kind === 'blocked') {
        verdict = top.score >= 48 ? '❌ 误报' : '✅ 合理'
      } else if (truth.kind === 'cloudy') {
        verdict = top.score < 30 ? '⚠ 待复核(可能漏报)' : '✅ 合理'
      } else {
        verdict = top.score >= 48 ? '⚠ 待复核(高分)' : '✅ 合理'
      }

      results.push({
        day,
        station: st.name,
        obs: m.time_bj.slice(11, 16),
        truth: truth.text,
        spot: top.n,
        km: Math.round(top.km),
        score: top.score,
        level: top.level,
        verdict
      })
    }
  }

  if (!results.length) {
    console.log('没有可以配对的日子（需要同一天的 METAR 和预报快照）')
    return
  }

  console.log('日期        机场     观测   实况                      最近机位        距离  分  等级    判定')
  console.log('-'.repeat(112))
  for (const r of results) {
    console.log(
      r.day + '  ' +
      r.station.padEnd(6, '　') + ' ' +
      r.obs + '  ' +
      r.truth.padEnd(24, ' ') + ' ' +
      r.spot.padEnd(14, '　') + ' ' +
      String(r.km).padStart(3) + 'km ' +
      String(r.score).padStart(3) + '  ' +
      r.level.padEnd(5, '　') + ' ' +
      r.verdict
    )
  }

  const judged = results.filter((r) => r.verdict !== '—')
  const falseAlarm = judged.filter((r) => r.verdict === '❌ 误报').length
  const ok = judged.filter((r) => r.verdict === '✅ 合理').length
  const review = judged.filter((r) => r.verdict.startsWith('⚠')).length

  console.log('\n===== 汇总 =====')
  console.log('可判定的样本：' + judged.length)
  console.log('误报：' + falseAlarm + '　合理：' + ok + '　待复核：' + review)
  if (judged.length) {
    console.log('误报率：' + (100 * falseAlarm / judged.length).toFixed(1) + '%')
  }
  console.log('\n注：「待复核」不是算法结论——要等有照片或卫星图才能定。')
  console.log('注：样本按「机场」聚合，机场在郊区，与市区机位的云况会有偏差。')
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
