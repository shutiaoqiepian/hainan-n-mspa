/**
 * 海表温度（SST）—— 雾判据里唯一需要外部数据源的一项。
 * ============================================================
 *
 * 为什么单独一个模块：站点其它所有气象数据都来自 Open-Meteo 的 forecast
 * 接口（`data/forecast/*.json` 缓存），只有海温要调 Open-Meteo 的
 * **Marine 接口**（`marine-api.open-meteo.com`），是另一套响应结构、
 * 另一套失败模式，混进 api.ts 会把它撑得更难维护。
 *
 * ★ 2026-11-05 实测结论（这就是整件事的前提）
 *   · Marine 接口**免费、不要 API key**，返回逐小时 `sea_surface_temperature`。
 *   · 但**只有海面上的点有值**：内陆、山区、北京这种点返回 24 个 null。
 *     实测海口近海 28.6 °C、琼州海峡 28.5 °C、文昌 28.7 °C；
 *     海口内陆（桂林洋）、五指山、北京全部 null。
 *   · 所以：**沿海机位能算平流雾的热力判据，内陆机位不能**。
 *     这不影响结论 —— 平流雾本来就只发生在有水面的地方，
 *     内陆该看的是辐射雾，不该套平流雾的判据。
 *
 * ★ 缺测的处理原则（铁律 2）
 *   拿不到就返回 null，界面上标「未评估」，**绝不能当成 0 或「不满足」**。
 *   把「不知道」显示成「没有」是本项目反复踩过的坑（见交接文档 §30）。
 */

/** 一次请求要多少天。2 天足够覆盖「今天 + 明天」两个预报日 */
const FORECAST_DAYS = 2

/** 按 0.05° 取整做缓存键：同一个格里的机位只请求一次 */
function keyOf(lat: number, lon: number): string {
  const la = (Math.round(lat / 0.05) * 0.05).toFixed(3)
  const lo = (Math.round(lon / 0.05) * 0.05).toFixed(3)
  return `${la},${lo}`
}

export interface SstResult {
  /** 平均海温（°C）；null = 该点没有海温数据（内陆或请求失败） */
  sst: number | null
  /** 逐小时海温，长度与实际返回一致；用于按小时对齐，取不到时为空数组 */
  hourly: Array<number | null>
  /** 时间轴（ISO，本地时区），与 hourly 同序 */
  times: string[]
  /** 是否请求过并且成功拿到 HTTP 200 */
  fetched: boolean
}

const cache = new Map<string, Promise<SstResult>>()
const EMPTY: SstResult = { sst: null, hourly: [], times: [], fetched: false }

async function fetchSst(lat: number, lon: number): Promise<SstResult> {
  const url =
    'https://marine-api.open-meteo.com/v1/marine' +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=sea_surface_temperature&forecast_days=${FORECAST_DAYS}` +
    '&timezone=Asia%2FShanghai'

  try {
    /* 8 秒超时：雾卡片是锦上添花，不能因为它卡住整页 */
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return EMPTY
    const j = (await res.json()) as {
      hourly?: {
        time?: string[]
        sea_surface_temperature?: Array<number | null>
      }
    }
    const hourly = j.hourly?.sea_surface_temperature
    const times = j.hourly?.time
    if (!Array.isArray(hourly) || !hourly.length) return EMPTY
    const valid = hourly.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    return {
      /* 平均到 0.1 °C：海温在一天内变化通常不到 1 °C，取平均足够 */
      sst: valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null,
      hourly,
      times: Array.isArray(times) ? times : [],
      fetched: true
    }
  } catch {
    /* 离线 / 超时 / 被墙：一律当作「没有数据」，不抛错、不阻塞 */
    return EMPTY
  }
}

/**
 * 取某个坐标的海温。带模块级缓存，同一位置只请求一次。
 * 失败时返回 `sst: null`，调用方必须按「未评估」处理。
 */
export function loadSst(lat: number, lon: number): Promise<SstResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(EMPTY)
  const k = keyOf(lat, lon)
  const hit = cache.get(k)
  if (hit) return hit
  const p = fetchSst(lat, lon)
  cache.set(k, p)
  return p
}

/** 把逐小时海温按「本地小时」对齐到某个时刻（找不到就近取前一个） */
export function sstAt(result: SstResult, isoLocal: string): number | null {
  if (!result.times.length) return null
  const i = result.times.indexOf(isoLocal.slice(0, 16))
  if (i >= 0) return result.hourly[i] ?? null
  return result.sst
}
