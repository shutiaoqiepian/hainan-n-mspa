/**
 * 跨模式对照：同一时刻、同一机位，GFS vs ECMWF IFS 0.25 的逐层云量 / RH / 位势高度。
 *
 * 为什么要做：
 *   docs/阶段七-02 里 GFS 的「云在哪一层」是全系统的地基。如果两家模式在同一层分歧很大，
 *   那一层的结论就不该被当作事实 —— 这张表就是用来找"分歧最大的层"的。
 *
 * 数据源（都实测可用、免注册）：
 *   https://archive-api.open-meteo.com/v1/archive?models=gfs_seamless|ecmwf_ifs025
 *   变量：cloud_cover_{level}hPa / relative_humidity_{level}hPa / geopotential_height_{level}hPa
 *
 * ⚠ 必须写明的口径问题：
 *   Open-Meteo 的 `cloud_cover_*hPa` **不是模式原生云水/云量**，而是由 RH 诊断出来的
 *   （本项目实测：RH<40% 恒为 0；RH=80% 时 ECMWF/GFS/ICON 分别只有 4%/1%/4%）。
 *   所以「两家云量差异大」有一部分是**各自的 RH→云量参数化不同**，不完全是气象分歧；
 *   真正可比的是 RH 与位势高度本身。表里两列都给出，让读者自己判断。
 *
 * 用法：
 *   node tools/obs/compare-models.mjs --date 2026-10-28 --days 4
 *   node tools/obs/compare-models.mjs --date 2026-10-28 --days 4 --json data/obs/model-divergence.json
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 200]
const API = 'https://archive-api.open-meteo.com/v1/archive'
const MODELS = ['gfs_seamless', 'ecmwf_ifs025']
/** 只取当地日落前后三个整点（北京 16/17/18 时 ≈ UTC 08/09/10） */
const HOURS = [8, 9, 10]

function bj(iso) {
  return new Date(Date.parse(iso + 'Z') + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

async function fetchOne(lat, lon, date, model) {
  const vars = []
  for (const lv of LEVELS) {
    vars.push(`cloud_cover_${lv}hPa`, `relative_humidity_${lv}hPa`, `geopotential_height_${lv}hPa`)
  }
  const qs = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    start_date: date, end_date: date,
    hourly: vars.join(','), models: model, timezone: 'UTC'
  })
  const url = `${API}?${qs}`
  for (let k = 0; k < 3; k++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (k === 2) throw e
      await new Promise((r) => setTimeout(r, 900 * (k + 1)))
    }
  }
}

function pick(hourly, key, hourIdx) {
  const arr = hourly[key]
  if (!Array.isArray(arr)) return null
  const v = arr[hourIdx]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function main() {
  const args = process.argv.slice(2)
  const get = (k, d = '') => {
    const i = args.indexOf('--' + k)
    return i >= 0 ? args[i + 1] : d
  }
  const date = get('date')
  const days = Number(get('days', '1')) || 1
  const outPath = get('json')
  if (!date) {
    console.error('用法：node tools/obs/compare-models.mjs --date 2026-10-28 [--days 4] [--json out.json]')
    process.exit(2)
  }

  const index = JSON.parse(await readFile(path.join(ROOT, 'data', 'cross', 'index.json'), 'utf8'))
  const rows = []

  for (let d = 0; d < days; d++) {
    const dt = new Date(date + 'T00:00:00Z')
    dt.setUTCDate(dt.getUTCDate() + d)
    const day = dt.toISOString().slice(0, 10)
    for (const spot of index.spots) {
      const results = {}
      for (const model of MODELS) {
        try {
          const j = await fetchOne(spot.lat, spot.lon, day, model)
          const times = j.hourly?.time ?? []
          const hIdx = HOURS.map((h) => times.findIndex((t) => t.endsWith(`T${String(h).padStart(2, '0')}:00`)))
          results[model] = { times, hIdx, hourly: j.hourly }
        } catch (e) {
          results[model] = { error: String(e.message || e) }
        }
      }

      /* 逐层比较：只在两边都有值的时次上算差 */
      const perLevel = LEVELS.map((lv) => {
        const cc = [], rh = [], gh = []
        for (const hi of results[MODELS[0]]?.hIdx ?? []) {
          if (hi < 0) continue
          for (const key of ['cloud_cover', 'relative_humidity', 'geopotential_height']) {
            const a = pick(results[MODELS[0]].hourly, `${key}_${lv}hPa`, hi)
            const b = pick(results[MODELS[1]].hourly, `${key}_${lv}hPa`, hi)
            if (a == null || b == null) continue
            if (key === 'cloud_cover') cc.push(b - a)
            else if (key === 'relative_humidity') rh.push(b - a)
            else gh.push(b - a)
          }
        }
        const avg = (arr) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null)
        const abs = (arr) => (arr.length ? Math.round((arr.reduce((s, v) => s + Math.abs(v), 0) / arr.length) * 10) / 10 : null)
        return {
          hPa: lv,
          /** IFS − GFS 的平均差（正 = IFS 更高/更多） */
          dCloudPct: avg(cc), absDCloudPct: abs(cc),
          dRhPct: avg(rh), absDRhPct: abs(rh),
          /** 位势高度差（m）：两家垂直坐标是否一致 */
          dHgtM: avg(gh), absDHgtM: abs(gh),
          n: cc.length + rh.length + gh.length
        }
      })
      rows.push({ day, spot: spot.id, name: spot.name, perLevel })
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), levelNote: 'cloud_cover 为 RH 诊断值，不是模式原生云量', rows }, null, 1))
    console.log(`写出 ${outPath}（${rows.length} 行）`)
  }

  /* 汇总：把同一层跨所有机位/日期平均，找分歧最大的层 */
  const byLevel = LEVELS.map((lv) => {
    const cells = rows.flatMap((r) => r.perLevel.filter((p) => p.hPa === lv && p.n > 0))
    const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN)
    return {
      hPa: lv,
      absDCloudPct: Math.round(mean(cells.map((c) => c.absDCloudPct)) * 10) / 10,
      absDRhPct: Math.round(mean(cells.map((c) => c.absDRhPct)) * 10) / 10,
      absDHgtM: Math.round(mean(cells.map((c) => c.absDHgtM))),
      n: cells.reduce((s, c) => s + c.n, 0)
    }
  })
  console.log('\n层(hPa)  |云量差|(%) |RH差|(%) |高度差|(m)  样本')
  for (const r of byLevel) {
    console.log(
      String(r.hPa).padStart(6) + '   ' +
      String(r.absDCloudPct).padStart(8) + '  ' +
      String(r.absDRhPct).padStart(8) + '  ' +
      String(r.absDHgtM).padStart(9) + '  ' +
      String(r.n).padStart(5)
    )
  }
  const worst = [...byLevel].sort((a, b) => b.absDRhPct - a.absDRhPct)[0]
  console.log(`\nRH 分歧最大的层：${worst.hPa} hPa（平均差 ${worst.absDRhPct}%），这一层的云判据最不可信。`)
  console.log('注：cloud_cover 是 RH 诊断值，两家的 RH→云量参数化不同，云量差里含参数化差异。')
}

main().catch((e) => { console.error(e); process.exit(1) })
