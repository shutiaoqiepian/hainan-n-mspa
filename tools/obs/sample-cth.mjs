/**
 * 卫星云顶高度取样器（第 2 条验证路线：独立观测 vs 模式云场）。
 *
 * 为什么用 GIBS：NASA GIBS 把 MODIS/AIRS 的 L2 产品做成了**免注册的瓦片服务**，
 * 一个点只要 1 张 256×256 PNG（几 KB），不用下载 GB 级 HDF5、不用账号。
 * 这绕开了 docs/卫星云顶温度-可行性探查.md 里"代价太高"的那条路。
 *
 * 数据链路（每一步都可复核）：
 *   MODIS_Terra_Cloud_Top_Height_Day  ← MOD/MYD 云顶高度产品（米）
 *   GIBS 官方调色板 tools/obs/data/cloud-top-height-colormap.xml
 *     `rgb="255,0,0" sourceValue="[0,50)"` … `rgb="185,16,143" sourceValue="[11950,12000)"`
 *     → 颜色与「云顶高度（米）」一一对应，**这是官方给的数据-RGB 映射，不是我拟合的**。
 *   取以机位为中心 32×32 像素（z6 下 1 px ≈ 2.4 km，约 78 km × 78 km），
 *   统计「有云像素占比」与「云顶高度分档占比」。
 *
 * 诚实边界：
 *   · MODIS 一天过境 2 次（Terra 约 10:30、Aqua 约 13:30 地方时），不是日落时刻；
 *     所以它回答的是「那天下午天上有没有高云」，不是「日落那一刻烧不烧」。
 *   · 只取 Terra（Day），漏掉晨昏，会低估傍晚才出现的云。
 *   · 取 78 km 邻域，会把机位上空的云和远处的云混在一起——只用于"这一带有没有高云"。
 *   · alpha=0 的像素 = 无资料/无云，**一律不计入，也不当 0 m 云**。
 *
 * 用法：
 *   node tools/obs/sample-cth.mjs --date 2026-10-13
 *   node tools/obs/sample-cth.mjs --date 2026-10-13 --spots hk-xihai,wzs-main --json out.json
 */

import { inflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const ZOOM = 6
const TILE = 256
export const LAYER_CTH = 'MODIS_Terra_Cloud_Top_Height_Day'

/* ---------- 极简 PNG 解码（GIBS 用 8-bit 调色板或 RGB/RGBA，非隔行） ---------- */

export function readPng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0
  let palette = null, trns = null
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (interlace !== 0) throw new Error('不支持隔行 PNG')
  if (bitDepth !== 8) throw new Error('不支持的位深 ' + bitDepth)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : 0
  if (!channels) throw new Error('不支持的 colorType ' + colorType)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const filt = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filt === 1) v += a
      else if (filt === 2) v += b
      else if (filt === 3) v += (a + b) >> 1
      else if (filt === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
  }
  return { w, h, channels, data: out, palette, trns }
}

function pixelAt(png, x, y) {
  const i = (y * png.w + x) * png.channels
  if (png.channels === 4) return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]]
  if (png.channels === 3) return [png.data[i], png.data[i + 1], png.data[i + 2], 255]
  const idx = png.data[i]
  const p = png.palette
  const a = png.trns && idx < png.trns.length ? png.trns[idx] : 255
  return [p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2], a]
}

/* ---------- GIBS 官方调色板 → 云顶高度 ---------- */

/** 解析 GIBS ColorMap XML：rgb="r,g,b" sourceValue="[lo,hi)"（单位 m） */
export function parseColormap(xml) {
  const map = new Map()
  const re = /<ColorMapEntry\s+rgb="(\d+),(\d+),(\d+)"[^>]*sourceValue="\[(\d+),(\d+)\)"[^>]*>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const key = `${m[1]},${m[2]},${m[3]}`
    const lo = Number(m[4]), hi = Number(m[5])
    /* 同一颜色可能出现在多个色带（不同产品），取中值平均不必要 —— GIBS 保证唯一 */
    if (!map.has(key)) map.set(key, { loM: lo, hiM: hi })
  }
  return map
}

export async function loadColormap() {
  const xml = await readFile(new URL('./data/cloud-top-height-colormap.xml', import.meta.url), 'utf8')
  return parseColormap(xml)
}

/* ---------- 瓦片定位 ---------- */

export function tileOf(lat, lon, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y }
}

function pixelInTile(lat, lon, z, t) {
  const n = 2 ** z
  const fx = ((lon + 180) / 360) * n - t.x
  const latRad = (lat * Math.PI) / 180
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - t.y
  return { px: fx * TILE, py: fy * TILE }
}

async function getPng(url) {
  let lastErr = null
  for (let k = 0; k < 3; k++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': '18n-mspa-obs/1.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) throw new Error('空瓦片（该日该区域无影像）')
      return readPng(buf)
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 800 * (k + 1)))
    }
  }
  throw lastErr
}

