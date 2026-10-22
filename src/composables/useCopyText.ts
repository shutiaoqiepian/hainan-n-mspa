/**
 * 复制文本（旧版 copyTextToClipboard / copyText）：
 * 优先用异步剪贴板 API，失败时退回 textarea + execCommand。
 */

export function copyTextSilent(text: string): void {
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

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
