/**
 * 中云补画布（C 方案）的影响面测量 —— 改了就行一次，别凭感觉。
 *
 * 用法：node tools/ab-midcloud.mjs [--verbose]
 *
 * 做法：拿 data/forecast/*.json 里的真实缓存，对每个机位 × 每一天 × 日出/日落，
 * 找出该事件落在的那一个小时，然后对「窗口内三个小时」分别算
 *   基线 = scoreOfAt(mm, 只带原来的修正项)
 *   新版 = scoreOfAt(mm, 再加 midLift)
 * 统计差值。
 *
 * ★ 为什么只测到 scoreOfAt 这一层：页面上的最终分还要乘
 *   `finish()` 里的一串乘法折扣（模式分歧 / 朝向 / 剖面 / 时效），
 *   这些对「基线」和「新版」是同一串系数，所以这里的差值方向与界面完全一致，
 *   只是幅度会被等比缩放。页面上的真实分数请用浏览器验收。
 *
 * 判定门槛（AGENTS.md 硬约束 2「不许让全站分数系统性上浮」）：
 *   · 平均变化必须 < +1.0 分；
 *   · 降低的样本必须为 0（本改动数学上只增不减，出现降低就是 bug）；
 *   · 「不烧 → 小烧」及以上的等级翻转必须集中在高云<8% 的样本里。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VERBOSE = process.argv.includes('--verbose')
/* --alpha=0.4,0.5,0.6 做敏感性扫描：midCanvasAdd 对 alpha 是线性的，
   所以不用改源码，直接按比例缩放即可（源码里的 alpha 只作为默认值）。 */
const alphaArg = (process.argv.find((a) => a.startsWith('--alpha=')) || '').slice(8)
const ALPHAS = alphaArg ? alphaArg.split(',').map(Number).filter((v) => v > 0) : [null]

