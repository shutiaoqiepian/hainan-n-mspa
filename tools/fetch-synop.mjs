/**
 * 抓中国地面站 SYNOP 报文（Ogimet）并解析云况。
 * ------------------------------------------------------------
 * 为什么要有：METAR 只有机场（全国 224 个），离市区机位常常 20–40 km。
 * 地面站（SYNOP）更密、也是免费公开的，理论上是更好的「实况基准」。
 *
 * 但实测结论（2026-10-24，40 站 × 2 时次 = 66 份报文）：
 *   **中国地面站的 SYNOP 报文基本不报云况。**
 *
 *   · 66 份里只有 2 份带云组（覆盖率 3%）
 *   · 唯一报云组的是文昌 59792，云组 82100 = Nh=2 CL=1 CM=0 CH=0
 *   · 「8NhCLCMCH」里的 Nh 是**低云量**，不是总云量；
 *     而火烧云算法最缺的正是中云、高云量 —— 这两项根本不在报文里
 *   · 另外 6 个站（58562 / 59280 / 59647 / 56294 / 52889 / 57036）连报文都取不到
 *
 * 所以 SYNOP 这条路在当前数据下是**死的**，不要当数据源用。
 * 这个脚本现在的用途是「持续监测」而不是「当数据源」：
 *   每跑一次把覆盖率写进 data/obs/synop-coverage.json，
 *   哪天中国开始正经报云组了，输出会变，届时再接进 check-accuracy。
 *
 * 用法：
 *   node tools/fetch-synop.mjs                 # 采样 40 站 × 最近 1 个时次
 *   node tools/fetch-synop.mjs --times 4       # 每个站取 4 个时次
 *   node tools/fetch-synop.mjs --stations 59792,59758
 *
 * 注意 Ogimet 有速率限制（实测连续请求约 60 次后返回 HTTP 429），
 * 所以每次请求之间默认间隔 2 秒，失败重试 3 次。
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'data', 'obs')
const OUT = path.join(OUT_DIR, 'synop-coverage.json')
const HOST = 'https://meteo.ogimet.com/cgi-bin/getsynop'

/** 覆盖东中西南的 40 个 WMO 站点号 */
const BLOCKS = [
  '54511', '54527', '54342', '53614', '53772', '53845', '54857', '54423',
  '58362', '58238', '58457', '58606', '58562', '58847', '59316', '59134',
  '59287', '59493', '59211', '57957', '59023', '59280', '59647', '59758',
  '59981', '59792', '59838', '57494', '57131', '57516', '56294', '56778',
  '54161', '54157', '50953', '51463', '52889', '52818', '57083', '57036'
]

const args = process.argv.slice(2)
function argOf(name, def) {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const TIMES = Number(argOf('times', '1'))
const ONLY = argOf('stations', '')
const GAP_MS = 3000

/** 把 Date 转成 Ogimet 要的 YYYYMMDDHHmm（UTC，整点就是 hh + '00'）。
 *  ⚠ 必须给到分钟（12 位）：只给到小时（10 位）时 Ogimet 返回 HTTP 500，
 *  而且不带任何错误信息，非常容易被误判成「这个站没报」。 */
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + '00'
  )
}

/** 云组 8NhCLCMCH：Nh 是低云量（octa），CL/CM/CH 是 低/中/高云属编码 */
function parseCloudGroup(g) {
  if (!/^8[0-9/]{4}$/.test(g)) return null
  const digit = (ch) => (ch === '/' ? null : Number(ch))
  const nh = digit(g[1])
  return {
    raw: g,
    nhOcta: nh,
    nhPercent: nh == null ? null : Math.round((nh / 8) * 100),
    cl: digit(g[2]),
    cm: digit(g[3]),
    ch: digit(g[4]),
    /* 只有「云属编码」不为 0/缺，才算真的报了云 */
    hasGenus: [g[2], g[3], g[4]].some((c) => c !== '/' && c !== '0')
  }
}