/**
 * 采样一个点：返回「有云像素占比」与「云顶高度分档占比」。
 * outSize 像素在 z6 下每像素 ≈ 2.44 km。
 */
export async function sampleCth({ lat, lon, date, colormap, outSize = 32, layer = LAYER_CTH }) {
  const t = tileOf(lat, lon, ZOOM)
  const url = `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level6/${ZOOM}/${t.x}/${t.y}.png`
  const png = await getPng(url)
  const { px, py } = pixelInTile(lat, lon, ZOOM, t)
  const half = outSize / 2
  let valid = 0, cloudy = 0, total = 0
  let sumM = 0
  const bands = { low: 0, mid: 0, high: 0, veryHigh: 0 }
  const unknown = new Map()
  for (let y = Math.round(py - half); y < Math.round(py + half); y++) {
    for (let x = Math.round(px - half); x < Math.round(px + half); x++) {
      if (x < 0 || y < 0 || x >= png.w || y >= png.h) continue
      total++
      const [r, g, b, a] = pixelAt(png, x, y)
      if (a < 200) continue
      valid++
      const band = colormap.get(`${r},${g},${b}`)
      if (!band) {
        const key = `${r},${g},${b}`
        unknown.set(key, (unknown.get(key) || 0) + 1)
        continue
      }
      /* ⚠ 这个产品**不给"无云"像素上色**：GIBS 的 CTH 只对识别出云顶的像素着色，
         其余（晴空/无反演/边缘）是透明。所以 alpha=255 的像素本身就等于"有云顶反演"；
         0–500 m 那一档最可能是地面被误判成极低云，只能算"低云底"，
         统计里仍然计入 low 档并在文档里说明，不删掉也不改标成"无云"。 */
      cloudy++
      const midM = (band.loM + band.hiM) / 2
      sumM += midM
      if (midM < 2000) bands.low++
      else if (midM < 5000) bands.mid++
      else if (midM < 8000) bands.high++
      else bands.veryHigh++
    }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000
  return {
    layer,
    date,
    lat,
    lon,
    tile: `${ZOOM}/${t.x}/${t.y}`,
    url,
    pixels: total,
    validPixels: valid,
    cloudPixels: cloudy,
    /* 有云顶高度反演像素占有效像素：MODIS CTH 只对有云像素出值 */
    cloudFraction: valid ? r3(cloudy / valid) : null,
    meanCloudTopM: cloudy ? Math.round(sumM / cloudy) : null,
    bands: {
      below2km: bands.low,
      '2to5km': bands.mid,
      '5to8km': bands.high,
      above8km: bands.veryHigh
    },
    bandFraction: valid
      ? {
        below2km: r3(bands.low / valid),
        '2to5km': r3(bands.mid / valid),
        '5to8km': r3(bands.high / valid),
        above8km: r3(bands.veryHigh / valid)
      }
      : null,
    /** 识别不了的颜色（应为 0；非 0 说明调色板变了，需要重下 XML） */
    unknownColors: [...unknown.entries()].slice(0, 5),
    note:
      'MODIS Terra 白天过境（约 13:30 地方时），不是日落时刻；取 32px≈78 km 邻域；' +
      '只有"有云顶反演"的像素会被着色，透明=晴空或无反演（不计入，也不当 0 米云）'
  }
}

async function main() {
  const args = process.argv.slice(2)
  const get = (k, d = '') => {
    const i = args.indexOf('--' + k)
    return i >= 0 ? args[i + 1] : d
  }
  const date = get('date')
  if (!date) {
    console.error('用法：node tools/obs/sample-cth.mjs --date 2026-10-13 [--spots a,b] [--json out.json] [--days 5]')
    process.exit(2)
  }
  const days = Number(get('days', '1')) || 1
  const spotIds = get('spots') ? get('spots').split(',') : null
  const outPath = get('json')
  const colormap = await loadColormap()
  const index = JSON.parse(await readFile('data/cross/index.json', 'utf8'))
  const spots = index.spots.filter((s) => !spotIds || spotIds.includes(s.id))
  const out = []
  for (let d = 0; d < days; d++) {
    const dt = new Date(date + 'T00:00:00Z')
    dt.setUTCDate(dt.getUTCDate() + d)
    const day = dt.toISOString().slice(0, 10)
    for (const s of spots) {
      try {
        const r = await sampleCth({ lat: s.lat, lon: s.lon, date: day, colormap })
        out.push({ spot: s.id, name: s.name, date: day, ...r })
      } catch (e) {
        out.push({ spot: s.id, name: s.name, date: day, error: String(e.message || e) })
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  if (outPath) {
    await writeFile(outPath, JSON.stringify(out, null, 1))
    console.log(`写出 ${outPath}（${out.length} 条）`)
  } else {
    console.log(JSON.stringify(out, null, 1))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
