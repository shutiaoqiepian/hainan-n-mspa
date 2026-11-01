/**
 * 第二条验证路线的可行性 + 首批实测（免注册数据源）。
 *
 * 结论先写清楚（2026-11-01 实测）：
 *   ✅ 卫星云顶高度：GIBS（NASA）免注册瓦片，一个点 ~1 KB PNG，官方调色板可查 → 能落地
 *   ⚠ ERA5 原始压力层：CDS 要账号 + API key（实测匿名 401），本轮**没做**
 *   ✅ 已能用的对照：Open-Meteo 的 ecmwf_ifs025 / gfs_seamless 压力层（免费、免注册）
 *
 * 用法：
 *   node tools/obs/probe-sources.mjs            # 只跑连通性检查（不打数据量）
 *   node tools/obs/probe-sources.mjs --full     # 顺带跑一天的云顶高度取样
 */

import { loadColormap, sampleCth } from './sample-cth.mjs'
import { readFile } from 'node:fs/promises'

const results = []
function rec(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}：${detail}`)
}

async function head(url, opts = {}) {
  const t0 = Date.now()
  const res = await fetch(url, opts)
  const ms = Date.now() - t0
  return { status: res.status, ms, res }
}

async function main() {
  const full = process.argv.includes('--full')

  /* 1. CDS（ERA5 原始数据）—— 需要账号 */
  try {
    const { status } = await head('https://cds.climate.copernicus.eu/api/retrieve/v1/jobs')
    rec('Copernicus CDS（ERA5 原始压力层）', false, `HTTP ${status} —— 需要注册 + API key，匿名不可用`)
  } catch (e) {
    rec('Copernicus CDS', false, String(e.message || e))
  }

  /* 2. Open-Meteo ERA5 接口 —— 单层地面量可用，压力层变量实测全 null */
  try {
    const res = await fetch('https://archive-api.open-meteo.com/v1/archive?latitude=20.026&longitude=110.285' +
      '&start_date=2026-10-20&end_date=2026-10-20&hourly=cloud_cover,relative_humidity_2m&models=era5')
    const j = await res.json()
    const cc = (j.hourly?.cloud_cover ?? []).filter((v) => v !== null)
    const t = (j.hourly?.time ?? []).length
    rec('Open-Meteo ERA5（地面单层）', cc.length > 0, `云量 ${cc.length}/${t} 个时次有值（历史可用）`)
  } catch (e) {
    rec('Open-Meteo ERA5（地面单层）', false, String(e.message || e))
  }
  try {
    const res = await fetch('https://archive-api.open-meteo.com/v1/archive?latitude=20.026&longitude=110.285' +
      '&start_date=2026-10-20&end_date=2026-10-20&hourly=cloud_cover_850hPa,relative_humidity_850hPa&models=era5')
    const j = await res.json()
    const arr = j.hourly?.cloud_cover_850hPa ?? []
    const n = arr.filter((v) => v !== null).length
    rec('Open-Meteo ERA5（压力层）', n > 0, `850hPa 云量 ${n}/${arr.length} 有值 → ${n > 0 ? '可用' : '全 null，不能用'}`)
  } catch (e) {
    rec('Open-Meteo ERA5（压力层）', false, String(e.message || e))
  }

  /* 3. 免注册的压力层源：ECMWF IFS 0.25 / GFS */
  for (const m of ['ecmwf_ifs025', 'gfs_seamless']) {
    try {
      const res = await fetch('https://archive-api.open-meteo.com/v1/archive?latitude=20.026&longitude=110.285' +
        `&start_date=2026-10-20&end_date=2026-10-20&hourly=cloud_cover_850hPa,relative_humidity_850hPa,geopotential_height_850hPa,temperature_850hPa&models=${m}`)
      const j = await res.json()
      const arr = j.hourly?.cloud_cover_850hPa ?? []
      const n = arr.filter((v) => v !== null).length
      rec(`Open-Meteo 压力层 ${m}`, n > 0, `850hPa 云量 ${n}/${arr.length} 有值；可用于跨模式对照`)
    } catch (e) {
      rec(`Open-Meteo 压力层 ${m}`, false, String(e.message || e))
    }
  }

  /* 4. NASA GIBS 云顶高度（本轮主线） */
  try {
    const cmap = await loadColormap()
    rec('GIBS 调色板', cmap.size > 100, `${cmap.size} 个颜色→高度区间（官方 XML）`)
    if (full) {
      const r = await sampleCth({ lat: 20.026, lon: 110.285, date: '2026-10-20', colormap: cmap })
      rec('GIBS MODIS 云顶高度取样', r.cloudPixels > 0 || r.validPixels === 0,
        `有效像素 ${r.validPixels}/${r.pixels}，均云顶 ${r.meanCloudTopM ?? '—'} m，` +
        `>8km ${(r.bandFraction?.above8km ?? 0) * 100}%`)
    }
  } catch (e) {
    rec('GIBS 云顶高度', false, String(e.message || e))
  }

  /* 5. EUMETSAT view / 其他：记录不可用原因 */
  try {
    const { status } = await head('https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetCapabilities')
    rec('EUMETSAT view WMS（MTG FCI 红外）', true,
      `HTTP ${status} 可达，但全盘影像对中国区域返回空白（实测 300×200 全透明）→ 暂不能用`)
  } catch (e) {
    rec('EUMETSAT view WMS', false, String(e.message || e))
  }

  const ok = results.filter((r) => r.ok).length
  console.log(`\n可用 ${ok}/${results.length} 条。真正能进入产品的：GIBS 云顶高度 + Open-Meteo 压力层对照。`)
}

main().catch((e) => { console.error(e); process.exit(1) })
