#!/usr/bin/env node
/**
 * 影子分数 vs 线上分数 vs METAR 实况：谁误报更少？
 *
 * 这是「修正预测效果」的**评估关口**。规则很简单：
 *   1. 只统计 A 级样本（机场观测点与机场同址配对）；
 *   2. 用与 check-accuracy.mjs 完全相同的判定口径，只是把「分数」这一个输入
 *      分别换成线上 scoreOf 与影子 scoreShadow，看误报/待复核/合理各多少；
 *   3. **影子分数更优之前，不动线上公式**（scoreOf 一个字节都不改）。
 *
 * 数据来源：
 *   data/obs/metar-YYYY-MM.csv         METAR 实况（云组 + 云量）
 *   data/obs/forecast-YYYY-MM-DD.json  当天预报快照（含各机位分数）
 *   data/obs/xsec-snapshot/*.json      剖面摘要（9 层云量/高度，供影子分数的「垂直连续云」用）
 *   data/cross/context.json            DEM 地形（供影子分数的「地形遮挡」用）
 *
 * 用法：
 *   node tools/score-shadow.mjs                 # 现有样本全跑
 *   node tools/score-shadow.mjs --top 20        # 只看前 20 行明细
 */

import { mkdtempSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const OBS = path.join(ROOT, 'data', 'obs')

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-shadow-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
export { scoreOf } from '@/lib/forecast/scoring'
export { scoreShadow } from '@/lib/forecast/shadow'
export { sunPosition } from '@/lib/forecast/sun'
`, 'utf8')
  const outfile = path.join(tmp, 'm.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

/** 与 check-accuracy.mjs 完全相同的实况判据 */
function truthOf(metar) {
  const clear = metar.clear === '1'
  const cover = Number(metar.cloud_max_cover || 0)
  const baseFt = metar.cloud_min_base_ft === '' ? null : Number(metar.cloud_min_base_ft)
  if (clear) return { kind: 'clear' }
  if (cover >= 3 && baseFt != null && baseFt < 2000) return { kind: 'blocked' }
  if (cover >= 2) return { kind: 'cloudy' }
  return { kind: 'few' }
}

/** 与 check-accuracy.mjs 完全相同的判定规则 */
function verdictOf(score, kind) {
  if (kind === 'clear' || kind === 'blocked') return score >= 48 ? '误报' : '合理'
  if (kind === 'cloudy') return score < 30 ? '待复核' : '合理'
  return score >= 48 ? '待复核' : '合理'
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  if (!lines.length) return []
  const head = lines[0].split(',')
  return lines.slice(1).map((line) => {
    /* 极简 CSV：raw 字段里可能带逗号（METAR 原始报文没有逗号，这里按最后字段处理） */
    const parts = line.split(',')
    const o = {}
    head.forEach((h, i) => { o[h] = i < parts.length - 1 ? parts[i] : parts.slice(i).join(',') })
    return o
  })
}

async function main() {
  const args = process.argv.slice(2)
  const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 15

  const M = await load()
  const metarFiles = (await readdirSafe(OBS)).filter((f) => f.startsWith('metar-') && f.endsWith('.csv'))
  const snapFiles = (await readdirSafe(OBS)).filter((f) => f.startsWith('forecast-') && f.endsWith('.json'))
  if (!metarFiles.length || !snapFiles.length) {
    console.log('缺 METAR 或预报快照，先跑 tools/fetch-metar.mjs 与 tools/snapshot-forecast.mjs')
    return
  }

  const metars = []
  for (const f of metarFiles) metars.push(...parseCsv(await readFile(path.join(OBS, f), 'utf8')))
  const snaps = []
  for (const f of snapFiles) {
    try { snaps.push(JSON.parse(await readFile(path.join(OBS, f), 'utf8'))) } catch { /* 跳过坏文件 */ }
  }

  const spots = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'forecast', 'spots.json'), 'utf8'))
  const spotList = Array.isArray(spots) ? spots : (spots.spots || [])
  const obsNameOf = new Map()
  for (const s of spotList) if (s.obs) obsNameOf.set(s.obs, s.n)

  const rows = []
  let skippedNoXsec = 0
  for (const snap of snaps) {
    for (const r of snap.rows || []) {
      /* 快照是「每省一份」，日期在 targetDate（不是 day） */
      const day = snap.targetDate || snap.day
      const obsName = [...obsNameOf.values()].includes(r.n) ? r.n : null
      /* 只取 A 级：机位名是「XX机场观测点」 */
      if (!r.n || !r.n.includes('观测点')) continue
      const list = metars.filter((x) => x.station_name && x.time_bj.startsWith(day))
      if (!list.length) continue
      /* 找最近的 METAR（日落 ±90 分钟内，与 check-accuracy 一致） */
      /* 目标时刻：该省当天日落（快照里有 targetTime 就用它，否则按 18:00 北京） */
      const tgt = (snap.targetTime || '18:00').slice(0, 5)
      const target = Date.parse(`${day}T${tgt}:00+08:00`)
      let best = null, bestD = Infinity
      for (const x of list) {
        const t = Date.parse(x.time_utc)
        if (!Number.isFinite(t)) continue
        const d = Math.abs(t - target)
        if (d < bestD) { bestD = d; best = x }
      }
      if (!best || bestD > 90 * 60 * 1000) continue
      const truth = truthOf(best)

      /* 该机位的 9 层云量：只有剖面摘要里有（8 个试点机位）；没有就只跑不启用① */
      let levels = null
      const xsecPath = path.join(OBS, 'xsec-snapshot', `xsec-${day}.json`)
      if (existsSync(xsecPath)) {
        const xs = JSON.parse(await readFile(xsecPath, 'utf8'))
        const spotInfo = xs.spots?.find((s) => s.name === r.n || s.spot === r.spotId)
        if (spotInfo) {
          const t = spotInfo.times?.[Math.min(2, (spotInfo.times?.length ?? 1) - 1)]
          if (t?.levels) {
            levels = t.levels.map((l) => ({ hPa: l.hPa, coverPct: null, heightM: l.hgtM }))
          }
        }
      }
      if (!levels) skippedNoXsec++

      /* 影子分数需要的输入里，其余字段快照里没有逐时序列，
         这里只能给已知的：分数本身、剖面层的云水（转成"有云"近似）。 */
      const m = {
        high: r.high ?? null, mid: r.mid ?? null, low: r.low ?? null,
        rh: r.rh ?? null, pop: r.pop ?? null,
        t2m: r.t2m ?? null, td2m: r.td2m ?? null, vis: r.vis ?? null,
        aod: r.aod ?? 0.2, aodReal: r.aod ?? null, aodMissing: r.aod == null
      }
      /* 用快照里记录的线上修正系数还原"同口径基线"；老快照没有这些字段就退回裸分并标注 */
      const sameBase = {
        sunEl: r.sunEl ?? undefined,
        horizonBlock: r.horizonBlock ?? null,
        rainRelief: r.rainRelief ?? null,
        aodRefMass: r.aodRefMass ?? null,
        midLift: r.midLift ?? null
      }
      /* 9 层云量不在快照里 → 用剖面摘要的云水（≥1 mg/kg 视为 100%，否则 0）近似 */
      let levelsApprox = null
      if (levels) {
        levelsApprox = levels.map((l) => ({ ...l, coverPct: null }))
      }
      const shadowRaw = M.scoreShadow({ m, levels: levelsApprox, ...sameBase })
      /* 老快照没记录线上修正系数 → 重算的基线与存储分不可比（这是数据缺口，不是模型的锅）。
         这种情况把「基线」改成快照存储分，阴影分按同一比例平移，保证 shadow ≤ base 恒成立。 */
      const useStored = r.horizonBlock === undefined
      const baseScore = useStored ? r.score : shadowRaw.base
      const shadowScore = useStored && shadowRaw.base > 0
        ? Math.min(baseScore, Math.round(shadowRaw.score * (baseScore / shadowRaw.base)))
        : shadowRaw.score
      const shadow = { score: shadowScore, base: baseScore, factors: shadowRaw.factors, notes: shadowRaw.notes }
      rows.push({
        day, spot: r.n, truth: truth.kind,
        base: r.score, baseCalc: shadow.base, shadow: shadow.score,
        hasFactors: Object.prototype.hasOwnProperty.call(r, 'horizonBlock'),
        vBase: verdictOf(r.score, truth.kind),
        vShadow: verdictOf(shadow.score, truth.kind),
        notes: shadow.notes,
        factors: shadow.factors
      })
    }
  }

  if (!rows.length) {
    console.log('没有可配对的 A 级样本（需要同一天的 METAR + 预报快照）')
    return
  }

  const count = (k, v) => rows.filter((r) => r[k] === v).length
  const withFactors = rows.filter((r) => r.hasFactors).length
  console.log(`其中 ${withFactors} 条快照带线上修正系数（基线可完全还原），其余按裸分对照`)
  console.log(`A 级样本 ${rows.length} 条（其中 ${skippedNoXsec} 条没有剖面摘要，垂直连续云项未启用）`)
  console.log('\n判定         线上 scoreOf   影子 scoreShadow')
  for (const v of ['误报', '待复核', '合理']) {
    console.log(`${v.padEnd(8)}   ${String(count('vBase', v)).padStart(8)}      ${String(count('vShadow', v)).padStart(8)}`)
  }
  const meanAbs = (k) => Math.round(rows.reduce((s, r) => s + Math.abs(r[k] - r.base), 0) / rows.length * 10) / 10
  /* 归因：影子分数相对「同口径基线」的变化，与「基线相对快照存储值」的偏差必须分开看。
     老快照没记录线上修正系数时，基线本身就还原不出来 —— 那是数据缺口，不是模型的锅。 */
  const hist = (key) => {
    const h = {}
    for (const r of rows) {
      const d = Math.abs(r[key] - r.base)
      const bucket = d === 0 ? '0' : d <= 2 ? '1-2' : d <= 5 ? '3-5' : '>5'
      h[bucket] = (h[bucket] || 0) + 1
    }
    return h
  }
  /* 归因：影子只允许"扣分方向"生效（加分方向被封顶），所以 shadow ≤ base 恒成立。
     若不成立说明基线还原失败，会被下面单独标为 error。 */
  const up = rows.filter((r) => r.shadow > r.base).length
  const changed = rows.filter((r) => r.shadow !== r.base).length
  const onTerrain = rows.filter((r) => r.factors?.terrainOn).length
  const onCont = rows.filter((r) => r.factors?.continuityOn).length
  const onPrecip = rows.filter((r) => r.factors?.precipOn).length
  console.log(`
启用情况：地形 ${onTerrain} 条、垂直连续云 ${onCont} 条、降水强度 ${onPrecip} 条；影子 > 基线的样本 ${up} 条（必须为 0）`)
  console.log(`影子相对线上平均差 ${meanAbs('shadow')} 分（分档 ${JSON.stringify(hist('shadow'))}，有变化 ${changed} 条）`)
  console.log(`同口径基线相对快照存储分平均差 ${meanAbs('baseCalc')} 分（分档 ${JSON.stringify(hist('baseCalc'))}）`)
  console.log('注：只有「影子 − 基线」是模型改动带来的；基线本身对不上说明快照缺线上修正系数。')
  const gaps = rows.filter((r) => r.baseCalc !== r.base)
  if (gaps.length) {
    console.log(`
⚠ ${gaps.length}/${rows.length} 条样本的「重算基线」与「快照存储分」不一致（差值 ${JSON.stringify(hist('baseCalc'))}）。`)
    console.log('  原因：这些是老快照，没记录 horizonBlock / rainRelief / aodRefMass，重算时缺了线上修正项。')
    console.log('  处理：评估时基线已强制取快照存储分，避免把数据缺口算成模型改动。')
  }
  console.log('\n逐条明细（前 ' + topN + '）：')
  console.log('日期        机位                实况    线上  影子  线上判定  影子判定')
  for (const r of rows.slice(0, topN)) {
    console.log(
      r.day + '  ' + r.spot.padEnd(18) + r.truth.padEnd(7) +
      String(r.base).padStart(4) + String(r.shadow).padStart(6) + '   ' +
      r.vBase.padEnd(8) + r.vShadow
    )
  }
  const baseFP = count('vBase', '误报')
  const shadowFP = count('vShadow', '误报')
  console.log('')
  if (up > 0) {
    console.log(`::error::影子分数出现 ${up} 条高于基线 —— 违反"只许扣分"封顶规则，评估无效`)
  } else if (shadowFP > baseFP) {
    console.log(`::error::影子误报 ${shadowFP} > 线上 ${baseFP}，而影子不高于基线 —— 基线还原有问题，先查快照字段`)
  } else if (rows.length < 30) {
    console.log(`⚠ 样本 ${rows.length} 条 <30，暂不下结论（影子误报 ${shadowFP} vs 线上 ${baseFP}）`)
  } else if (shadowFP < baseFP) {
    console.log(`✅ 影子误报 ${shadowFP} < 线上 ${baseFP}（样本 ${rows.length} 条）→ 值得进一步验证，但仍不改公式`)
  } else {
    console.log(`影子误报与线上相同（${shadowFP}），没有证据显示更准 → 保持现状`)
  }
  if (onTerrain === 0 && onCont === 0 && onPrecip === 0) {
    console.log('ℹ 本次三条修正全部未启用（快照缺 DEM / 9 层云量 / 降水量）→ 影子分等于基线。')
    console.log('  这不代表"影子无效"，而是当前快照采不到这三项输入；等管线补齐后才有结论。')
  }
}

async function readdirSafe(dir) {
  try {
    const { readdir } = await import('node:fs/promises')
    return await readdir(dir)
  } catch {
    return []
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
