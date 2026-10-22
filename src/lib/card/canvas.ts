/**
 * 名片绘制：从旧版 assets/main.js 的 siteBase / roundRect / drawQR / drawCard 逐行移植。
 * 只做 UTF-8 类型化，绘制顺序、坐标、颜色、字号一律不动。
 */

import qrcode from '@/vendor/qrcode'
import type { Member } from '@/data/members'
import { worksOf } from '@/data/photos'
import { SITE_ORIGIN } from '@/data/site'

const cardFont =
  '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif'

/** vendor/qrcode 关掉了类型检查，这里补一份调用签名 */
interface QRCodeInstance {
  addData(data: string, mode?: string): void
  make(): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}
const createQR = qrcode as unknown as (typeNumber: number, level: string) => QRCodeInstance

/** Chrome 支持 ctx.letterSpacing，lib.dom 里可能还没声明 */
type TextCtx = CanvasRenderingContext2D & { letterSpacing: string }

/** 公众号二维码与 logo 水印只加载一次，对应旧版的 window.__wxQR / window.__logo */
let wxQR: HTMLImageElement | null = null
let logo: HTMLImageElement | null = null

/** 站点根地址（旧版 siteBase）：http(s) 下把结尾的 members(.html) 去掉 */
export function siteBase(): string {
  const u = location.href.split('?')[0].split('#')[0]
  if (/^https?:/.test(u)) return u.replace(/members(\.html)?$/, '')
  return SITE_ORIGIN
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawQR(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number
): void {
  const qr = createQR(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const quiet = 4
  const cell = size / (n + quiet * 2)

  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, size, size, 18)
  ctx.fill()

  ctx.fillStyle = '#0f1114'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(
          x + (c + quiet) * cell,
          y + (r + quiet) * cell,
          Math.ceil(cell) + 0.4,
          Math.ceil(cell) + 0.4
        )
      }
    }
  }
}

