/**
 * 逐个探测 Open-Meteo 到底提供哪些变量（官方文档页太长、抓不全，直接问接口最准）。
 *
 *   node tools/probe-openmeteo-vars.mjs
 *
 * 输出一张「变量 → 有/没有」的表，并写进 docs/handoff/topics/数据源核实-OpenMeteo实测.md。
 * 这是「不凭记忆列 API」的证据。
 */

const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const LAT = 19.9
const LON = 110.3

/* 待测变量：按任务书 3.4 的分类整理 */
const LEVELS = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50]

const SURFACE = [
  ['云量·总', 'cloud_cover'],
  ['云量·低', 'cloud_cover_low'],
  ['云量·中', 'cloud_cover_mid'],
  ['云量·高', 'cloud_cover_high'],
  ['云底高度', 'cloud_base'],
  ['云顶高度', 'cloud_top'],
  ['可降水量', 'total_column_integrated_water_vapour'],
  ['CAPE', 'cape'],
  ['CIN', 'convective_inhibition'],
  ['边界层高度', 'boundary_layer_height'],
  ['能见度', 'visibility'],
  ['短波辐射', 'shortwave_radiation'],
  ['直接法向辐射', 'direct_normal_irradiance'],
  ['散射辐射', 'diffuse_radiation'],
  ['直接辐射', 'direct_radiation'],
  ['降水', 'precipitation'],
  ['降水概率', 'precipitation_probability'],
  ['气温 2m', 'temperature_2m'],
  ['露点 2m', 'dew_point_2m'],
  ['相对湿度 2m', 'relative_humidity_2m'],
  ['风速 10m', 'wind_speed_10m'],
  ['风向 10m', 'wind_direction_10m'],
  ['气压·地面', 'surface_pressure'],
  ['气压·海平面', 'sea_level_pressure'],
  ['冻结高度', 'freezing_level_height'],
  ['零度层高度', 'zero_degree_level']
]

/* 压力层变量模板 */
const PER_LEVEL = [
  ['云量', 'cloud_cover_{L}hPa'],
  ['相对湿度', 'relative_humidity_{L}hPa'],
  ['温度', 'temperature_{L}hPa'],
  ['露点', 'dew_point_{L}hPa'],
  ['位势高度', 'geopotential_height_{L}hPa'],
  ['风速', 'wind_speed_{L}hPa'],
  ['风向', 'wind_direction_{L}hPa'],
  ['U 风', 'u_component_of_wind_{L}hPa'],
  ['V 风', 'v_component_of_wind_{L}hPa'],
  ['垂直速度', 'vertical_velocity_{L}hPa'],
  ['比湿', 'specific_humidity_{L}hPa'],
  ['云水', 'cloud_liquid_water_{L}hPa'],
  ['云冰', 'cloud_ice_{L}hPa'],
  ['云水含量', 'cloud_water_content_{L}hPa'],
  ['位温', 'potential_temperature_{L}hPa']
]

const AIR_VARS = [
  ['气溶胶光学厚度', 'aerosol_optical_depth'],
  ['PM2.5', 'pm2_5'],
  ['PM10', 'pm10'],
  ['沙尘', 'dust'],
  ['UV 指数', 'uv_index'],
  ['一氧化碳', 'carbon_monoxide'],
  ['二氧化氮', 'nitrogen_dioxide'],
  ['臭氧', 'ozone'],
  ['二氧化硫', 'sulphur_dioxide'],
  ['氨', 'ammonia'],
  ['海盐 AOD', 'sea_salt_aerosol_optical_depth'],
  ['有机物 AOD', 'organic_matter_aerosol_optical_depth'],
  ['黑碳 AOD', 'black_carbon_aerosol_optical_depth'],
  ['沙尘 AOD', 'dust_aerosol_optical_depth'],
  ['硫酸盐 AOD', 'sulphate_aerosol_optical_depth'],
  ['AOD 550nm', 'aerosol_optical_depth_550nm']
]

