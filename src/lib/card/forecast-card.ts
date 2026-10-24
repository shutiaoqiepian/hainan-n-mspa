/**
 * 预报名片：把「某个机位这一刻的预报」画成一张可以发朋友圈的图。
 * ------------------------------------------------------------
 * 和成员名片（lib/card/canvas.ts）同一套思路：Canvas 2D 直接画 1080×1350，
 * 微信里长按就能保存；底部两个二维码，一个链到完整预报，一个是公众号。
 *
 * 两种版式：
 *   · spot  单个机位（从每行的「名片」按钮进来）
 *   · list  今日排行前 5（从页面顶部的「生成今日名片」进来）
 *
 * 配色跟随当前主题（黑/灰/白），但灰主题走单色，避免和「黑」看起来一样。
 */

import qrcode from '@/vendor/qrcode'
import { roundRect } from './canvas'
import type { Row } from '@/lib/forecast/types'

const FONT = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif'

interface QRCodeInstance {
  addData(data: string, mode?: string): void
  make(): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}
const createQR = qrcode as unknown as (typeNumber: number, level: string) => QRCodeInstance
type TextCtx = CanvasRenderingContext2D & { letterSpacing: string }

export type CardTheme = 'dark' | 'gray' | 'light'

export interface ForecastCardInput {
  mode: 'spot' | 'list'
  theme: CardTheme
  /** 今天 / 明天 */
  dayWord: string
  /** 日出 / 日落 */
  kindWord: string
  /** 2026-10-24 */
  date: string
  /** 周六 */
  weekday: string
  /** 06:41 */
  time: string
  /** 2026年10月23日 19:12 */
  updatedText: string
  /** ECMWF + ICON + GFS 三模式平均 */
  sourceText: string
  /** 完整预报页地址（含参数），用于二维码 */
  url: string
  /** 省份名（排行版标题用） */
  provName?: string
  /** 省份英文名（页头小标题用） */
  provEn?: string
  spot?: Row
  top?: Row[]
}

interface Palette {
  bg0: string
  bg1: string
  bg2: string
  glowA: string
  glowB: string
  text: string
  text2: string
  muted: string
  line: string
  chipBg: string
  chipLine: string
  chipText: string
  qrFg: string
  neutralAccent: boolean
}

function palette(theme: CardTheme): Palette {
  if (theme === 'light') {
    return {
      bg0: '#f6f7f9', bg1: '#eceff3', bg2: '#e2e7ec',
      glowA: 'rgba(11,127,181,0.12)', glowB: 'rgba(13,156,143,0.10)',
      text: '#14171b', text2: '#39424b', muted: '#6b747d', line: 'rgba(16,22,28,0.12)',
      chipBg: 'rgba(11,127,181,0.10)', chipLine: 'rgba(11,127,181,0.28)', chipText: '#0b6f9f',
      qrFg: '#14171b', neutralAccent: false
    }
  }
  if (theme === 'gray') {
    return {
      bg0: '#212428', bg1: '#2b2f34', bg2: '#1b1e22',
      glowA: 'rgba(220,228,236,0.10)', glowB: 'rgba(200,210,220,0.06)',
      text: '#f0f2f4', text2: '#c6ccd2', muted: '#9aa1a8', line: 'rgba(255,255,255,0.12)',
      chipBg: 'rgba(255,255,255,0.10)', chipLine: 'rgba(255,255,255,0.22)', chipText: '#e3e8ec',
      qrFg: '#14171b', neutralAccent: true
    }
  }
  return {
    bg0: '#0b0d10', bg1: '#14181d', bg2: '#08090b',
    glowA: 'rgba(79,179,232,0.16)', glowB: 'rgba(53,214,192,0.10)',
    text: '#ffffff', text2: '#c6cdd3', muted: '#8f979f', line: 'rgba(255,255,255,0.12)',
    chipBg: 'rgba(79,179,232,0.14)', chipLine: 'rgba(79,179,232,0.34)', chipText: '#a8d8f4',
    qrFg: '#0f1114', neutralAccent: false
  }
}

/** 二维码：安静区 4 格，白底圆角。
    小尺寸下必须用「整数像素格」，否则格子互相压边，扫不出来。 */