export function drawCard(
  cv: HTMLCanvasElement,
  m: Member,
  shotImgs: readonly HTMLImageElement[]
): void {
  const ctx = cv.getContext('2d') as TextCtx | null
  if (!ctx) return
  const W = cv.width
  const H = cv.height
  const works = worksOf(m.name)
  const url = siteBase() + 'members.html#m-' + m.id

  ctx.clearRect(0, 0, W, H)

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0c0e11')
  bg.addColorStop(0.55, '#13161a')
  bg.addColorStop(1, '#0a0c0f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const glow = ctx.createRadialGradient(W * 0.18, H * 0.12, 0, W * 0.18, H * 0.12, W * 0.85)
  glow.addColorStop(0, 'rgba(79,179,232,0.20)')
  glow.addColorStop(1, 'rgba(79,179,232,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const glow2 = ctx.createRadialGradient(W * 0.92, H * 0.05, 0, W * 0.92, H * 0.05, W * 0.6)
  glow2.addColorStop(0, 'rgba(53,214,192,0.14)')
  glow2.addColorStop(1, 'rgba(53,214,192,0)')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, W, H)

  const pad = 84

  ctx.textAlign = 'left'
  ctx.fillStyle = '#8f979f'
  ctx.font = '600 26px ' + cardFont
  ctx.letterSpacing = '10px'
  ctx.fillText('18N-MSPA', pad, 132)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = '#6d757c'
  ctx.font = '22px ' + cardFont
  ctx.fillText('北纬18度椰青摄联 · 海南', pad, 174)

  /* 名字 */
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 82px ' + cardFont
  const nameY = 330
  ctx.fillText(m.name, pad, nameY)

  /* 头衔 */
  let chipX = pad
  const chipY = nameY + 42
  const titles = m.titles && m.titles.length ? m.titles : []
  if (titles.length) {
    ctx.font = '28px ' + cardFont
    titles.forEach((t) => {
      const tw = ctx.measureText(t).width + 44
      ctx.fillStyle = 'rgba(79,179,232,0.16)'
      roundRect(ctx, chipX, chipY, tw, 54, 27)
      ctx.fill()
      ctx.strokeStyle = 'rgba(79,179,232,0.45)'
      ctx.lineWidth = 1.5
      roundRect(ctx, chipX, chipY, tw, 54, 27)
      ctx.stroke()
      ctx.fillStyle = '#a8d8f4'
      ctx.fillText(t, chipX + 22, chipY + 38)
      chipX += tw + 16
    })
  } else {
    ctx.fillStyle = '#6d757c'
    ctx.font = '26px ' + cardFont
    ctx.fillText('摄影爱好者', chipX, chipY + 38)
  }

  /* 作品数 */
  ctx.fillStyle = '#c2c9cf'
  ctx.font = '28px ' + cardFont
  ctx.fillText(works.length ? '已收录作品 ' + works.length + ' 张' : '作品陆续收录中', pad, chipY + 102)

  /* 作品条：最多 3 张 */
  const stripY = 512
  const stripH = 290
  const gap = 16
  const full = W - pad * 2
  const shots = shotImgs || []

  if (shots.length) {
    const n = Math.min(shots.length, 3)
    const sw = (full - gap * (n - 1)) / n
    for (let i = 0; i < n; i++) {
      const sx = pad + i * (sw + gap)
      ctx.save()
      roundRect(ctx, sx, stripY, sw, stripH, 14)
      ctx.clip()
      ctx.drawImage(shots[i], sx, stripY, sw, stripH)
      ctx.restore()
    }
  } else if (logo) {
    const lw = 240
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.drawImage(logo, (W - lw) / 2, stripY + 30, lw, lw)
    ctx.restore()
  }

  /* 分隔线 */
  const lineY = 856
  const line = ctx.createLinearGradient(pad, 0, W - pad, 0)
  line.addColorStop(0, 'rgba(79,179,232,0.55)')
  line.addColorStop(1, 'rgba(53,214,192,0.06)')
  ctx.fillStyle = line
  ctx.fillRect(pad, lineY, W - pad * 2, 1.5)

  /* 两个二维码 */
  const qrSize = 250
  const qrY = 900
  const leftX = pad
  const rightX = W - pad - qrSize

  drawQR(ctx, url, leftX, qrY, qrSize)

  if (wxQR) {
    ctx.save()
    roundRect(ctx, rightX, qrY, qrSize, qrSize, 18)
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(rightX, qrY, qrSize, qrSize)
    ctx.drawImage(wxQR, rightX, qrY, qrSize, qrSize)
    ctx.restore()
  } else {
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, rightX, qrY, qrSize, qrSize, 18)
    ctx.fill()
    ctx.fillStyle = '#8f979f'
    ctx.font = '24px ' + cardFont
    ctx.textAlign = 'center'
    ctx.fillText('公众号二维码', rightX + qrSize / 2, qrY + qrSize / 2)
    ctx.textAlign = 'left'
  }

  ctx.fillStyle = '#8f979f'
  ctx.font = '24px ' + cardFont
  ctx.fillText('扫码看我的主页', leftX, qrY + qrSize + 46)
  ctx.textAlign = 'right'
  ctx.fillText('扫码关注公众号', rightX + qrSize, qrY + qrSize + 46)
  ctx.textAlign = 'left'

  /* 底部 */
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, H - 128)
  ctx.lineTo(W - pad, H - 128)
  ctx.stroke()

  ctx.fillStyle = '#6d757c'
  ctx.font = '22px ' + cardFont
  ctx.fillText('hainan-n-mspa.pages.dev', pad, H - 78)

  ctx.textAlign = 'right'
  ctx.fillText('18°N · HAINAN', W - pad, H - 78)
  ctx.textAlign = 'left'
}

/**
 * 名片用图的预加载（旧版 openCard 里的 pending/ready 计数）：
 * 公众号二维码、logo 水印各只加载一次；作品缩略图最多 3 张。
 * 图片全部回调后才回调 onReady，缺图时照旧跳过不用报错。
 */
export function loadCardImages(
  m: Member,
  onReady: (shots: HTMLImageElement[]) => void
): void {
  const works = worksOf(m.name).slice(0, 3)
  const shots: HTMLImageElement[] = []
  let pending = 0
  let ready = false

  const finish = (): void => {
    if (ready) return
    ready = true
    onReady(shots)
  }

  const track = (): (() => void) => {
    pending++
    return () => {
      pending--
      if (pending === 0) finish()
    }
  }

  /* 公众号二维码 */
  if (!wxQR) {
    const d1 = track()
    const wx = new Image()
    wx.onload = () => {
      wxQR = wx
      d1()
    }
    wx.onerror = () => {
      d1()
    }
    wx.src = 'images/二维码.jpg'
  }

  /* logo 水印 */
  if (!logo) {
    const d2 = track()
    const lg = new Image()
    lg.onload = () => {
      logo = lg
      d2()
    }
    lg.onerror = () => {
      d2()
    }
    lg.src = 'images/mspa透明底.png'
  }

  /* 作品缩略图 */
  if (works.length) {
    works.forEach((w) => {
      const d = track()
      const im = new Image()
      im.onload = () => {
        shots.push(im)
        d()
      }
      im.onerror = () => {
        d()
      }
      im.src = 'images/thumbs/' + w.f
    })
  }

  if (pending === 0) finish()
}