function parseReport(raw) {
  const body = raw.includes('333') ? raw.slice(0, raw.indexOf('333')) : raw
  const tok = body.split(/\s+/).filter(Boolean)
  const cloudTok = tok.find((x) => /^8[0-9/]{4}$/.test(x))
  return { cloud: cloudTok ? parseCloudGroup(cloudTok) : null, raw: body }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 找一个「确实有报文」的时次。
 * Ogimet 对没有报文的时次返回 200+空 或 500，两种都表示「这个点没报」，
 * 而中国站是每 3 小时（00/03/06/09/12/15/18/21 UTC）报一次，
 * 所以从当前整点往前每 3 小时试，最多试 8 次（约一天）。
 */
async function findLiveSlot(probeStation) {
  /* 中国地面站固定报 00/03/06/09/12/15/18/21 UTC，所以先对齐到这张网格，
     不能从「当前时刻减 3 小时的整数倍」算 —— 那样会落到 20、17、14 点这些没报的时次上。 */
  const now = new Date()
  now.setUTCMinutes(0, 0, 0)
  now.setUTCHours(Math.floor(now.getUTCHours() / 3) * 3)
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getTime() - i * 3 * 3600 * 1000)
    const tm = stamp(d)
    const url = HOST + '?begin=' + tm + '&end=' + tm + '&block=' + probeStation
    const { status, text } = await get(url)
    await sleep(GAP_MS)
    if (status === 200 && text) return { slot: tm, ms: d.getTime() }
    console.log('  试探 ' + tm + ' → 无报文（status ' + status + '）')
    /* 429 说明被限流，别再试了，直接退出等会儿再跑 */
    if (status === 429) {
      console.error('被 Ogimet 限流（HTTP 429），等 10 分钟后再跑')
      process.exit(2)
    }
  }
  return null
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) })
      if (r.status === 429) {
        /* 被限流：退避后重试 */
        console.warn('  HTTP 429，等待 ' + (6 + i * 6) + 's 后重试')
        await sleep((6 + i * 6) * 1000)
        continue
      }
      if (!r.ok) return { status: r.status, text: '' }   /* 500 = 该时次无报文，不是错误 */
      return { status: r.status, text: (await r.text()).trim() }
    } catch (e) {
      if (i === tries - 1) return { status: 0, text: '', error: e.name }
      await sleep(3000)
    }
  }
  return { status: 429, text: '' }
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  const stations = ONLY
    ? ONLY.split(',').map((s) => s.trim()).filter(Boolean)
    : BLOCKS

  /* 先找到一个真有报文的时次，再按 3 小时间隔往回取 */
  const probe = stations[0]
  console.log('探测最近有效时次（用 ' + probe + ' 试）…')
  const live = await findLiveSlot(probe)
  if (!live) {
    console.error('一整天都没有任何报文，可能是被限流，稍后再跑')
    process.exit(2)
  }
  console.log('有效时次：' + live.slot + ' UTC')
  const slots = []
  for (let i = 0; i < TIMES; i++) {
    slots.push(stamp(new Date(live.ms - i * 3 * 3600 * 1000)))
  }

  const perStation = []
  let reports = 0
  let withCloud = 0
  let withGenus = 0

  for (const id of stations) {
    const rec = { id, reports: 0, withCloud: 0, samples: [] }
    for (const tm of slots) {
      const url = HOST + '?begin=' + tm + '&end=' + tm + '&block=' + id
      const { status, text } = await get(url)
      if (status !== 200 || !text) {
        rec.samples.push({ time: tm, status, note: text ? '' : '空' })
        await sleep(GAP_MS)
        continue
      }
      for (const line of text.split('\n')) {
        const raw = line.split(',').slice(6).join(',')
        if (!raw) continue
        const { cloud } = parseReport(raw)
        rec.reports++
        reports++
        if (cloud) {
          rec.withCloud++
          withCloud++
          if (cloud.hasGenus) withGenus++
          rec.samples.push({ time: tm, cloud: cloud.raw, nh: cloud.nhPercent, cl: cloud.cl, cm: cloud.cm, ch: cloud.ch })
        } else {
          rec.samples.push({ time: tm, cloud: null })
        }
      }
      await sleep(GAP_MS)
    }
    perStation.push(rec)
    const mark = rec.withCloud ? ' ✔ 报云组 ' + rec.withCloud + ' 次' : ''
    console.log(id.padEnd(6), rec.reports + ' 份报文' + mark)
  }

  const coverage = reports ? Math.round((withCloud / reports) * 1000) / 10 : 0
  const payload = {
    checkedAt: new Date().toISOString(),
    source: 'Ogimet SYNOP (meteo.ogimet.com)',
    stations: stations.length,
    slots: TIMES,
    reports,
    withCloud,
    withGenus,
    coveragePercent: coverage,
    conclusion:
      coverage < 20
        ? '中国地面站 SYNOP 基本不报云组（8NhCLCMCH），无法作为云况实况基准'
        : 'SYNOP 云组覆盖率可用，可以考虑接进 check-accuracy',
    perStation
  }

  await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')

  console.log('')
  console.log('采样 ' + stations.length + ' 站 × ' + TIMES + ' 时次')
  console.log('有效报文 ' + reports + ' 份，其中带云组 ' + withCloud + ' 份（' + coverage + '%），带云属编码 ' + withGenus + ' 份')
  console.log('结论：' + payload.conclusion)
  console.log('写到 data/obs/synop-coverage.json')
}

main().catch((e) => {
  console.error('失败：', e)
  process.exit(1)
})