function drawQR(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fg: string): void {
  const qr = createQR(0, 'L')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const quiet = 4
  const total = n + quiet * 2
  const cell = Math.max(1, Math.floor(size / total))
  const draw = cell * total
  const off = Math.round((size - draw) / 2)

  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, size, size, 14)
  ctx.fill()

  ctx.fillStyle = fg
  const x0 = x + off + quiet * cell
  const y0 = y + off + quiet * cell
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell)
    }
  }
}

function setFont(ctx: TextCtx, weight: string, size: number, spacing = '0px'): void {
  ctx.font = weight + ' ' + size + 'px ' + FONT
  ctx.letterSpacing = spacing
}

/** 按宽度折行，超出 maxLines 时最后一行加省略号 */
function wrapText(
  ctx: TextCtx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const chars = Array.from(text)
  const lines: string[] = []
  let line = ''
  for (const ch of chars) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = ch
      if (lines.length === maxLines) break
    } else {
      line = test
    }
  }
  if (lines.length < maxLines && line && !lines[maxLines - 1]?.endsWith('…')) lines.push(line)
  let yy = y
  lines.slice(0, maxLines).forEach((l, i) => {
    let out = l
    const last = i === maxLines - 1
    if (last && (lines.length > maxLines || chars.join('').length > lines.join('').length)) {
      while (out && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1)
      out = out + '…'
    }
    ctx.fillText(out, x, yy)
    yy += lineHeight
  })
  return yy
}

function chip(
  ctx: TextCtx,
  text: string,
  x: number,
  y: number,
  p: Palette,
  opts?: { size?: number; accent?: string }
): number {
  const size = opts?.size ?? 26
  setFont(ctx, '500', size)
  const w = ctx.measureText(text).width + 34
  const h = size + 22
  ctx.fillStyle = p.chipBg
  roundRect(ctx, x, y, w, h, h / 2)
  ctx.fill()
  ctx.strokeStyle = opts?.accent ?? p.chipLine
  ctx.lineWidth = 1.5
  roundRect(ctx, x, y, w, h, h / 2)
  ctx.stroke()
  ctx.fillStyle = p.chipText
  ctx.fillText(text, x + 17, y + h / 2 + size * 0.36)
  return w
}

/** 白主题下等级色要压暗，否则浅黄/浅绿在白卡上几乎看不见 */
const LIGHT_LEVEL: Record<string, string> = {
  火烧云: '#b93a1c',
  大烧: '#b45309',
  中烧: '#9a6a10',
  小烧: '#1b7a4c',
  微烧: '#4f5962',
  不烧: '#6b7280'
}

function levelColor(row: Row, p: Palette, theme: CardTheme): string {
  if (theme === 'light') return LIGHT_LEVEL[row.level.name] ?? '#39424b'
  return p.neutralAccent ? p.text : row.level.color
}

/* ---------- 单机位版式 ---------- */