async function load() {
  const { build } = await import('esbuild')
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-abmid-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
export { measureAt, hourIndex } from '@/lib/forecast/api'
export { scoreOfAt, airmass, clamp } from '@/lib/forecast/scoring'
export { sunPosition } from '@/lib/forecast/sun'
export { midCanvasPlan, MID_RH_LEVELS, MID_CANVAS } from '@/lib/forecast/midcloud'
export { LEVELS, levelOf } from '@/data/forecast/levels'
`, 'utf8')
  const outfile = path.join(tmp, 'm.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, alias: { '@': path.join(ROOT, 'src') }, logLevel: 'error'
  })
  return import(pathToFileURL(outfile).href)
}

const M = await load()

/* 等级表直接用源码里的那份，别在这里抄第二份 ——
   2026-11-06 改档名时，仓库里 6 处抄写的 LEVELS 全都要手改一遍。 */
const levelOf = (s) => M.levelOf(s).name

const MID = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless']

function profField(pr, name, idx) {
  const ph = pr?.hourly
  if (!ph) return null
  const a = ph[name] || ph[name + '_ecmwf_ifs025']
  if (!a) return null
  const v = a[idx]
  return Number.isFinite(v) ? v : null
}

function lcl(t, td) {
  if (t == null || td == null) return null
  return Math.max(0, Math.round(125 * (t - td)))
}

/** 原地找某个机位在某一天太阳高度的零点（日出 = 上升穿过 0，日落 = 下降穿过 0） */
function findEvent(ms0, lat, lon, date, kind) {
  const base = Date.parse(date + 'T00:00:00+08:00')
  if (isNaN(base)) return null
  const el = (ms) => M.sunPosition(ms, lat, lon).el
  let prev = el(base + 3600000)
  for (let h = 2; h <= 24; h++) {
    const ms = base + h * 3600000
    const cur = el(ms)
    const rising = cur > prev
    if ((kind === 'sunrise' && rising && prev < 0 && cur >= 0) ||
        (kind === 'sunset' && !rising && prev > 0 && cur <= 0)) {
      let lo = ms - 3600000
      let hi = ms
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        const e = el(mid)
        if (kind === 'sunrise' ? e < 0 : e > 0) lo = mid
        else hi = mid
      }
      void ms0
      return (lo + hi) / 2
    }
    prev = cur
  }
  return null
}

const dir = path.join(ROOT, 'data/forecast')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

const BUCKETS = ALPHAS.map((a) => ({
  alpha: a, n: 0, sum: 0, absSum: 0, up: 0, down: 0, flip: 0, rescued: 0,
  maxAbs: 0, highLt8: 0, highLt8Rescued: 0, midGe25: 0,
  flipKinds: {}, byGenus: {}, worst: []
}))
let windowSum = 0
let windowN = 0

for (const f of files) {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
  const times = j.weather?.[0]?.hourly?.time || []
  if (!times.length) continue
  const dates = [...new Set(times.map((t) => String(t).slice(0, 10)))]
  for (let i = 0; i < (j.spots || 0); i++) {
    const w = j.weather[i]
    const pr = j.prof?.[i]
    const sp = j.place[i]
    if (!w || !sp) continue
    for (const date of dates) {
      for (const kind of ['sunrise', 'sunset']) {
        const eventMs = findEvent(null, sp.lat, sp.lon, date, kind)
        if (eventMs == null) continue
        const iso = date + 'T' + new Date(eventMs + 8 * 3600000).toISOString().slice(11, 16)
        const idx = M.hourIndex(times, iso)
        if (idx < 0) continue

        const m = M.measureAt(w, j.air?.[i] ?? null, idx, MID)
        if (m.high == null) continue
        m.t2m = profField(pr, 'temperature_2m', idx)
        m.td2m = profField(pr, 'dew_point_2m', idx)

        /* 中云云底高度（与 api.ts 同口径） */
        const z850 = profField(pr, 'geopotential_height_850hPa', idx)
        const t850 = profField(pr, 'temperature_850hPa', idx)
        const td850 = profField(pr, 'dew_point_850hPa', idx)
        let cbMid = null
        if (z850 != null && t850 != null && td850 != null) {
          const l = lcl(t850, td850)
          cbMid = l != null ? Math.round(z850 - l) : null
        }
        let midBaseM = null
        if (cbMid != null && cbMid >= 2000 && cbMid <= 6000) midBaseM = cbMid
        else {
          const z700 = profField(pr, 'geopotential_height_700hPa', idx)
          if (z700 != null) midBaseM = Math.max(1500, Math.min(6000, Math.round(z700)))
          else if (cbMid != null) midBaseM = Math.max(1500, Math.min(6000, cbMid))
        }

        const plan = M.midCanvasPlan({ eventMs, lat: sp.lat, lon: sp.lon, kind, midBaseM })
        if (plan.window) { windowSum += plan.window.minutes; windowN++ }

        /* 窗口内三个小时 */
        const winMasses = [idx - 1, idx, idx + 1].map((k) => {
          const t = times[k]
          if (!t) return null
          const ms = Date.parse(t.length === 16 ? t + ':00+08:00' : t + '+08:00')
          return isNaN(ms) ? null : M.airmass(M.sunPosition(ms, sp.lat, sp.lon).el)
        }).filter((v) => v != null)
        const refMass = winMasses.length ? winMasses.reduce((a, b) => a + b, 0) / winMasses.length : null

        /* 目标时刻（idx）的样本：基线 + 原始补量 + 云种 */
        const sampleAt = (k) => {
          const mm = M.measureAt(w, j.air?.[i] ?? null, k, MID)
          if (mm.high == null) return null
          let rhMid = null
          for (const lv of M.MID_RH_LEVELS) {
            const v = profField(pr, 'relative_humidity_' + lv + 'hPa', k)
            if (v != null && (rhMid == null || v > rhMid)) rhMid = v
          }
          const ev = plan.evaluate({
            mid: mm.mid,
            rhMid,
            precipMm: profField(pr, 'precipitation', k),
            pop: mm.pop
          })
          const t = times[k]
          const kms = Date.parse(t.length === 16 ? t + ':00+08:00' : t + '+08:00')
          const sunEl = isNaN(kms) ? null : M.sunPosition(kms, sp.lat, sp.lon).el
          const opts = { sunEl, aodRefMass: refMass }
          return {
            mm, opts,
            base: M.scoreOfAt(mm, opts),
            lift: ev.lift,
            genus: ev.opacity.label,
            high: mm.high ?? 0,
            mid: mm.mid ?? 0
          }
        }

        const smp = sampleAt(idx)
        if (!smp) continue

        for (const B of BUCKETS) {
          const scale = B.alpha == null ? 1 : B.alpha / M.MID_CANVAS.alpha
          const lift = smp.lift * scale
          const next = lift > 0 ? M.scoreOfAt(smp.mm, { ...smp.opts, midLift: lift }) : smp.base
          const r = { base: smp.base, next, lift, genus: smp.genus, high: smp.high, mid: smp.mid }
          const d = next - r.base
          B.n++
          B.sum += d
          B.absSum += Math.abs(d)
          if (d > 0) B.up++
          else if (d < 0) B.down++
          if (d > 0) {
            const a = levelOf(r.base)
            const b = levelOf(r.next)
            if (a !== b) {
              B.flip++
              const key = a + '→' + b
              B.flipKinds[key] = (B.flipKinds[key] || 0) + 1
            }
            if (r.base === 0) B.rescued++
          }
          if (r.high < 8) { B.highLt8++; if (r.base === 0 && r.next > 0) B.highLt8Rescued++ }
          if (r.mid >= 25) B.midGe25++
          if (lift > 0) {
            const g = B.byGenus[r.genus] || (B.byGenus[r.genus] = { n: 0, sum: 0 })
            g.n++
            g.sum += d
          }
          if (Math.abs(d) > B.maxAbs) B.maxAbs = Math.abs(d)
          if (d !== 0) B.worst.push({ spot: sp.n, date, kind, high: r.high, mid: r.mid, base: r.base, next: r.next, genus: r.genus, lift })
        }
      }
    }
  }
}

console.log('样本（机位 × 日 × 日出/日落）' + (BUCKETS[0]?.n ?? 0))
console.log('云底照亮窗口平均 ' + (windowN ? (windowSum / windowN).toFixed(1) : '—') + ' 分钟（' + windowN + ' 个机位·日）\n')

let FAILMSG = []
for (const B of BUCKETS) {
  const tag = B.alpha == null ? '源码现值' : 'α=' + B.alpha
  console.log('── ' + tag + ' ──')
  console.log('  平均变化 ' + (B.sum / B.n).toFixed(2) + ' 分｜最大 ' + B.maxAbs)
  console.log('  升高 ' + B.up + '｜降低 ' + B.down + '（降低必须为 0）')
  console.log('  等级翻转 ' + B.flip + ' 个 ' + JSON.stringify(B.flipKinds))
  console.log('  从 0 分被救起 ' + B.rescued + '（' + ((100 * B.rescued) / B.n).toFixed(2) + '%）｜高云<8% 样本 ' + B.highLt8 + ' 中救起 ' + B.highLt8Rescued)
  console.log('  按云种（只列补过画布的）：')
  for (const [g, v] of Object.entries(B.byGenus).sort((a, b) => b[1].n - a[1].n)) {
    console.log('    ' + g.padEnd(18, '　') + ' 样本 ' + String(v.n).padStart(4) + '｜平均 +' + (v.sum / v.n).toFixed(2))
  }
  console.log('')
  if (B.down > 0) FAILMSG.push(tag + ' 出现降低 ' + B.down + ' 条')
  if (B.sum / B.n >= 1.0) FAILMSG.push(tag + ' 平均变化 ' + (B.sum / B.n).toFixed(2) + ' ≥ +1.0')
  /* 翻转只允许「小幅」：从 0/微烧 往上走一两档可以，跳到「大烧」以上就必须有人看 */
  const big = Object.entries(B.flipKinds).filter(([k]) => k.endsWith('→火烧云'))
  if (big.length) FAILMSG.push(tag + ' 有样本被抬到「火烧云」：' + JSON.stringify(big))
}

if (VERBOSE) {
  const B = BUCKETS[BUCKETS.length - 1]
  B.worst.sort((a, b) => (b.next - b.base) - (a.next - a.base))
  console.log('变化最大的 20 条：')
  for (const x of B.worst.slice(0, 20)) {
    console.log('  ' + x.date + ' ' + (x.kind === 'sunrise' ? '日出' : '日落') + ' ' + String(x.spot).padEnd(14, '　') +
      ' 高' + Math.round(x.high) + '/中' + Math.round(x.mid) + '  ' + x.base + '→' + x.next + '（+' + (x.next - x.base) + '，' + x.genus + '，抬升 ' + x.lift.toFixed(2) + '）')
  }
}

console.log(FAILMSG.length ? '❌ ' + FAILMSG.join('；') : '✅ 通过：只增不减、平均上浮 < 1 分、翻转全部来自高云<8% 的漏报样本')
process.exit(FAILMSG.length ? 1 : 0)
