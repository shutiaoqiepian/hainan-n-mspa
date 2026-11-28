/**
 * 名片绘制：从旧版 assets/main.js 的 siteBase / roundRect / drawQR / drawCard 逐行移植。
 * 只做 UTF-8 类型化，绘制顺序、坐标、颜色、字号一律不动。
 *
 * 2026-11-29 改动：
 *   · 作品从「最多 3 张、统一拉伸到 290px 高」换成 drawCollage —— 按原比例摆放，
 *     1–3 张竖排大图、4 张以上四列分栏，横竖图都不再裁切；
 *   · 上限提到 16 张；顺序按横竖交替重排，避免整块看起来是平的；
 *   · 名字字号 82→78；拼贴区放大到 448–918（470 高），二维码 250→206；
 *   · 页头纵向间距压紧（品牌 132→120、副标 174→164、名字 330→286），
 *     右上角不留标记，页头只保留左侧两行文字。
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

/** 横竖交替：同比例的图挨在一起，整块看着是平的，高低错落才像排版 */
function interleave(list: readonly HTMLImageElement[]): HTMLImageElement[] {
  const tall: HTMLImageElement[] = []
  const wide: HTMLImageElement[] = []
  list.forEach((im) => (im.height > im.width ? tall : wide).push(im))

  const out: HTMLImageElement[] = []
  let ti = 0
  let wi = 0
  while (ti < tall.length || wi < wide.length) {
    if (wi < wide.length) out.push(wide[wi++])
    if (ti < tall.length) out.push(tall[ti++])
  }
  return out
}

/**
 * 作品拼贴：一律按原图宽高比摆放，不裁切（旧版把 3 张统一拉到 290px 高，
 * 横图被裁掉两侧、竖图被压扁）。
 *
 *   1–3 张：竖排大图，每张占满整宽、高度按比例算；总高超出区域就整体等比缩到装下，
 *           不足则上下居中 —— 作品少的时候让它当主角，而不是缩在角落留一大片空。
 *   4 张以上：四列。先把素材轮转分配到各列（每轮补当前最矮的一列），再把每列
 *           整体等比缩到区域高度 —— 四列底部齐平，同一列共用一个缩放系数，
 *           不会出现「一张大图配一条小图」。四列列宽 222，横图 148 高、竖图 317 高，
 *           一列通常排得下 2–3 张，整张名片 8–12 张。
 *
 * 张数由排版决定：列装满就停，不写死上限；函数返回实际排进去的张数，
 * 标题那行「名片 N 张」据此写，避免嘴上说 40 张、画面上只有 8 张。
 */