function drawSpot(ctx: TextCtx, cv: HTMLCanvasElement, d: ForecastCardInput): void {
  const W = cv.width
  const H = cv.height
  const p = palette(d.theme)
  const r = d.spot!
  const pad = 72

  drawBackdrop(ctx, W, H, p)

  /* 顶部品牌 */
  ctx.textAlign = 'left'
  ctx.fillStyle = p.muted
  setFont(ctx, '600', 26, '10px')
  ctx.fillText('18N-MSPA', pad, 118)
  setFont(ctx, '400', 21)
  ctx.fillStyle = p.muted
  ctx.fillText('北纬18度椰青摄联 · ' + (d.provName ?? '海南'), pad, 156)

  /* 右上：预报类型 */
  ctx.textAlign = 'right'
  setFont(ctx, '600', 24, '6px')
  ctx.fillStyle = p.text2
  ctx.fillText(d.kindWord + '预报', W - pad, 120)
  ctx.textAlign = 'left'

  /* 日期行 */
  setFont(ctx, '400', 23, '8px')
  ctx.fillStyle = p.muted
  ctx.fillText('SUNSET FORECAST · ' + (d.provEn ?? 'HAINAN').toUpperCase(), pad, 246)

  setFont(ctx, '600', 33)
  ctx.fillStyle = p.text2
  ctx.fillText(d.date + ' ' + d.weekday + ' · ' + d.dayWord + d.kindWord + ' ' + d.time, pad, 306)

  /* 分数环（右上） */
  const ringR = 128
  const ringX = W - pad - ringR
  const ringY = 420
  const track = d.theme === 'light' ? 'rgba(16,22,28,0.10)' : 'rgba(255,255,255,0.10)'
  ctx.beginPath()
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = track
  ctx.lineWidth = 18
  ctx.stroke()

  const frac = Math.max(0, Math.min(1, r.score / 96))
  if (frac > 0) {
    ctx.beginPath()
    ctx.arc(ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
    ctx.strokeStyle = levelColor(r, p, d.theme)
    ctx.lineWidth = 18
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.lineCap = 'butt'
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = p.text
  setFont(ctx, '700', 74)
  ctx.fillText(String(r.score), ringX, ringY + 16)
  ctx.fillStyle = levelColor(r, p, d.theme)
  setFont(ctx, '600', 26, '4px')
  ctx.fillText(r.level.name, ringX, ringY + 62)
  ctx.textAlign = 'left'

  /* 机位名 + 朝向 */
  const nameMax = W - pad * 2 - ringR * 2 - 30
  setFont(ctx, '700', 66)
  ctx.fillStyle = p.text
  const nameWidth = ctx.measureText(r.spot.n).width
  ctx.fillText(r.spot.n, pad, 410)
  if (nameWidth < nameMax - 120) {
    chip(ctx, '朝' + r.spot.face, pad + nameWidth + 22, 366, p, { size: 24 })
  }
  setFont(ctx, '500', 26)
  ctx.fillStyle = p.muted
  ctx.fillText(r.spot.area + ' · ' + d.sourceText, pad, 462)

  /* 云况三格 */
  let cx = pad
  const chipY = 520
  for (const [label, v] of [
    ['高云', r.m.high],
    ['中云', r.m.mid],
    ['低云', r.m.low]
  ] as const) {
    cx += chip(ctx, label + ' ' + Math.round(v ?? 0) + '%', cx, chipY, p) + 12
  }
  cx = pad
  const chip2Y = chipY + 62
  cx += chip(ctx, 'AOD ' + r.m.aod.toFixed(2), cx, chip2Y, p) + 12
  cx += chip(ctx, '云隙光 ' + r.rays, cx, chip2Y, p) + 12
  cx += chip(ctx, '光柱 ' + r.pillar, cx, chip2Y, p) + 12
  if (r.rainbowScore >= 15) chip(ctx, '彩虹 ' + r.rainbowScore, cx, chip2Y, p)
  else chip(ctx, '降雨 ' + Math.round(r.m.pop ?? 0) + '%', cx, chip2Y, p)

  /* 云种 */
  if (r.detail.genusText) {
    setFont(ctx, '400', 25)
    ctx.fillStyle = p.muted
    ctx.fillText(fit(ctx, '云种 ' + r.detail.genusText, W - pad * 2), pad, 706)
  }

  /* 解读 */
  ctx.fillStyle = p.line
  ctx.fillRect(pad, 742, W - pad * 2, 1.5)

  ctx.fillStyle = levelColor(r, p, d.theme)
  roundRect(ctx, pad, 786, 5, 120, 3)
  ctx.fill()

  setFont(ctx, '500', 31)
  ctx.fillStyle = p.text2
  wrapText(ctx, r.detail.interpret.headline, pad + 26, 820, W - pad * 2 - 26, 44, 3)

  /* 拍摄题材 */
  const tips = r.detail.tips.slice(0, 3)
  if (tips.length) {
    setFont(ctx, '400', 22, '6px')
    ctx.fillStyle = p.muted
    ctx.fillText('可能拍到的题材', pad, 982)
    let tx = pad
    for (const t of tips) {
      const w = chip(ctx, t.name, tx, 1004, p, { size: 24 })
      tx += w + 12
      if (tx > W - pad - 180) break
    }
  }

  /* 二维码区（必须在底栏上方留出 40px 以上，否则会压住底栏文字） */
  const qrSize = 190
  const qrY = 1056
  drawQR(ctx, d.url, pad, qrY, qrSize, p.qrFg)
  if (wxQR) {
    ctx.save()
    roundRect(ctx, W - pad - qrSize, qrY, qrSize, qrSize, 16)
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(W - pad - qrSize, qrY, qrSize, qrSize)
    ctx.drawImage(wxQR, W - pad - qrSize, qrY, qrSize, qrSize)
    ctx.restore()
  } else {
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, W - pad - qrSize, qrY, qrSize, qrSize, 16)
    ctx.fill()
    ctx.fillStyle = '#8f979f'
    ctx.textAlign = 'center'
    setFont(ctx, '400', 22)
    ctx.fillText('公众号二维码', W - pad - qrSize / 2, qrY + qrSize / 2)
    ctx.textAlign = 'left'
  }

  setFont(ctx, '400', 22)
  ctx.fillStyle = p.muted
  ctx.fillText('扫码看完整预报', pad, qrY + qrSize + 30)
  ctx.textAlign = 'right'
  ctx.fillText('扫码关注公众号', W - pad, qrY + qrSize + 30)
  ctx.textAlign = 'left'

  /* 底栏 */
  ctx.fillStyle = p.line
  ctx.fillRect(pad, H - 52, W - pad * 2, 1)
  setFont(ctx, '400', 20)
  ctx.fillStyle = p.muted
  ctx.fillText('数据 ' + d.updatedText + ' · 仅供参考', pad, H - 18)
  ctx.textAlign = 'right'
  ctx.fillText('hainan-n-mspa.pages.dev', W - pad, H - 18)
  ctx.textAlign = 'left'
}

/* ---------- 今日排行版式 ---------- */

function drawList(ctx: TextCtx, cv: HTMLCanvasElement, d: ForecastCardInput): void {
  const W = cv.width
  const H = cv.height
  const p = palette(d.theme)
  const pad = 72
  const rows = (d.top ?? []).slice(0, 5)

  drawBackdrop(ctx, W, H, p)

  ctx.textAlign = 'left'
  ctx.fillStyle = p.muted
  setFont(ctx, '600', 26, '10px')
  ctx.fillText('18N-MSPA', pad, 118)
  setFont(ctx, '400', 21)
  ctx.fillText('北纬18度椰青摄联 · ' + (d.provName ?? '海南'), pad, 156)

  setFont(ctx, '400', 23, '8px')
  ctx.fillStyle = p.muted
  ctx.fillText('SUNSET FORECAST · ' + (d.provEn ?? 'HAINAN').toUpperCase(), pad, 246)

  setFont(ctx, '700', 60)
  ctx.fillStyle = p.text
  ctx.fillText(d.dayWord + '，' + (d.provName ?? '海南') + '哪里值得跑', pad, 330)

  setFont(ctx, '600', 30)
  ctx.fillStyle = p.text2
  ctx.fillText(d.date + ' ' + d.weekday + ' · ' + d.kindWord + ' ' + d.time + ' · 按分数排序', pad, 384)

  ctx.fillStyle = p.line
  ctx.fillRect(pad, 420, W - pad * 2, 1.5)

  let y = 470
  rows.forEach((r, i) => {
    /* 名次 */
    ctx.beginPath()
    ctx.arc(pad + 26, y + 34, 26, 0, Math.PI * 2)
    ctx.strokeStyle = i === 0 ? levelColor(r, p, d.theme) : p.line
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = i === 0 ? levelColor(r, p, d.theme) : p.muted
    setFont(ctx, '600', 26)
    ctx.fillText(String(i + 1), pad + 26, y + 44)
    ctx.textAlign = 'left'

    /* 机位 + 云况 */
    setFont(ctx, '600', 36)
    ctx.fillStyle = p.text
    ctx.fillText(r.spot.n, pad + 74, y + 30)

    setFont(ctx, '400', 23)
    ctx.fillStyle = p.muted
    const meta = '高云 ' + Math.round(r.m.high ?? 0) + '% · 低云 ' + Math.round(r.m.low ?? 0) +
      '% · AOD ' + r.m.aod.toFixed(2) + ' · 云隙光 ' + r.rays
    ctx.fillText(fit(ctx, meta, W - pad * 2 - 74 - 220), pad + 74, y + 66)

    /* 分数 */
    ctx.textAlign = 'right'
    setFont(ctx, '700', 52)
    ctx.fillStyle = levelColor(r, p, d.theme)
    ctx.fillText(String(r.score), W - pad - 96, y + 44)
    setFont(ctx, '500', 24, '2px')
    ctx.fillStyle = p.text2
    ctx.fillText(r.level.name, W - pad - 8, y + 44)
    ctx.textAlign = 'left'

    if (i < rows.length - 1) {
      ctx.fillStyle = p.line
      ctx.fillRect(pad + 74, y + 96, W - pad * 2 - 74, 1)
    }
    y += 108
  })

  /* 二维码 */
  const qrSize = 180
  const qrY = Math.min(y + 16, H - 282)
  drawQR(ctx, d.url, pad, qrY, qrSize, p.qrFg)
  if (wxQR) {
    ctx.save()
    roundRect(ctx, W - pad - qrSize, qrY, qrSize, qrSize, 16)
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(W - pad - qrSize, qrY, qrSize, qrSize)
    ctx.drawImage(wxQR, W - pad - qrSize, qrY, qrSize, qrSize)
    ctx.restore()
  }

  setFont(ctx, '400', 21)
  ctx.fillStyle = p.muted
  ctx.fillText('扫码看全部机位', pad, qrY + qrSize + 28)
  ctx.textAlign = 'right'
  ctx.fillText('扫码关注公众号', W - pad, qrY + qrSize + 28)
  ctx.textAlign = 'left'

  ctx.fillStyle = p.line
  ctx.fillRect(pad, H - 52, W - pad * 2, 1)
  setFont(ctx, '400', 20)
  ctx.fillStyle = p.muted
  ctx.fillText('数据 ' + d.updatedText + ' · 仅供参考', pad, H - 18)
  ctx.textAlign = 'right'
  ctx.fillText('hainan-n-mspa.pages.dev', W - pad, H - 18)
  ctx.textAlign = 'left'
}

/* ---------- 公共 ---------- */

function drawBackdrop(ctx: TextCtx, W: number, H: number, p: Palette): void {
  ctx.clearRect(0, 0, W, H)
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, p.bg0)
  bg.addColorStop(0.55, p.bg1)
  bg.addColorStop(1, p.bg2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const g1 = ctx.createRadialGradient(W * 0.16, H * 0.06, 0, W * 0.16, H * 0.06, W * 0.8)
  g1.addColorStop(0, p.glowA)
  g1.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g1
  ctx.fillRect(0, 0, W, H)

  const g2 = ctx.createRadialGradient(W * 0.95, H * 0.02, 0, W * 0.95, H * 0.02, W * 0.6)
  g2.addColorStop(0, p.glowB)
  g2.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, W, H)
}

function fit(ctx: TextCtx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let out = text
  while (out.length > 4 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1)
  return out + '…'
}

/* ---------- 入口 ---------- */

let wxQR: HTMLImageElement | null = null
let loading = false
let waiters: Array<() => void> = []

/** 公众号二维码只加载一次；没加载完就先把卡片画出来，加载完再重画 */
export function loadForecastCardImages(done: () => void): void {
  if (wxQR) {
    done()
    return
  }
  waiters.push(done)
  if (loading) return
  loading = true

  const img = new Image()
  const finish = (): void => {
    loading = false
    const q = waiters
    waiters = []
    q.forEach((fn) => fn())
  }
  img.onload = () => {
    wxQR = img
    finish()
  }
  img.onerror = finish
  img.src = 'images/二维码.jpg'
}

export function drawForecastCard(cv: HTMLCanvasElement, input: ForecastCardInput): void {
  const ctx = cv.getContext('2d') as TextCtx | null
  if (!ctx) return
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (input.mode === 'list') drawList(ctx, cv, input)
  else drawSpot(ctx, cv, input)
}
