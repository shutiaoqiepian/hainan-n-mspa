/**
 * 图片保存 / 分享：一个入口，按运行环境选能用的那条路。
 * ------------------------------------------------------------
 * 这张卡最终是要「发到微信群里」的，而各环境能用的保存方式完全不同：
 *
 *   桌面 Chromium / Edge / Safari
 *     → <a download> 直接下载文件，最省事
 *
 *   微信内置浏览器（X5 / WKWebView）
 *     → <a download> 完全无效（点了没反应，也不报错）
 *     → 只能靠长按图片的「保存图片」菜单，所以要把图铺出来让用户长按
 *     → 新版本有 JSSDK 的 wx.previewImage，但需要公众号配置签名，
 *       这里不强依赖它；先试 previewImage，失败就退回「长按提示层」
 *
 *   iOS Safari（非微信）
 *     → 11 起 <a download> 无效；要用 navigator.share 分享文件（用户可存到相册）
 *     → 没有 share 时退回「长按图片 → 存储到照片」
 *
 *   Android Chrome / 各家内置浏览器
 *     → <a download> 大多数能用；不行的话同样退回长按
 *
 * 判断顺序很重要：先问「有没有 share 能力」，再问「是什么浏览器」，
 * 因为「能不能分享」比「是不是微信」更能决定实际行为。
 */

export type SaveOutcome =
  | { kind: 'downloaded'; file: string }
  | { kind: 'shared' }
  | { kind: 'long-press'; reason: string }
  | { kind: 'failed'; reason: string }

interface UA {
  wechat: boolean
  ios: boolean
  android: boolean
  /** 桌面浏览器 */
  desktop: boolean
}

export function detectUA(): UA {
  if (typeof navigator === 'undefined') {
    return { wechat: false, ios: false, android: false, desktop: true }
  }
  const ua = navigator.userAgent || ''
  const wechat = /MicroMessenger/i.test(ua)
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
  const android = /Android/i.test(ua)
  return { wechat, ios, android, desktop: !ios && !android }
}

/** 是不是「点了下载也不会动」的环境 */
export function downloadLikelyBlocked(): boolean {
  const u = detectUA()
  if (u.wechat) return true
  /* iOS 上的 Safari / 各种 WebView：<a download> 在 iOS 11–12 被忽略，
     13+ 虽然支持但经常存到「文件」而不是「照片」，用户找不到 */
  if (u.ios) return true
  return false
}

async function toBlob(cv: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      cv.toBlob((b) => resolve(b), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

function anchorDownload(blob: Blob, file: string): boolean {
  try {
    const a = document.createElement('a')
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = file
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 1500)
    return true
  } catch {
    return false
  }
}

/** 微信里优先用 JSSDK 的 previewImage（用户可长按保存）；没配置就返回 false */
function wechatPreview(dataUrl: string): boolean {
  const wx = (window as unknown as { wx?: { previewImage?: (o: unknown) => void } }).wx
  if (!wx || typeof wx.previewImage !== 'function') return false
  try {
    wx.previewImage({ current: dataUrl, urls: [dataUrl] })
    return true
  } catch {
    return false
  }
}

/**
 * 保存名片。
 * @param cv      已经画好的 canvas
 * @param file    桌面下载用的文件名
 * @param dataUrl 已经生成好的 base64（没有就现场生成，微信预览要用它）
 */
export async function saveCardImage(
  cv: HTMLCanvasElement,
  file: string,
  dataUrl?: string
): Promise<SaveOutcome> {
  const u = detectUA()

  /* ---- 1. 微信：只能长按 ---- */
  if (u.wechat) {
    const url = dataUrl ?? safeDataUrl(cv)
    if (url && wechatPreview(url)) {
      return { kind: 'long-press', reason: '已在微信里打开大图，长按图片即可保存' }
    }
    return { kind: 'long-press', reason: '微信里请长按图片 → 保存图片' }
  }

  const blob = await toBlob(cv)

  /* ---- 2. iOS：用系统分享（可存到照片）---- */
  if (u.ios) {
    const nav = navigator as Navigator & {
      canShare?: (d: ShareData) => boolean
      share?: (d: ShareData) => Promise<void>
    }
    if (blob && nav.share && nav.canShare) {
      const f = new File([blob], file, { type: 'image/png' })
      if (nav.canShare({ files: [f] })) {
        try {
          await nav.share({ files: [f], title: '霞光预报' })
          return { kind: 'shared' }
        } catch (e) {
          /* 用户取消不算失败，但也没保存成功 */
          const err = e as { name?: string }
          if (err && err.name === 'AbortError') {
            return { kind: 'failed', reason: '已取消' }
          }
          /* 继续走长按 */
        }
      }
    }
    return { kind: 'long-press', reason: '请长按图片 → 存储到照片' }
  }

  /* ---- 3. 桌面 / Android：直接下载 ---- */
  if (blob && anchorDownload(blob, file)) {
    return { kind: 'downloaded', file }
  }
  return { kind: 'long-press', reason: '这个浏览器不支持直接下载，请长按图片保存' }
}

function safeDataUrl(cv: HTMLCanvasElement): string {
  try {
    return cv.toDataURL('image/png')
  } catch {
    return ''
  }
}

/** 给「长按保存」用的兜底：把图铺满屏幕，用户长按就能存 */
export function openLongPressViewer(dataUrl: string): void {
  if (typeof document === 'undefined' || !dataUrl) return
  const old = document.getElementById('fc-img-viewer')
  if (old) old.remove()

  const box = document.createElement('div')
  box.id = 'fc-img-viewer'
  box.className = 'fc-img-viewer'
  box.innerHTML =
    '<div class="fv-inner">' +
    '<p class="fv-tip">长按图片 → 保存图片</p>' +
    '<img alt="霞光预报名片" src="' + dataUrl + '">' +
    '<p class="fv-hint">保存后回到微信，发给朋友或发朋友圈</p>' +
    '</div>'

  const close = (): void => {
    box.remove()
    document.removeEventListener('keydown', onKey)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
  box.addEventListener('click', (e) => {
    if (e.target === box) close()
  })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(box)
}