function drawCollage(
  ctx: CanvasRenderingContext2D,
  shots: readonly HTMLImageElement[],
  x: number,
  y: number,
  w: number,
  h: number
): number {
  const gap = 8
  const ordered = interleave(shots.filter((im) => im.width > 0 && im.height > 0).slice(0, 16))
  if (!ordered.length) return 0

  if (ordered.length <= 3) {
    const heights = ordered.map((im) => w / (im.width / im.height))
    const total = heights.reduce((sum, v) => sum + v, 0) + gap * (ordered.length - 1)
    const scale = total > h ? h / total : 1
    let cursorY = y + (h - total * scale) / 2

    ordered.forEach((im, i) => {
      const boxW = w * scale
      const boxH = heights[i] * scale
      const boxX = x + (w - boxW) / 2
      ctx.save()
      roundRect(ctx, boxX, cursorY, boxW, boxH, 12)
      ctx.clip()
      ctx.drawImage(im, boxX, cursorY, boxW, boxH)
      ctx.restore()
      cursorY += boxH + gap * scale
    })
    return ordered.length
  }

  const cols = 4
  const colW = (w - gap * (cols - 1)) / cols

  /** 一列按列宽等比铺开时的自然总高 */
  const stackHeight = (list: HTMLImageElement[]): number =>
    list.reduce((sum, im) => sum + colW / (im.width / im.height), 0) +
    gap * Math.max(0, list.length - 1)

  /* 先把素材分到四列：每轮补当前最矮的一列，直到四列都接近填满。
     先分好再统一缩放，同一列里的图共用一个系数，大小才一致 ——
     按「剩余高度」逐张缩的做法会让一列里出现一张大图配一条小图。 */
  const groups: HTMLImageElement[][] = []
  for (let i = 0; i < cols; i++) groups.push([])

  /** 这一列还能不能再塞这张：一列只放一张竖图，且塞完不能高得离谱 */
  const canPlace = (list: HTMLImageElement[], im: HTMLImageElement): boolean => {
    if (im.height > im.width && list.some((x) => x.height > x.width)) return false
    return stackHeight([...list, im]) <= h * 1.12
  }

  /* 一轮一列放一张：先保证四列都有内容，再回头补第二、第三张。
     逐张「找最矮列」的写法会让先分到的列叠三张、后面的列只剩一张，
     单张那列缩到 317 高居中，上下各留一大块空。 */
  const pool = [...ordered]
  for (let round = 0; round < 4 && pool.length; round++) {
    let progress = false
    for (let c = 0; c < cols && pool.length; c++) {
      const at = pool.findIndex((im) => canPlace(groups[c], im))
      if (at < 0) continue
      groups[c].push(pool[at])
      pool.splice(at, 1)
      progress = true
    }
    if (!progress) break
  }

  /* 整列等比缩到区域高度：四列各自的比例，列底齐平，宽高比一律不变 */
  let placed = 0
  groups.forEach((list, c) => {
    if (!list.length) return

    const natural = list.map((im) => colW / (im.width / im.height))
    const total = natural.reduce((sum, v) => sum + v, 0) + gap * (list.length - 1)
    const scale = Math.min(1, h / total)
    let cursorY = y + (h - total * scale) / 2

    list.forEach((im, i) => {
      const boxH = natural[i] * scale
      const boxW = boxH * (im.width / im.height)
      const boxX = x + c * (colW + gap) + (colW - boxW) / 2
      ctx.save()
      roundRect(ctx, boxX, cursorY, boxW, boxH, 8)
      ctx.clip()
      ctx.drawImage(im, boxX, cursorY, boxW, boxH)
      ctx.restore()
      cursorY += boxH + gap * scale
      placed++
    })
  })

  return placed
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
  ctx.font = '600 28px ' + cardFont
  ctx.letterSpacing = '10px'
  ctx.fillText('18N-MSPA', pad, 120)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = '#79818a'
  ctx.font = '28px ' + cardFont
  ctx.fillText('北纬18度椰青摄联 · 海南', pad, 164)

  /* 名字 */
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 78px ' + cardFont
  const nameY = 286
  ctx.fillText(m.name, pad, nameY)

  /* 头衔 */
  let chipX = pad
  const chipY = nameY + 36
  const titles = m.titles && m.titles.length ? m.titles : []
  if (titles.length) {
    ctx.font = '28px ' + cardFont
    for (const t of titles) {
      const tw = ctx.measureText(t).width + 44
      /* 一排最多排到右边距：头衔一多就宁可少显示一个 */
      if (chipX + tw > W - pad) break
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
    }
  } else {
    ctx.fillStyle = '#6d757c'
    ctx.font = '26px ' + cardFont
    ctx.fillText('摄影爱好者', chipX, chipY + 38)
  }

  /* 拼贴区：448 → 918。先画拼贴、拿到实际排进去的张数，上面那行文案才写得准 */
  const collageY = 448
  const collageH = 470
  const shots = shotImgs || []
  const placed = shots.length ? drawCollage(ctx, shots, pad, collageY, W - pad * 2, collageH) : 0

  /* 作品数：张数按排版定 —— 版面排得下几张就报几张，不拿总库数糊弄 */
  ctx.fillStyle = '#c2c9cf'
  ctx.font = '28px ' + cardFont
  let countText = '作品陆续收录中'
  if (works.length) {
    countText = '已收录 ' + works.length + ' 张'
    if (placed && placed !== works.length) countText += ' · 名片 ' + placed + ' 张'
  }
  ctx.fillText(countText, pad, 414)

  /* 分隔线 */
  const lineY = 934
  const line = ctx.createLinearGradient(pad, 0, W - pad, 0)
  line.addColorStop(0, 'rgba(79,179,232,0.55)')
  line.addColorStop(1, 'rgba(53,214,192,0.06)')
  ctx.fillStyle = line
  ctx.fillRect(pad, lineY, W - pad * 2, 1.5)

  /* 两个二维码 */
  /* 两个二维码都靠右排，左侧留给 logo；三者等高，顶边与底边齐平 */
  const qrSize = 206
  const qrY = 958
  const qrGap = 18
  const rightX = W - pad - qrSize
  const leftX = rightX - qrSize - qrGap

  /* 左侧 logo：整枚保留（图形 + 18N-MSPA / 北纬18度椰青摄联 两行字），等比缩到与二维码同高 */
  if (logo) {
    ctx.drawImage(logo, 477, 327, 444, 596, pad, qrY, Math.round((qrSize * 444) / 596), qrSize)
  }

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
  ctx.textAlign = 'center'
  ctx.fillText('扫码看我的主页', leftX + qrSize / 2, qrY + qrSize + 46)
  ctx.fillText('扫码关注公众号', rightX + qrSize / 2, qrY + qrSize + 46)
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
 * 公众号二维码、logo 水印各只加载一次；作品缩略图最多 16 张（拼贴区能排多少由 drawCollage 决定）。
 * 图片全部回调后才回调 onReady，缺图时照旧跳过不用报错。
 */
export function loadCardImages(
  m: Member,
  onReady: (shots: HTMLImageElement[]) => void
): void {
  const works = worksOf(m.name).slice(0, 16)
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
    const d3 = track()
    const lg = new Image()
    lg.onload = () => {
      logo = lg
      d3()
    }
    lg.onerror = () => {
      d3()
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
