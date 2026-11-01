/**
 * 云层结构对照：卫星（MODIS 云顶高度）vs GFS 剖面（云水/云冰）。
 *
 * 目的不是"改算法"，而是回答一个问题：
 *   **模式说云在哪一层，和卫星看到的云顶高度，差多少？**
 *
 * 两个口径（必须分开看，不能混）：
 *   · GFS：9 个气压层的 CLWMR+ICMR，判"有云"用 ≥1 mg/kg（与图上着色起点一致）；
 *     只到 200 hPa（≈11.7 km），更高的云看不到。
 *   · 卫星：MODIS Terra 云顶高度瓦片（GIBS，官方调色板），取机位 78 km 邻域，
 *     分 4 档（<2 / 2–5 / 5–8 / >8 km）。
 *   · 时间不对齐：卫星是当地约 13:30 过境，GFS 剖面是日落前后 4 个整点。
 *     所以这里比的是"**这一带当天有没有高层云**"，不是同一时刻的同一朵云。
 *
 * 用法：
 *   node tools/obs/compare-cth.mjs --date 2026-10-20 --days 3
 *   node tools/obs/compare-cth.mjs --date 2026-10-20 --days 3 --json data/obs/cth-compare.json
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { loadColormap, sampleCth } from './sample-cth.mjs'

const ROOT = process.cwd()

/** 从 GFS 剖面判断"当天最高一层有云的层高（km MSL）" */
function gfsCloudTop(file) {
  const idx = Object.fromEntries(file.levelFields.map((f, i) => [f, i]))
  const tops = []
  let any = false
  for (const sec of file.sections) {
    for (const s of sec.samples) {
      for (let j = 0; j < s.levels.length; j++) {
        const row = s.levels[j]
        const clw = row[idx.clwMgKg]
        const ici = row[idx.iciMgKg]
        const hgt = row[idx.hgtM]
        const below = row[idx.belowGround] === 1
        if (below || hgt == null) continue
        const q = (clw ?? null) === null && (ici ?? null) === null ? null : (clw ?? 0) + (ici ?? 0)
        if (q === null || q < 1) continue
        any = true
        tops.push(hgt / 1000)
      }
    }
  }
  return {
    hasCloud: any,
    maxTopKm: any ? Math.round(Math.max(...tops) * 10) / 10 : null,
    count: tops.length
  }
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
    console.error('用法：node tools/obs/compare-cth.mjs --date 2026-10-20 [--days 3] [--json out.json]')
    process.exit(2)
  }

  const index = JSON.parse(await readFile(path.join(ROOT, 'data/cross/index.json'), 'utf8'))
  const colormap = await loadColormap()
  const rows = []

  for (let d = 0; d < days; d++) {
    const dt = new Date(date + 'T00:00:00Z')
    dt.setUTCDate(dt.getUTCDate() + d)
    const day = dt.toISOString().slice(0, 10)
    for (const spot of index.spots) {
      /* GFS 剖面缓存只有"今天/明天"那一轮，历史日期没有对应文件 —— 明确写出来 */
      let gfs = null
      try {
        const f = JSON.parse(await readFile(path.join(ROOT, 'data/cross', spot.file), 'utf8'))
        gfs = { cycle: f.cycle, ...gfsCloudTop(f) }
      } catch {
        gfs = { error: '剖面缓存缺失' }
      }
      let sat = null
      try {
        sat = await sampleCth({ lat: spot.lat, lon: spot.lon, date: day, colormap })
      } catch (e) {
        sat = { error: String(e.message || e) }
      }
      rows.push({ day, spot: spot.id, name: spot.name, gfs, sat })
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify(rows, null, 1))
    console.log(`写出 ${outPath}（${rows.length} 条）`)
  }

  /* 打印一句话结论（只描述能对上的部分） */
  console.log('\n日 期        机位        卫星>8km  卫星5-8km 卫星均云顶  GFS 最高有云层')
  for (const r of rows) {
    const s = r.sat?.bandFraction
    const g = r.gfs?.maxTopKm
    console.log(
      r.day + '  ' + r.spot.padEnd(12) +
      (s ? (s.above8km * 100).toFixed(0) + '%' : '—').padStart(6) +
      (s ? (s['5to8km'] * 100).toFixed(0) + '%' : '—').padStart(8) +
      (r.sat?.meanCloudTopM != null ? String(r.sat.meanCloudTopM) + ' m' : '—').padStart(10) +
      '    ' + (g != null ? g + ' km（cycle ' + r.gfs.cycle + '）' : '无云/缺缓存')
    )
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
