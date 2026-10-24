/**
 * 复制文本（旧版 copyTextToClipboard / copyText）：
 * 优先用异步剪贴板 API，失败时退回 textarea + execCommand。
 *
 * 微信内置浏览器（X5 / WKWebView）的两个坑：
 *   1. navigator.clipboard 存在但 writeText 会被拒绝（不是安全上下文或不给权限）；
 *   2. 必须同步调用 execCommand('copy') 才有效，不能放在 Promise.then 里
 *      —— 一旦 await 过，用户手势就失效了，X5 会直接返回 false。
 * 所以这里在「有异步 API」时也先别急着 async：
 *   只要 writeText 的 Promise 失败，就立刻同步走 fallback（同一轮事件循环）。
 */

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    /* iOS 上 position:fixed + 透明会让光标跑偏，用 1px 可见但挪出屏幕更稳 */
    ta.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;' +
      'opacity:0;z-index:-1;-webkit-user-select:auto;user-select:auto'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    /* iOS 需要显式选区，否则 select() 有时不打不开选择 */
    try {
      ta.setSelectionRange(0, text.length)
    } catch {
      /* 忽略 */
    }
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** 微信里的复制：先同步试 execCommand（最可靠），失败再交给异步 API */
function wechatCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fallbackCopy(text)) {
      resolve()
      return
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(resolve, () => reject(new Error('copy failed')))
      return
    }
    reject(new Error('copy failed'))
  })
}

function isWeChat(): boolean {
  return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '')
}

export function copyTextSilent(text: string): void {
  if (isWeChat()) {
    void wechatCopy(text).catch(() => {})
    return
  }
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* 忽略，走下面的兜底 */
  }
  fallbackCopy(text)
}

export function copyText(text: string): Promise<void> {
  if (isWeChat()) return wechatCopy(text)

  return new Promise((resolve, reject) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(resolve, () => {
        if (fallbackCopy(text)) resolve()
        else reject(new Error('copy failed'))
      })
      return
    }
    if (fallbackCopy(text)) resolve()
    else reject(new Error('copy failed'))
  })
}
