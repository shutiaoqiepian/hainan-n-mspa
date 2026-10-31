/**
 * 预报缓存的读写（data/forecast/<省>.json）。
 *
 * 格式：一行一个机位。为什么不是整份压一行 ——
 *   不是为了省 git（实测 git 的 delta 压缩对两种格式一样好，见
 *   tools/measure-cache-git.mjs），而是为了**能看**：
 *   6.6 MB 压成一行的文件，git diff 没法读，出了错只能靠猜。
 *   现在改一个省，diff 里就只出现那个省的几行。
 *
 * 与机位表对齐：文件里有 `place`（机位清单），前端用它校验
 * 「数据条数 = 机位数」。对不上就当缓存过期，回退到实时请求 ——
 * 而不是像以前那样静默地把整省数据错位一格。
 *
 * 用法（手工把某个省的缓存重排/检查）：
 *   node tools/shared/json-io.mjs hn
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const OUT_DIR = resolve(ROOT, 'data/forecast')
export const outPath = (prov) => resolve(OUT_DIR, prov + '.json')

/** place 的字段顺序写死：顺序一变，git 就认为整块都变了 */
const SPOT_KEYS = ['n', 'area', 'lat', 'lon', 'face', 'obs']

/** 按固定键序重排对象，其余键按原顺序跟后面 */
function ordered(obj, keys) {
  const out = {}
  for (const k of keys) if (obj && k in obj) out[k] = obj[k]
  for (const k of Object.keys(obj || {})) if (!(k in out)) out[k] = obj[k]
  return out
}

/** 逐行拼装一份缓存对象。逗号只在元素之间，块级元素尾部不加。 */
function stringifyCache(payload) {
  const chunks = []

  /* 顶层标量字段在前 */
  for (const k of Object.keys(payload)) {
    if (k === 'place' || k === 'weather' || k === 'prof' || k === 'air' || k === 'horizon') continue
    chunks.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(payload[k]))
  }

  const place = payload.place ?? []
  const n = place.length

  /* place：一行一个机位 */
  if (n) {
    const rows = []
    for (let i = 0; i < n; i++) {
      rows.push('    ' + JSON.stringify(ordered(place[i], SPOT_KEYS)) + (i === n - 1 ? '' : ','))
    }
    chunks.push('  "place": [\n' + rows.join('\n') + '\n  ]')
  } else {
    chunks.push('  "place": []')
  }

  /* 四个与 place 逐行对齐的数组 */
  for (const key of ['weather', 'prof', 'air', 'horizon']) {
    const arr = payload[key] ?? []
    if (!n || !arr.length) {
      chunks.push('  ' + JSON.stringify(key) + ': []')
      continue
    }
    const rows = []
    for (let i = 0; i < n; i++) {
      rows.push('    ' + JSON.stringify(arr[i] === undefined ? null : arr[i]) + (i === n - 1 ? '' : ','))
    }
    chunks.push('  ' + JSON.stringify(key) + ': [\n' + rows.join('\n') + '\n  ]')
  }

  return '{\n' + chunks.join(',\n') + '\n}\n'
}

/** 写一份省份缓存 */
export async function writeCacheFile(prov, payload) {
  const out = outPath(prov)
  const text = stringifyCache(payload)
  /* 自检：写出去的东西必须能读回来，且长度对齐 */
  const back = JSON.parse(text)
  const n = (payload.place ?? []).length
  for (const k of ['weather', 'prof', 'air', 'horizon']) {
    const got = (back[k] ?? []).length
    if (got && got !== n) throw new Error(prov + ' 的 ' + k + ' 有 ' + got + ' 条，但机位有 ' + n + ' 个')
  }
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, text, 'utf8')
  return {
    kb: Math.round(Buffer.byteLength(text) / 1024),
    spots: n
  }
}

/** 读出某个省现有的缓存（没有就返回 null） */
export async function readCacheFile(prov) {
  try {
    return JSON.parse(await readFile(outPath(prov), 'utf8'))
  } catch {
    return null
  }
}

/** 给老缓存（还没有 place 字段）补上机位清单。
 *  weather 是按 spots.json 当时顺序写的 —— 条数对得上才能补，否则补不了。 */
export function adoptLegacy(legacy, spots) {
  const n = (legacy?.weather ?? []).length
  if (!n || n !== spots.length) return null
  if (Array.isArray(legacy.place) && legacy.place.length === n) return legacy
  return {
    ...legacy,
    place: spots.map((s) => ({
      n: s.n,
      area: s.area,
      lat: s.lat,
      lon: s.lon,
      face: s.face,
      ...(s.obs ? { obs: s.obs } : {})
    }))
  }
}

/* 直接跑：把一个省的缓存读出来再写一遍（检查格式是否自洽） */
if (process.argv[1] && process.argv[1].endsWith('json-io.mjs')) {
  const prov = process.argv[2]
  if (!prov) {
    console.error('用法：node tools/shared/json-io.mjs <省代码，如 hn>')
    process.exit(1)
  }
  const payload = await readCacheFile(prov)
  if (!payload) {
    console.error('读不出 ' + outPath(prov))
    process.exit(1)
  }
  const r = await writeCacheFile(prov, payload)
  console.log('已重排 ' + prov + '：' + r.spots + ' 个机位，' + r.kb + ' KB')
}
