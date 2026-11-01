/**
 * 每日剖面快照：把当天的 GFS 剖面抽成「每层云水/云冰 + 层高」的摘要，按天存档。
 *
 * 为什么必须做这件事：
 *   data/cross/*.json 每 6 小时被覆盖一次，**历史剖面的原始数据留不下来**。
 *   没有历史剖面，就无法回答「模式预报的那朵高云，后来卫星实际看到了吗」——
 *   阶段七-03 的对照表里 GFS 那一列全是"当前这一轮"，就是因为缺这个。
 *
 * 存什么（每机位每天约 1 KB，按天一个文件）：
 *   每个时次 × 9 个气压层：该层在所有采样点/所有方位上的最大凝结水（mg/kg）与该层平均高度
 *   → 足以判断「模式认为云在哪一层、云顶多高」，比存整份剖面小两个数量级。
 *
 * 用法：
 *   node tools/obs/snapshot-xsec.mjs                  # 存今天（北京时间）
 *   node tools/obs/snapshot-xsec.mjs --date 2026-10-20
 *   node tools/obs/snapshot-xsec.mjs --check           # 只打印会写什么，不落盘
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CROSS = path.join(ROOT, 'data', 'cross')
const OUT_DIR = path.join(ROOT, 'data', 'obs', 'xsec-snapshot')

/** 北京时间日期（快照按"北京那一天"归档，和 METAR/评分快照一致） */
function bjDate(ms = Date.now()) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 一个机位文件的摘要：每个时次每层的最大凝结水与平均层高 */
function summarize(file) {
  const idx = Object.fromEntries(file.levelFields.map((f, i) => [f, i]))
  const byTime = new Map()
  for (const sec of file.sections) {
    const cur = byTime.get(sec.t) ?? {
      t: sec.t,
      levels: file.levelsHpa.map((hPa) => ({ hPa, qMax: null, hgtSum: 0, hgtN: 0 }))
    }
    for (const sample of sec.samples) {
      for (let j = 0; j < sample.levels.length; j++) {
        const row = sample.levels[j]
        if (row[idx.belowGround] === 1) continue
        const hgt = row[idx.hgtM]
        const clw = row[idx.clwMgKg]
        const ici = row[idx.iciMgKg]
        /* 两个成分都缺测 → 不能当 0；只有一个有值就按那一个算 */
        const q = clw == null && ici == null ? null : (clw ?? 0) + (ici ?? 0)
        if (q == null) continue
        const L = cur.levels[j]
        if (L.qMax === null || q > L.qMax) L.qMax = q
        if (hgt != null) { L.hgtSum += hgt; L.hgtN++ }
      }
    }
    byTime.set(sec.t, cur)
  }
  const times = (file.times ?? []).map((t) => {
    const s = byTime.get(t.t)
    const levels = (s?.levels ?? []).map((L) => ({
      hPa: L.hPa,
      hgtM: L.hgtN ? Math.round(L.hgtSum / L.hgtN) : null,
      /** 所有采样点/方位上的最大凝结水；null = 整层缺测，绝不写 0 */
      qMaxMgKg: L.qMax === null ? null : Math.round(L.qMax * 100) / 100
    }))
    const cloudy = levels.filter((l) => l.qMaxMgKg != null && l.qMaxMgKg >= 1 && l.hgtM != null)
    return {
      t: t.t,
      utc: t.utc,
      leadHours: t.leadHours,
      levels,
      /** 模式认为最高的"有云"层（≥1 mg/kg）的海拔（km）；无云为 null */
      cloudTopKm: cloudy.length
        ? Math.round((Math.max(...cloudy.map((l) => l.hgtM)) / 1000) * 10) / 10
        : null
    }
  })
  return {
    spot: file.spot.id,
    name: file.spot.name,
    cycle: file.cycle,
    times
  }
}

async function main() {
  const args = process.argv.slice(2)
  const get = (k, d = '') => {
    const i = args.indexOf('--' + k)
    return i >= 0 ? args[i + 1] : d
  }
  const check = args.includes('--check')
  const date = get('date') || bjDate()

  const index = JSON.parse(await readFile(path.join(CROSS, 'index.json'), 'utf8'))
  const spots = []
  for (const meta of index.spots) {
    const file = JSON.parse(await readFile(path.join(CROSS, meta.file), 'utf8'))
    spots.push(summarize(file))
  }

  const payload = {
    version: 1,
    date,
    /** 快照用的起报时次（GFS cycle） */
    cycle: index.cycle,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    note:
      '每层 qMax = 所有采样点 × 所有方位上的最大凝结水（CLWMR+ICMR，mg/kg）；' +
      'cloudTopKm = 有云层（≥1 mg/kg）中最高一层的海拔。缺测=null，不当 0。' +
      '用于与卫星云顶高度（tools/obs/sample-cth.mjs）逐日比对。',
    spots
  }

  const outPath = path.join(OUT_DIR, `xsec-${date}.json`)
  const kb = JSON.stringify(payload).length / 1024
  if (check) {
    console.log(`将写 ${outPath}（约 ${kb.toFixed(1)} KB，${spots.length} 个机位）`)
    for (const s of spots.slice(0, 2)) {
      console.log(s.spot, s.cycle, s.times.map((t) => `t${t.t}:${t.cloudTopKm ?? '无云'}km`).join(' '))
    }
    return
  }
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })
  if (existsSync(outPath) && !args.includes('--force')) {
    console.log(`已存在 ${outPath}，不覆盖（要覆盖加 --force）`)
    return
  }
  await writeFile(outPath, JSON.stringify(payload, null, 1))
  console.log(`写出 ${outPath}：${spots.length} 个机位，${kb.toFixed(1)} KB`)
  for (const s of spots) {
    console.log(`  ${s.spot.padEnd(13)} 云顶 ` + s.times.map((t) => `${t.cloudTopKm ?? '—'}km`).join(' / '))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
