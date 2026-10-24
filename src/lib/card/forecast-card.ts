/**
 * 预报名片：把「某个机位这一刻的预报」画成一张可以发朋友圈的图。
 * ------------------------------------------------------------
 * 和成员名片（lib/card/canvas.ts）同一套思路：Canvas 2D 直接画 1080×1350，
 * 微信里长按就能保存；底部两个二维码，一个链到完整预报，一个是公众号。
 *
 * 两种版式：
 *   · spot  单个机位（从决策卡的「生成名片」按钮进来）
 *   · list  今日排行前 5（从排行表顶部的「生成今日名片」进来）
 *
 * 配色跟随当前主题（黑/灰/白），但灰主题走单色，避免和「黑」看起来一样。
 *
 * ------------------------------------------------------------
 * 版面原则（改版时按这个来）：
 *   1. 分享出去的图只有一条命：别人在信息流里扫 1 秒。所以顺序是
 *      「谁 → 几分 → 什么时候 → 为什么 → 细节」，不是按网页的模块顺序。
 *   2. 分数是主角：1080 宽的图上占右侧整块，用等级色做光晕。
 *   3. 每个数字都有单位、都有小标签，不让人猜。
 *   4. 底部二维码区独立成条，不再和「题材标签」挤在一起。
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
  /** 卡片上的「玻璃」色：比底色略亮的一层 */
  panel: string
  panelLine: string
}

function palette(theme: CardTheme): Palette {
  if (theme === 'light') {
    return {
      bg0: '#f6f7f9', bg1: '#eceff3', bg2: '#e2e7ec',
      glowA: 'rgba(11,127,181,0.12)', glowB: 'rgba(13,156,143,0.10)',
      text: '#14171b', text2: '#39424b', muted: '#6b747d', line: 'rgba(16,22,28,0.12)',
      chipBg: 'rgba(11,127,181,0.10)', chipLine: 'rgba(11,127,181,0.28)', chipText: '#0b6f9f',
      qrFg: '#14171b', neutralAccent: false,
      panel: 'rgba(255,255,255,0.72)', panelLine: 'rgba(16,22,28,0.09)'
    }
  }
  if (theme === 'gray') {
    return {
      bg0: '#212428', bg1: '#2b2f34', bg2: '#1b1e22',
      glowA: 'rgba(220,228,236,0.10)', glowB: 'rgba(200,210,220,0.06)',
      text: '#f0f2f4', text2: '#c6ccd2', muted: '#9aa1a8', line: 'rgba(255,255,255,0.12)',
      chipBg: 'rgba(255,255,255,0.10)', chipLine: 'rgba(255,255,255,0.22)', chipText: '#e3e8ec',
      qrFg: '#14171b', neutralAccent: true,
      panel: 'rgba(255,255,255,0.045)', panelLine: 'rgba(255,255,255,0.10)'
    }
  }
  return {
    bg0: '#0b0d10', bg1: '#14181d', bg2: '#08090b',
    glowA: 'rgba(79,179,232,0.16)', glowB: 'rgba(53,214,192,0.10)',
    text: '#ffffff', text2: '#c6cdd3', muted: '#8f979f', line: 'rgba(255,255,255,0.12)',
    chipBg: 'rgba(79,179,232,0.14)', chipLine: 'rgba(79,179,232,0.34)', chipText: '#a8d8f4',
    qrFg: '#0f1114', neutralAccent: false,
    panel: 'rgba(255,255,255,0.042)', panelLine: 'rgba(255,255,255,0.09)'
  }
}

/* ---------- 小工具 ---------- */

function setFont(ctx: TextCtx, weight: string, size: number, spacing = '0px'): void {
  ctx.font = weight + ' ' + size + 'px ' + FONT
  ctx.letterSpacing = spacing
}

function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
}