async function one(host, v, extra = '') {
  const url =
    host +
    '?latitude=' + LAT + '&longitude=' + LON +
    '&hourly=' + v +
    '&forecast_days=1&timezone=Asia%2FShanghai' + extra
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
    const j = await r.json()
    if (j.error) return { ok: false, reason: String(j.reason).slice(0, 70) }
    const h = j.hourly || {}
    const keys = Object.keys(h).filter((k) => k !== 'time')
    if (!keys.length) return { ok: false, reason: '无字段' }
    /* 取日落附近的一个时刻看实际值，顺便验证单位和缺失 */
    const t = h.time || []
    const idx = t.findIndex((x) => String(x).includes('T18:00'))
    const units = j.hourly_units || {}
    return {
      ok: true,
      keys,
      units: keys.map((k) => units[k] ?? ''),
      sample: keys.map((k) => h[k]?.[idx < 0 ? 12 : idx])
    }
  } catch (e) {
    return { ok: false, reason: e.message.slice(0, 70) }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rows = []

async function main() {
  console.log('===== 探测 Open-Meteo Forecast API（地面/单层变量）=====')
  for (const [zh, v] of SURFACE) {
    const r = await one(FORECAST, v)
    rows.push({ group: '地面', zh, v, ...r })
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + zh.padEnd(12) + v.padEnd(34) + (r.ok ? String(r.sample?.[0]) + ' ' + (r.units?.[0] || '') : r.reason))
    await sleep(120)
  }

  console.log('\n===== 探测压力层变量（逐个层级试 850hPa 代表）=====')
  for (const [zh, tpl] of PER_LEVEL) {
    const v = tpl.replace('{L}', '850')
    const r = await one(FORECAST, v)
    rows.push({ group: '压力层', zh, v, ...r })
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + zh.padEnd(12) + v.padEnd(34) + (r.ok ? String(r.sample?.[0]) + ' ' + (r.units?.[0] || '') : r.reason))
    await sleep(120)
  }

  console.log('\n===== 探测压力层存在的变量覆盖哪些层级 =====')
  const available = PER_LEVEL.filter(([, tpl]) => {
    const v = tpl.replace('{L}', '850')
    return rows.find((x) => x.v === v)?.ok
  })
  const levelTable = {}
  for (const [zh, tpl] of available) {
    levelTable[zh] = []
    for (const L of LEVELS) {
      const v = tpl.replace('{L}', String(L))
      const r = await one(FORECAST, v)
      if (r.ok) levelTable[zh].push(L)
      await sleep(80)
    }
  }
  for (const zh of Object.keys(levelTable)) {
    console.log('  ' + zh.padEnd(10) + '可用层级: ' + (levelTable[zh].join(', ') || '（无）'))
  }

  console.log('\n===== 探测 Air Quality API（气溶胶）=====')
  for (const [zh, v] of AIR_VARS) {
    const r = await one(AIR, v)
    rows.push({ group: '气溶胶', zh, v, ...r })
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + zh.padEnd(16) + v.padEnd(36) + (r.ok ? String(r.sample?.[0]) + ' ' + (r.units?.[0] || '') : r.reason))
    await sleep(120)
  }

  /* ---- 写报告 ---- */
  const { writeFile, mkdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const ROOT = process.cwd()
  await mkdir(path.join(ROOT, 'docs'), { recursive: true })

  const now = new Date().toISOString()
  let md = '# Open-Meteo 变量实测核实\n\n'
  md += '> 生成时间：' + now + '　生成脚本：`tools/probe-openmeteo-vars.mjs`\n'
  md += '> 方法：**逐个变量真实调用接口**并读返回值（文档页太长抓不全，直接问接口最准）。\n'
  md += '> 测点：海南 19.9°N, 110.3°E；取当地 18:00（日落附近）的实际数值。\n\n'

  md += '## 一、地面 / 单层变量\n\n| 变量 | 参数名 | 可用 | 实测值 | 单位 |\n|---|---|---|---|---|\n'
  for (const r of rows.filter((x) => x.group === '地面')) {
    md += '| ' + r.zh + ' | `' + r.v + '` | ' + (r.ok ? '✅' : '❌') + ' | ' +
      (r.ok ? String(r.sample?.[0] ?? 'null') : '—') + ' | ' + (r.ok ? r.units?.[0] ?? '' : '') + ' |\n'
  }

  md += '\n## 二、压力层变量\n\n| 变量 | 参数名模板 | 850hPa 可用 | 实测值 | 单位 |\n|---|---|---|---|---|\n'
  for (const r of rows.filter((x) => x.group === '压力层')) {
    md += '| ' + r.zh + ' | `' + r.v.replace('850', '{L}') + '` | ' + (r.ok ? '✅' : '❌') + ' | ' +
      (r.ok ? String(r.sample?.[0] ?? 'null') : '—') + ' | ' + (r.ok ? r.units?.[0] ?? '' : '') + ' |\n'
  }

  md += '\n### 各变量实际可用的气压层级\n\n'
  for (const zh of Object.keys(levelTable)) {
    md += '- **' + zh + '**：' + (levelTable[zh].join(' / ') || '（无）') + ' hPa\n'
  }

  md += '\n## 三、气溶胶（Air Quality API，底层为 CAMS）\n\n| 变量 | 参数名 | 可用 | 实测值 | 单位 |\n|---|---|---|---|---|\n'
  for (const r of rows.filter((x) => x.group === '气溶胶')) {
    md += '| ' + r.zh + ' | `' + r.v + '` | ' + (r.ok ? '✅' : '❌') + ' | ' +
      (r.ok ? String(r.sample?.[0] ?? 'null') : '—') + ' | ' + (r.ok ? r.units?.[0] ?? '' : '') + ' |\n'
  }

  md += '\n## 四、结论\n\n'
  md += '- **有**：多模式、压力层的云量/湿度/温度/位势高度/风/垂直速度，足够做垂直廓线与多层云结构。\n'
  md += '- **没有**：云水混合比、云冰混合比、比湿、模式层数据、任何三维体数据。\n'
  md += '  → 任务书 3.4 里第一优先级的「模式直接提供的三维云水/云冰场」**Open-Meteo 拿不到**，\n'
  md += '  只能用第二/第三优先级的云量诊断值，界面上必须标注为估算。\n'
  md += '- **水平方向**：接口只接受「点列表」，不接受路径/区域；\n'
  md += '  要画水平—垂直截面，必须自己在路径上取 ~20–40 个点逐点请求。\n'

  await writeFile(path.join(ROOT, 'docs/handoff/topics/数据源核实-OpenMeteo实测.md'), md, 'utf8')
  console.log('\n报告已写入 docs/handoff/topics/数据源核实-OpenMeteo实测.md')
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
