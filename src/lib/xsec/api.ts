/**
 * 剖面数据读取：只读 CI 生成的静态 JSON，不做任何气象计算。
 *
 * 缓存策略：索引常驻内存；机位文件按需拉取并缓存（8 个机位一共约 340 KB，
 * 一页只看一个机位，没必要全下）。
 */
import type { XsecContext, XsecIndex, XsecNationalIndex, XsecSpotFile } from './types'

const BASE = 'data/cross'

let indexPromise: Promise<XsecIndex> | null = null
let contextPromise: Promise<XsecContext> | null = null
let nationalPromise: Promise<XsecNationalIndex> | null = null
const spotCache = new Map<string, Promise<XsecSpotFile>>()

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'default' })
  } catch (e) {
    throw new Error(`网络请求失败：${url}`)
  }
  if (!res.ok) throw new Error(`读取失败 ${url} → HTTP ${res.status}`)
  try {
    return (await res.json()) as T
  } catch (e) {
    throw new Error(`返回的不是有效 JSON：${url}`)
  }
}

export function loadXsecIndex(): Promise<XsecIndex> {
  if (!indexPromise) {
    indexPromise = fetchJson<XsecIndex>(`${BASE}/index.json`).catch((e) => {
      indexPromise = null
      throw e
    })
  }
  return indexPromise
}

export function loadXsecSpot(file: string): Promise<XsecSpotFile> {
  let p = spotCache.get(file)
  if (!p) {
    p = fetchJson<XsecSpotFile>(`${BASE}/${file}`).catch((e) => {
      spotCache.delete(file)
      throw e
    })
    spotCache.set(file, p)
  }
  return p
}

/**
 * 全国 224 机位索引（与海南 8 机位索引分开：两者的时次/方位策略不同）。
 * 缺失时页面继续用海南试点，不影响任何现有功能。
 */
export function loadNationalIndex(): Promise<XsecNationalIndex> {
  if (!nationalPromise) {
    nationalPromise = fetchJson<XsecNationalIndex>(`${BASE}/national-index.json`).catch((e) => {
      nationalPromise = null
      throw e
    })
  }
  return nationalPromise
}

/** 环境上下文（DEM 地形 + AOD）。缺失时页面降级为「地形=AOD=缺测」，不影响云场。 */
export function loadXsecContext(): Promise<XsecContext> {
  if (!contextPromise) {
    contextPromise = fetchJson<XsecContext>(`${BASE}/context.json`).catch((e) => {
      contextPromise = null
      throw e
    })
  }
  return contextPromise
}

/** 数据有多旧（小时）。页面上的「数据年龄」提示用它，超过 6 小时要明说。 */
export function ageHours(iso: string, now = Date.now()): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return NaN
  return (now - t) / 3600000
}
