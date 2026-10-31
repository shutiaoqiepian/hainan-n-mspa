/**
 * Open-Meteo 数据适配器（V1「估算云」剖面）。
 *
 * 为什么要有它：
 *   GFS 给的是模式原生云水/云冰（三源里只有它给），但需要一个「随手能跑、
 *   不依赖 CI 缓存」的原型数据源来对照。Open-Meteo 一次请求就能拿到
 *   多个坐标点的气压层温度/湿度/位势高度/云量/风/垂直速度。
 *
 * 必须诚实的三件事（页面上也会写）：
 *   1. `cloud_cover_{L}hPa` 是**由相对湿度诊断出来的**，不是模式原生云水云冰；
 *      本项目实测：RH<40% 时恒为 0，ECMWF/GFS/ICON 在 RH=80% 处分别只有 4%/1%/4%。
 *   2. 无法区分云水与云冰，所以这里 clw/ici 一律为 null（不是 0）。
 *   3. 风要 km/h → m/s；垂直速度 Open-Meteo 是 m/s，这里用 ω = −ρg·w 换算成 Pa/s，
 *      两套单位都保留在 qualityFlags / units 里，绝不静默混用。
 */
import type { XsecField, XsecGridNode, XsecLevelRow, XsecSample, XsecSpotFile, XsecSpotMeta } from './types'

const API = 'https://api.open-meteo.com/v1/forecast'
const R_DRY = 287.05
const G0 = 9.80665

/** 与 GFS 剖面保持同一套字段顺序 */
export const XSEC_FIELDS: XsecField[] = [
  'hgtM', 'tC', 'rhPct', 'clwMgKg', 'iciMgKg', 'uMs', 'vMs', 'wPaS', 'cfPct', 'belowGround'
]

/** 大圆终点（与 tools/xsec/build_cross.py 同一公式） */
export function destination(lat: number, lon: number, azDeg: number, distKm: number): [number, number] {
  const R = 6371.0088
  const d = distKm / R
  const az = (azDeg * Math.PI) / 180
  const la1 = (lat * Math.PI) / 180
  const lo1 = (lon * Math.PI) / 180
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(az))
  const lo2 = lo1 + Math.atan2(
    Math.sin(az) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2)
  )
  const lonOut = (((lo2 * 180) / Math.PI + 540) % 360) - 180
  return [(la2 * 180) / Math.PI, lonOut]
}

function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** 路径附近 ±30 km 的 0.25° 网格结点（IFS 0.25 的格点落在 .00/.25/.50/.75 上） */
function gridNodes(lat: number, lon: number, az: number, lengthKm: number): XsecGridNode[] {
  const out: XsecGridNode[] = []
  const latMin = Math.floor((lat - 0.6) * 4) / 4
  const latMax = Math.ceil((lat + 0.6) * 4) / 4
  const lonMin = Math.floor((lon - 0.8) * 4) / 4
  const lonMax = Math.ceil((lon + 0.8) * 4) / 4
  for (let la = latMin; la <= latMax + 1e-9; la += 0.25) {
    for (let lo = lonMin; lo <= lonMax + 1e-9; lo += 0.25) {
      const d = greatCircleKm(lat, lon, la, lo)
      if (d > lengthKm + 12) continue
      const bearing = (Math.atan2(
        Math.sin(((lo - lon) * Math.PI) / 180) * Math.cos((la * Math.PI) / 180),
        Math.cos((lat * Math.PI) / 180) * Math.sin((la * Math.PI) / 180) -
          Math.sin((lat * Math.PI) / 180) * Math.cos((la * Math.PI) / 180) *
          Math.cos(((lo - lon) * Math.PI) / 180)
      ) * 180) / Math.PI
      const daz = Math.abs(((bearing - az + 540) % 360) - 180)
      const perp = d * Math.sin((daz * Math.PI) / 180)
      const along = d * Math.cos((daz * Math.PI) / 180)
      if (Math.abs(perp) <= 30 && along >= 0 && along <= lengthKm) {
        out.push([Math.round(along * 100) / 100, Math.round(la * 1000) / 1000, Math.round(lo * 1000) / 1000])
      }
    }
  }
  out.sort((a, b) => a[0] - b[0])
  return out
}

interface OmHourly {
  time: string[]
  [k: string]: Array<number | null> | string[]
}

interface OmPoint {
  latitude: number
  longitude: number
  elevation: number
  hourly: OmHourly
}

export interface OpenMeteoOptions {
  levelsHpa: number[]
  sampleKm: number[]
  az: number
  validIso: string
  model?: string
}

function buildVars(levels: number[]): string[] {
  const vars: string[] = []
  for (const lv of levels) {
    vars.push(
      `temperature_${lv}hPa`,
      `relative_humidity_${lv}hPa`,
      `geopotential_height_${lv}hPa`,
      `cloud_cover_${lv}hPa`,
      `wind_speed_${lv}hPa`,
      `wind_direction_${lv}hPa`,
      `vertical_velocity_${lv}hPa`
    )
  }
  return vars
}

/**
 * 拉取一条剖面（5 个水平点 × N 个气压层），返回与 GFS 缓存同构的对象，
 * 这样图表组件完全不用改。
 */