/** 按宽度折行；maxLines 用尽时最后一行加省略号。返回下一行的 y。 */
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
  if (lines.length < maxLines && line) lines.push(line)

  let yy = y
  lines.slice(0, maxLines).forEach((l, i) => {
    let out = l
    const last = i === maxLines - 1
    const truncated = lines.length > maxLines || chars.join('').length > lines.join('').length
    if (last && truncated) {
      while (out && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1)
      out += '…'
    }
    ctx.fillText(out, x, yy)
    yy += lineHeight
  })
  return yy
}

/** 玻璃面板：圆角 + 细边 */
function panel(ctx: TextCtx, x: number, y: number, w: number, h: number, r: number, p: Palette): void {
  ctx.fillStyle = p.panel
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.strokeStyle = p.panelLine
  ctx.lineWidth = 1.5
  roundRect(ctx, x, y, w, h, r)
  ctx.stroke()
}

/** 胶囊标签；返回宽度，方便横向排布 */
function chip(
  ctx: TextCtx,
  text: string,
  x: number,
  y: number,
  p: Palette,
  opts?: { size?: number; accent?: string; fill?: string }
): number {
  const size = opts?.size ?? 25
  setFont(ctx, '500', size)
  const w = ctx.measureText(text).width + 32
  const h = size + 20
  ctx.fillStyle = opts?.fill ?? p.chipBg
  roundRect(ctx, x, y, w, h, h / 2)
  ctx.fill()
  if (opts?.accent) {
    ctx.strokeStyle = opts.accent
    ctx.lineWidth = 2
    roundRect(ctx, x, y, w, h, h / 2)
    ctx.stroke()
  }
  ctx.fillStyle = p.chipText
  ctx.fillText(text, x + 16, y + h / 2 + size * 0.36)
  return w
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

function n0(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function fx(v: number | null | undefined, n = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(n)
}

/* ---------- 单机位版式 ---------- */

function drawSpot(ctx: TextCtx, cv: HTMLCanvasElement, d: ForecastCardInput): void {
  const W = cv.width
  const H = cv.height
  const p = palette(d.theme)
  const r = d.spot!
  const pad = 72
  const inner = W - pad * 2
  const lc = levelColor(r, p, d.theme)

  drawBackdrop(ctx, W, H, p)

  /* ===== 1. 页眉 ===== */
  ctx.textAlign = 'left'
  ctx.fillStyle = p.text
  setFont(ctx, '600', 26, '9px')
  ctx.fillText('18N-MSPA', pad, 96)
  setFont(ctx, '400', 20, '1px')
  ctx.fillStyle = p.muted
  ctx.fillText('北纬18度椰青摄联 · ' + (d.provName ?? '海南'), pad, 130)

  ctx.textAlign = 'right'
  setFont(ctx, '600', 22, '5px')
  ctx.fillStyle = p.text2
  ctx.fillText(d.dayWord + ' · ' + d.kindWord + '预报', W - pad, 100)
  ctx.textAlign = 'left'

  ctx.fillStyle = p.line
  ctx.fillRect(pad, 154, inner, 1.5)

  /* ===== 2. 分数（主角，右上）/ 机位名（左） ===== */
  const ringR = 112
  const ringX = W - pad - ringR
  const ringY = 316

  /* 等级色光晕 */
  const halo = ctx.createRadialGradient(ringX, ringY, ringR * 0.35, ringX, ringY, ringR * 1.75)
  halo.addColorStop(0, alpha(lc.startsWith('#') ? lc : '#ffffff', 0.28))
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = halo
  ctx.fillRect(ringX - ringR * 1.8, ringY - ringR * 1.8, ringR * 3.6, ringR * 3.6)

  ctx.beginPath()
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = d.theme === 'light' ? 'rgba(16,22,28,0.10)' : 'rgba(255,255,255,0.10)'
  ctx.lineWidth = 16
  ctx.stroke()

  const frac = Math.max(0, Math.min(1, r.score / 96))
  if (frac > 0) {
    ctx.beginPath()
    ctx.arc(ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
    ctx.strokeStyle = lc
    ctx.lineWidth = 16
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.lineCap = 'butt'
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = p.text
  setFont(ctx, '700', 78)
  ctx.fillText(String(r.score), ringX, ringY + 24)
  ctx.fillStyle = p.muted
  setFont(ctx, '400', 22)
  ctx.fillText('满分 96', ringX, ringY - 46)
  ctx.fillStyle = lc
  setFont(ctx, '600', 27, '5px')
  ctx.fillText(r.level.name, ringX, ringY + 66)
  ctx.textAlign = 'left'

  /* 机位名 */
  setFont(ctx, '700', 74)
  ctx.fillStyle = p.text
  const nameW = ctx.measureText(r.spot.n).width
  ctx.fillText(r.spot.n, pad, 300)
  chip(ctx, '朝' + r.spot.face, pad + nameW + 20, 254, p, { size: 24 })

  setFont(ctx, '500', 26)
  ctx.fillStyle = p.text2
  ctx.fillText(r.spot.area + ' · 海拔 ' + Math.round(r.spot.lat * 100) / 100 + '°N ' +
    Math.round(r.spot.lon * 100) / 100 + '°E', pad, 348)

  /* 日期时间 —— 分享图上最该被看清的一行，做成强调块 */
  const whenY = 384
  setFont(ctx, '600', 30)
  const whenText = d.date + ' ' + d.weekday
  const whenW = ctx.measureText(whenText).width
  ctx.fillStyle = p.text
  ctx.fillText(whenText, pad, whenY + 44)

  setFont(ctx, '700', 40)
  const timeText = d.kindWord + ' ' + d.time
  /* 时刻用强调色而不是等级色：微烧/不烧的等级色本身就是灰的，
     用在「日出 06:35」这种关键信息上会被读成禁用状态 */
  ctx.fillStyle = d.theme === 'light' ? '#0b7fb5' : '#4fb3e8'
  ctx.fillText(timeText, pad + whenW + 22, whenY + 46)

  /* ===== 3. 关键指标条（六格） ===== */
  const gY = 470
  const gH = 104
  panel(ctx, pad, gY, inner, gH, 20, p)

  const cells: Array<[string, string]> = [
    ['高云', n0(r.m.high) + '%'],
    ['中云', n0(r.m.mid) + '%'],
    ['低云', n0(r.m.low) + '%'],
    ['AOD', fx(r.m.aod)],
    ['降雨', n0(r.m.pop) + '%'],
    ['鲜亮度', String(r.vivid)]
  ]
  const cw = inner / cells.length
  cells.forEach(([k, v], i) => {
    const cx = pad + cw * i + cw / 2
    ctx.textAlign = 'center'
    setFont(ctx, '400', 20, '3px')
    ctx.fillStyle = p.muted
    ctx.fillText(k, cx, gY + 36)
    setFont(ctx, '700', 34)
    ctx.fillStyle = p.text
    ctx.fillText(v, cx, gY + 78)
    ctx.textAlign = 'left'
    if (i > 0) {
      ctx.fillStyle = p.line
      ctx.fillRect(pad + cw * i, gY + 22, 1, gH - 44)
    }
  })

  /* ===== 4. 两个峰值时刻 ===== */
  const mY = 596
  const mW = (inner - 16) / 2
  const moments: Array<[string, string, string, string]> = [
    ['最佳时刻', r.peakTime || d.time, r.peakScore + ' 分', '分数最高的一小时'],
    ['鲜艳度峰值', r.vividPeakTime || d.time, r.vividPeakLabel + ' · ' + r.vividPeak, '颜色最浓的一小时']
  ]
  moments.forEach(([k, t, v, note], i) => {
    const x = pad + (mW + 16) * i
    panel(ctx, x, mY, mW, 96, 18, p)
    ctx.textAlign = 'left'
    setFont(ctx, '400', 19, '3px')
    ctx.fillStyle = p.muted
    ctx.fillText(k, x + 20, mY + 30)
    setFont(ctx, '700', 36)
    ctx.fillStyle = i === 0 ? p.text : (d.theme === 'light' ? '#0d6f74' : '#35d6c0')
    ctx.fillText(t, x + 20, mY + 68)
    ctx.textAlign = 'right'
    setFont(ctx, '500', 21)
    ctx.fillStyle = p.text2
    ctx.fillText(v, x + mW - 20, mY + 68)
    ctx.textAlign = 'left'
    setFont(ctx, '400', 16)
    ctx.fillStyle = p.muted
    ctx.fillText(note, x + 20, mY + 88)
  })

  /* ===== 5. 四个机会指数 ===== */
  const oY = 712
  const oH = 110
  const opps: Array<[string, number, string]> = [
    ['通透', r.clarity, clarityWord(r.clarity)],
    ['云隙光', r.rays, raysWord(r.rays)],
    ['光柱', r.pillar, pillarWord(r.pillar)],
    ['彩虹', r.rainbowScore, rainbowWord(r.rainbowScore)]
  ]
  const ow = (inner - 12 * 3) / 4
  opps.forEach(([k, v, word], i) => {
    const x = pad + (ow + 12) * i
    panel(ctx, x, oY, ow, oH, 16, p)
    /* 第一行：小标签 + 分数 */
    setFont(ctx, '400', 18, '3px')
    ctx.fillStyle = p.muted
    ctx.fillText(k, x + 14, oY + 28)
    ctx.textAlign = 'right'
    setFont(ctx, '700', 34)
    ctx.fillStyle = p.text
    ctx.fillText(String(v), x + ow - 14, oY + 30)
    ctx.textAlign = 'left'
    /* 第二行：进度条 */
    const barW = ow - 28
    const barY = oY + 44
    ctx.fillStyle = d.theme === 'light' ? 'rgba(16,22,28,0.10)' : 'rgba(255,255,255,0.10)'
    roundRect(ctx, x + 14, barY, barW, 6, 3)
    ctx.fill()
    ctx.fillStyle = lc
    roundRect(ctx, x + 14, barY, Math.max(3, (barW * Math.max(0, Math.min(100, v))) / 100), 6, 3)
    ctx.fill()
    /* 第三行：文字档 */
    setFont(ctx, '500', 17)
    ctx.fillStyle = p.muted
    ctx.fillText(word, x + 14, oY + 84)
  })

  /* ===== 6. 一句话结论 ===== */
  const hY = 838
  ctx.fillStyle = lc
  roundRect(ctx, pad, hY, 5, 104, 3)
  ctx.fill()

  setFont(ctx, '500', 30)
  ctx.fillStyle = p.text
  wrapText(ctx, r.detail.interpret.headline, pad + 26, hY + 34, inner - 26, 42, 3)

  /* ===== 7. 拍摄题材 ===== */
  const tips = r.detail.tips.slice(0, 4)
  if (tips.length) {
    setFont(ctx, '400', 19, '4px')
    ctx.fillStyle = p.muted
    ctx.fillText('可能拍到的题材', pad, 982)
    let tx = pad
    for (const t of tips) {
      setFont(ctx, '500', 23)
      const need = ctx.measureText(t.name).width + 32
      if (tx + need > W - pad) break
      tx += chip(ctx, t.name, tx, 996, p, { size: 23 }) + 10
    }
  }

  /* ===== 8. 二维码区（独立成条） ===== */
  const qy = 1060
  const qh = 216
  panel(ctx, pad, qy, inner, qh, 20, p)

  const qrSize = 152
  drawQR(ctx, d.url, pad + 20, qy + 32, qrSize, p.qrFg)

  ctx.textAlign = 'left'
  setFont(ctx, '600', 24)
  ctx.fillStyle = p.text
  ctx.fillText('扫码看完整预报', pad + 20 + qrSize + 22, qy + 78)
  setFont(ctx, '400', 19)
  ctx.fillStyle = p.muted
  ctx.fillText('逐层云种 · 四机会指数 · 各模式怎么看', pad + 20 + qrSize + 22, qy + 110)

  const q2x = W - pad - 20 - qrSize
  if (wxQR) {
    ctx.save()
    roundRect(ctx, q2x, qy + 32, qrSize, qrSize, 16)
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(q2x, qy + 32, qrSize, qrSize)
    ctx.drawImage(wxQR, q2x, qy + 32, qrSize, qrSize)
    ctx.restore()
  } else {
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, q2x, qy + 32, qrSize, qrSize, 16)
    ctx.fill()
    ctx.fillStyle = '#8f979f'
    ctx.textAlign = 'center'
    setFont(ctx, '400', 20)
    ctx.fillText('公众号二维码', q2x + qrSize / 2, qy + 32 + qrSize / 2)
    ctx.textAlign = 'left'
  }
  ctx.textAlign = 'center'
  setFont(ctx, '400', 18)
  ctx.fillStyle = p.muted
  ctx.fillText('关注公众号', q2x + qrSize / 2, qy + 202)
  ctx.textAlign = 'left'

  /* ===== 9. 底栏 ===== */
  ctx.fillStyle = p.line
  ctx.fillRect(pad, H - 46, inner, 1)
  setFont(ctx, '400', 19)
  ctx.fillStyle = p.muted
  ctx.fillText('数据 ' + d.updatedText + ' · ' + d.sourceText + ' · 仅供参考', pad, H - 16)
  ctx.textAlign = 'right'
  ctx.fillText('hainan-n-mspa.pages.dev', W - pad, H - 16)
  ctx.textAlign = 'left'
}

/* ---------- 今日排行版式 ---------- */

function drawList(ctx: TextCtx, cv: HTMLCanvasElement, d: ForecastCardInput): void {
  const W = cv.width
  const H = cv.height
  const p = palette(d.theme)
  const pad = 72
  const inner = W - pad * 2
  const rows = (d.top ?? []).slice(0, 5)

  drawBackdrop(ctx, W, H, p)

  /* 页眉 */
  ctx.textAlign = 'left'
  ctx.fillStyle = p.text
  setFont(ctx, '600', 26, '9px')
  ctx.fillText('18N-MSPA', pad, 96)
  setFont(ctx, '400', 20, '1px')
  ctx.fillStyle = p.muted
  ctx.fillText('北纬18度椰青摄联 · ' + (d.provName ?? '海南'), pad, 130)
  ctx.fillStyle = p.line
  ctx.fillRect(pad, 154, inner, 1.5)

  /* 标题 */
  setFont(ctx, '700', 56)
  ctx.fillStyle = p.text
  ctx.fillText(d.dayWord + '，' + (d.provName ?? '海南') + '哪里值得跑', pad, 232)

  setFont(ctx, '500', 27)
  ctx.fillStyle = p.text2
  ctx.fillText(d.date + ' ' + d.weekday + ' · ' + d.kindWord + ' ' + d.time, pad, 280)

  setFont(ctx, '400', 21)
  ctx.fillStyle = p.muted
  ctx.fillText('按分数排序 · 共 ' + rows.length + ' 个机位', pad, 316)

  /* 排行 */
  let y = 372
  rows.forEach((r, i) => {
    const lc = levelColor(r, p, d.theme)
    const rowH = 128
    panel(ctx, pad, y, inner, rowH - 12, 18, p)

    /* 名次圆牌 */
    const cx = pad + 52
    const cy = y + (rowH - 12) / 2
    ctx.beginPath()
    ctx.arc(cx, cy, 28, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? alpha(lc.startsWith('#') ? lc : '#ffffff', 0.16) : 'transparent'
    if (i === 0) ctx.fill()
    ctx.strokeStyle = i === 0 ? lc : p.line
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = i === 0 ? lc : p.muted
    setFont(ctx, '700', 28)
    ctx.fillText(String(i + 1), cx, cy + 10)
    ctx.textAlign = 'left'

    /* 机位名 + 云况 */
    setFont(ctx, '700', 38)
    ctx.fillStyle = p.text
    ctx.fillText(fit(ctx, r.spot.n, inner - 300), pad + 100, y + 52)

    setFont(ctx, '400', 21)
    ctx.fillStyle = p.muted
    const meta =
      '高云 ' + n0(r.m.high) + '% · 中云 ' + n0(r.m.mid) + '% · 低云 ' + n0(r.m.low) +
      '% · AOD ' + fx(r.m.aod) + ' · 通透 ' + r.clarity + ' · 云隙光 ' + r.rays
    ctx.fillText(fit(ctx, meta, inner - 320), pad + 100, y + 88)

    /* 分数 */
    ctx.textAlign = 'right'
    setFont(ctx, '700', 54)
    ctx.fillStyle = lc
    ctx.fillText(String(r.score), W - pad - 96, y + 68)
    setFont(ctx, '500', 23, '2px')
    ctx.fillStyle = p.text2
    ctx.fillText(r.level.name, W - pad - 24, y + 64)
    ctx.textAlign = 'left'

    y += rowH
  })

  /* 二维码区 */
  const qy = Math.min(y + 20, H - 300)
  const qh = 200
  panel(ctx, pad, qy, inner, qh, 20, p)
  const qrSize = 140
  drawQR(ctx, d.url, pad + 20, qy + 30, qrSize, p.qrFg)

  ctx.textAlign = 'left'
  setFont(ctx, '600', 24)
  ctx.fillStyle = p.text
  ctx.fillText('扫码看全部 ' + (d.provName ?? '海南') + ' 机位', pad + 20 + qrSize + 22, qy + 74)
  setFont(ctx, '400', 19)
  ctx.fillStyle = p.muted
  ctx.fillText('逐层云种 · 四机会指数 · 各模式怎么看', pad + 20 + qrSize + 22, qy + 106)

  const q2x = W - pad - 20 - qrSize
  if (wxQR) {
    ctx.save()
    roundRect(ctx, q2x, qy + 30, qrSize, qrSize, 16)
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(q2x, qy + 30, qrSize, qrSize)
    ctx.drawImage(wxQR, q2x, qy + 30, qrSize, qrSize)
    ctx.restore()
  }
  ctx.textAlign = 'center'
  setFont(ctx, '400', 18)
  ctx.fillStyle = p.muted
  ctx.fillText('关注公众号', q2x + qrSize / 2, qy + 190)
  ctx.textAlign = 'left'

  /* 底栏 */
  ctx.fillStyle = p.line
  ctx.fillRect(pad, H - 46, inner, 1)
  setFont(ctx, '400', 19)
  ctx.fillStyle = p.muted
  ctx.fillText('数据 ' + d.updatedText + ' · 仅供参考', pad, H - 16)
  ctx.textAlign = 'right'
  ctx.fillText('hainan-n-mspa.pages.dev', W - pad, H - 16)
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

function clarityWord(v: number): string {
  return v >= 85 ? '水晶天' : v >= 70 ? '玻璃天' : v >= 55 ? '通透' : v >= 40 ? '一般' : '发灰'
}
function raysWord(v: number): string {
  return v >= 70 ? '很可能' : v >= 45 ? '有机会' : v >= 25 ? '可蹲一蹲' : '基本没有'
}
function pillarWord(v: number): string {
  return v >= 55 ? '光柱很可能' : v >= 35 ? '有机会' : v >= 20 ? '看运气' : '基本没有'
}
function rainbowWord(v: number): string {
  return v >= 60 ? '彩虹窗口' : v >= 35 ? '可能有虹' : v >= 15 ? '概率低' : '无'
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
