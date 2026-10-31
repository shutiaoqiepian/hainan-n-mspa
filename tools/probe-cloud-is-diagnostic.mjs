/**
 * 核实：Open-Meteo 的压力层云量，是不是「由相对湿度算出来的诊断值」？
 *
 *   node tools/probe-cloud-is-diagnostic.mjs
 *
 * 做法：在大量（地点 × 时刻 × 气压层）样本上，把「相对湿度」和「云量」配对，
 * 看云量是不是 RH 的确定性函数。
 *
 * 判据：
 *   · 如果云量 = f(RH)（同一个 RH 永远对应同一个云量）→ 纯 RH 诊断，不是模式原生云场
 *   · 如果同一个 RH 对应一大片不同的云量 → 云量来自模式自己的云方案，独立于 RH
 *
 * 这个结论直接决定界面上要不要写「估算」。
 */

const LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 200]
/* 海南 + 周边，覆盖陆地和海洋 */
const POINTS = [
  [20.03, 110.28], [19.2, 110.4], [18.3, 109.4], [18.8, 108.7],
  [19.5, 109.7], [20.5, 109.9], [21.0, 110.3], [18.0, 109.5],
  [19.0, 111.0], [20.8, 108.5]
]
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPairs(model) {
  const lats = POINTS.map((p) => p[0]).join(',')
  const lons = POINTS.map((p) => p[1]).join(',')
  const hourly = LEVELS.flatMap((L) => [
    'cloud_cover_' + L + 'hPa',
    'relative_humidity_' + L + 'hPa'
  ]).join(',')
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons +
    '&hourly=' + hourly + '&models=' + model +
    '&forecast_days=2&timezone=Asia%2FShanghai'
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) })
  const j = await r.json()
  if (j.error) throw new Error(model + ': ' + j.reason)
  return Array.isArray(j) ? j : [j]
}

async function main() {
  const pairs = []
  for (const m of MODELS) {
    const res = await fetchPairs(m)
    console.log(m + '：' + res.length + ' 个格点返回')
    for (const pt of res) {
      const h = pt.hourly || {}
      const n = (h.time || []).length
      for (const L of LEVELS) {
        const cc = h['cloud_cover_' + L + 'hPa']
        const rh = h['relative_humidity_' + L + 'hPa']
        if (!cc || !rh) continue
        for (let i = 0; i < n; i++) {
          const a = cc[i], b = rh[i]
          if (a == null || b == null) continue
          pairs.push({ m, L, cc: a, rh: b })
        }
      }
    }
    await sleep(1200)
  }

  console.log('\n样本总数：' + pairs.length)

  /* 按 RH 分箱，看同一个 RH 桶里云量的离散程度 */
  const bins = new Map()
  for (const p of pairs) {
    const k = Math.round(p.rh / 2) * 2
    if (!bins.has(k)) bins.set(k, [])
    bins.get(k).push(p.cc)
  }

  const keys = [...bins.keys()].sort((a, b) => a - b)
  console.log('\nRH桶 | 样本 | 云量均值 | 云量最小~最大 | 极差')
  console.log('-----|------|---------|--------------|-----')
  let wide = 0
  for (const k of keys) {
    const v = bins.get(k)
    if (v.length < 20) continue
    const mn = Math.min(...v), mx = Math.max(...v)
    const avg = v.reduce((a, b) => a + b, 0) / v.length
    if (kx(k)) {
      console.log(
        String(k).padStart(4) + ' | ' + String(v.length).padStart(4) + ' | ' +
        avg.toFixed(0).padStart(7) + ' | ' + String(mn).padStart(3) + '~' + String(mx).padEnd(4) + ' | ' + (mx - mn)
      )
    }
    if (mx - mn > 25) wide++
  }

  /* 核心判据：同一个 RH 值上，云量的极差有多大 */
  const spread = keys.filter((k) => bins.get(k).length >= 20).map((k) => {
    const v = bins.get(k)
    return { rh: k, n: v.length, min: Math.min(...v), max: Math.max(...v) }
  })
  const avgRange = spread.length
    ? spread.reduce((a, b) => a + (b.max - b.min), 0) / spread.length
    : 0

  console.log('\n===== 判据 =====')
  console.log('同一 RH 桶内，云量的平均极差：' + avgRange.toFixed(1) + ' 个百分点')
  if (avgRange < 5) {
    console.log('结论：云量几乎完全由 RH 决定 → **纯 RH 诊断值**，必须标「估算」')
  } else if (avgRange < 20) {
    console.log('结论：RH 只解释一部分 → 有模式自身云方案，但 RH 影响很大')
  } else {
    console.log('结论：同一 RH 下云量差异很大 → 云量来自模式云方案，RH 不是唯一因子')
  }

  /* 再验一条：模式之间的差异。若三个模式用同一条曲线，更说明是共享的诊断公式 */
  const byModel = {}
  for (const p of pairs) {
    const k = Math.round(p.rh / 5) * 5
    byModel[p.m] = byModel[p.m] || {}
    byModel[p.m][k] = byModel[p.m][k] || []
    byModel[p.m][k].push(p.cc)
  }
  const commonHs = keys.map((k) => Math.round(k / 5) * 5).filter((v, i, a) => a.indexOf(v) === i)
  console.log('\nRH=80% 附近，三个模式各自的云量均值：')
  for (const m of MODELS) {
    const bucket = byModel[m]?.[80]
    if (bucket && bucket.length > 10) {
      console.log('  ' + m.padEnd(16) + (bucket.reduce((a, b) => a + b, 0) / bucket.length).toFixed(0) + '%（n=' + bucket.length + '）')
    }
  }
  void commonHs, wide
}

function kx(k) {
  return k % 10 === 0
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
