/* ============================================================
   主题：黑 / 灰 / 白
   ------------------------------------------------------------
   状态存在 <html data-theme="dark|gray|light">，具体颜色全在
   src/styles/base/tokens.css。这里只负责：
     · 启动时读 localStorage（首帧前由 HTML 里的内联脚本兜底，避免白闪）
     · 切换时写回 localStorage、更新 <meta name="theme-color">
     · 给玻璃面做指针跟随（只有鼠标设备才开）
   ============================================================ */

export type ThemeKey = 'dark' | 'gray' | 'light'

export interface ThemeOption {
  key: ThemeKey
  label: string
  /** 浏览器地址栏 / 状态栏颜色 */
  metaColor: string
}

export const THEMES: readonly ThemeOption[] = [
  { key: 'dark', label: '黑', metaColor: '#0c0d0f' },
  { key: 'gray', label: '灰', metaColor: '#1b1d20' },
  { key: 'light', label: '白', metaColor: '#f1f2f4' }
]

const KEY = 'mspa:theme'

function isTheme(v: unknown): v is ThemeKey {
  return v === 'dark' || v === 'gray' || v === 'light'
}

export function currentTheme(): ThemeKey {
  const t = document.documentElement.dataset.theme
  return isTheme(t) ? t : 'dark'
}

function metaTag(): HTMLMetaElement | null {
  return document.querySelector('meta[name="theme-color"]')
}

export function applyTheme(key: ThemeKey, persist = true): void {
  document.documentElement.dataset.theme = key

  const opt = THEMES.find((t) => t.key === key) ?? THEMES[0]
  const meta = metaTag()
  if (meta) meta.setAttribute('content', opt.metaColor)

  if (!persist) return
  try {
    localStorage.setItem(KEY, key)
  } catch {
    /* 隐私模式下写不了，忽略即可 */
  }
}

/** 页面挂载时调用：把内联脚本设好的主题补齐 meta 与持久化 */
export function initTheme(): ThemeKey {
  const key = currentTheme()
  applyTheme(key, false)
  return key
}

export function nextTheme(key: ThemeKey): ThemeKey {
  const i = THEMES.findIndex((t) => t.key === key)
  return THEMES[(i + 1) % THEMES.length].key
}

/* ---------- 液态玻璃：让高光跟着指针走 ---------- */

const GLASS_SELECTOR =
  '.glass,.card,.step,.member,.fc-row,.fc-timebar,.fcd,.fc-pheno,.fc-note,.fc-refs,.login-card,.login-side,.fc-modes,.theme-switch'

/**
 * 给玻璃面写入 --lg-x / --lg-y（高光位置）。
 * 只在「有鼠标 + 不是 reduce-motion」时启用；触屏设备保持静态高光。
 */
export function useLiquidGlass(): () => void {
  if (typeof window === 'undefined') return () => {}

  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (!fine.matches || calm.matches) return () => {}

  let raf = 0
  let pending: PointerEvent | null = null

  function paint(): void {
    raf = 0
    const e = pending
    pending = null
    if (!e) return
    const el = (e.target as Element | null)?.closest?.(GLASS_SELECTOR)
    if (!(el instanceof HTMLElement)) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const x = ((e.clientX - r.left) / r.width) * 100
    const y = ((e.clientY - r.top) / r.height) * 100
    el.style.setProperty('--lg-x', x.toFixed(1) + '%')
    el.style.setProperty('--lg-y', y.toFixed(1) + '%')
  }

  function onMove(e: PointerEvent): void {
    pending = e
    if (!raf) raf = window.requestAnimationFrame(paint)
  }

  document.addEventListener('pointermove', onMove, { passive: true })

  return () => {
    document.removeEventListener('pointermove', onMove)
    if (raf) window.cancelAnimationFrame(raf)
  }
}