export async function fetchOpenMeteoSection(
  spot: XsecSpotMeta,
  opts: OpenMeteoOptions
): Promise<XsecSpotFile> {
  const { levelsHpa, sampleKm, az, validIso } = opts
  const model = opts.model ?? 'ecmwf_ifs025'
  const points = sampleKm.map((d, i) =>
    i === 0 ? [spot.lat, spot.lon] as [number, number] : destination(spot.lat, spot.lon, az, d)
  )
  const lats = points.map((p) => p[0].toFixed(4)).join(',')
  const lons = points.map((p) => p[1].toFixed(4)).join(',')
  const params = new URLSearchParams({
    latitude: lats,
    longitude: lons,
    hourly: buildVars(levelsHpa).join(','),
    models: model,
    timezone: 'UTC',
    forecast_days: '3'
  })
  const url = `${API}?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo 请求失败 HTTP ${res.status}`)
  const raw = (await res.json()) as OmPoint[] | OmPoint
  const list: OmPoint[] = Array.isArray(raw) ? raw : [raw]
  if (list.length !== points.length) {
    throw new Error(`Open-Meteo 返回 ${list.length} 个点，期望 ${points.length} 个`)
  }

  /* 目标时刻：Open-Meteo 给的是整点，取同一小时 */
  const wantHour = validIso.slice(0, 13)
  const hIdx = list[0].hourly.time.findIndex((t) => t.slice(0, 13) === wantHour)
  if (hIdx < 0) throw new Error(`Open-Meteo 没有 ${wantHour}:00 这一时刻的数据`)

  const samples: XsecSample[] = list.map((pt, si) => {
    const terrain = pt.elevation
    const levels: XsecLevelRow[] = levelsHpa.map((lv) => {
      const pick = (k: string): number | null => {
        const arr = pt.hourly[k]
        if (!Array.isArray(arr)) return null
        const v = arr[hIdx]
        return typeof v === 'number' && Number.isFinite(v) ? v : null
      }
      const hgt = pick(`geopotential_height_${lv}hPa`)
      const tC = pick(`temperature_${lv}hPa`)
      const rh = pick(`relative_humidity_${lv}hPa`)
      const cf = pick(`cloud_cover_${lv}hPa`)
      const spdKmh = pick(`wind_speed_${lv}hPa`)
      const dir = pick(`wind_direction_${lv}hPa`)
      const wMs = pick(`vertical_velocity_${lv}hPa`)

      /* 风：Open-Meteo 给的是「风从哪个方向吹来」的方位角 + km/h。
         注意：Open-Meteo 的 wind_direction 是气象约定（风的来向）。 */
      let u: number | null = null
      let v: number | null = null
      if (spdKmh !== null && dir !== null) {
        const spdMs = spdKmh / 3.6
        const rad = (dir * Math.PI) / 180
        u = -spdMs * Math.sin(rad)
        v = -spdMs * Math.cos(rad)
      }

      /* 垂直速度：m/s → Pa/s（ω = −ρg·w，ρ = p/(R·T)）。
         保留换算依据，不静默改单位。 */
      let wPaS: number | null = null
      if (wMs !== null && tC !== null) {
        const rho = (lv * 100) / (R_DRY * (tC + 273.15))
        wPaS = Math.round(-rho * G0 * wMs * 100) / 100
      }

      const below = hgt !== null && hgt <= terrain + 5
      return [
        hgt === null ? null : Math.round(hgt),
        tC,
        rh === null ? null : Math.round(rh),
        // Open-Meteo 没有云水/云冰：必须是 null，不能写 0
        null,
        null,
        u === null ? null : Math.round(u * 10) / 10,
        v === null ? null : Math.round(v * 10) / 10,
        wPaS,
        cf === null ? null : Math.round(cf),
        below ? 1 : 0
      ]
    })
    return {
      d: sampleKm[si],
      lat: Math.round(pt.latitude * 10000) / 10000,
      lon: Math.round(pt.longitude * 10000) / 10000,
      terrainM: Math.round(terrain),
      levels
    }
  })

  const stageMeta: XsecSpotMeta = {
    ...spot,
    terrainM: samples[0]?.terrainM ?? 0
  }

  return {
    version: 1,
    source: 'open-meteo',
    model: `Open-Meteo · ${model}（气压层）`,
    cycle: validIso,
    generatedAt: new Date().toISOString(),
    domain: { latMin: spot.lat - 0.6, latMax: spot.lat + 0.6, lonMin: spot.lon - 0.8, lonMax: spot.lon + 0.8 },
    gridKm: 27.8,
    lengthKm: sampleKm[sampleKm.length - 1],
    sampleIntervalKm: sampleKm[1] - sampleKm[0],
    levelsHpa,
    levelFields: XSEC_FIELDS,
    azimuths: [az],
    times: [{ t: 0, utc: validIso, leadHours: 0 }],
    spot: stageMeta,
    sections: [
      {
        az,
        t: 0,
        leadHours: 0,
        gridNodes: gridNodes(spot.lat, spot.lon, az, sampleKm[sampleKm.length - 1]),
        samples
      }
    ]
  }
}
