/**
 * 全站文案与导航：所有页面的头部、页脚都从这里取，避免七个 HTML 各写一份。
 */

export interface NavItem {
  /** 与 location.pathname 去掉 .html 后的值匹配；首页为空串 */
  key: string
  label: string
  href: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: '', label: '首页', href: 'index.html' },
  { key: 'about', label: '关于', href: 'about.html' },
  { key: 'gallery', label: '作品集', href: 'gallery.html' },
  { key: 'forecast', label: '霞光预报', href: 'forecast.html' },
  { key: 'members', label: '成员', href: 'members.html' },
  { key: 'join', label: '加入我们', href: 'join.html' }
]

export interface FooterLink {
  label: string
  href: string
}

export const FOOTER_LINKS: readonly FooterLink[] = [
  { label: '关于我们', href: 'about.html' },
  { label: '作品集', href: 'gallery.html' },
  { label: '霞光预报', href: 'forecast.html' },
  { label: '成员', href: 'members.html' },
  { label: '加入我们', href: 'join.html' }
]

export const BRAND = {
  latin: '18N-MSPA',
  cn: '北纬18度椰青摄联',
  logo: 'images/mspa透明底.png',
  logoAlt: '18N-MSPA 北纬18度椰青摄联'
} as const

/**
 * 登录页：已经建好但还没开放账号系统，所以先不放进主导航（避免点进去一头雾水）。
 * 以后开通时，把这一项挪进 NAV_ITEMS 即可；页脚先留着入口。
 */
export const NAV_LOGIN: NavItem = { key: 'login', label: '登录', href: 'login.html' }

export const FOOTER_LOCATION = '海南省 · 海口'

/** 大多数页面用的版权行 */
export const COPYRIGHT = '© 2026 北纬18度椰青摄联 18N-MSPA · 保留所有权利'
/** 作品集页单独版本 */
export const COPYRIGHT_GALLERY = '© 2026 北纬18度椰青摄联 18N-MSPA · 作品版权归各摄影师所有'

/** 站点正式地址，用于生成二维码与分享链接 */
export const SITE_ORIGIN = 'https://hainan-n-mspa.pages.dev/'

/**
 * 把当前路径归一成导航 key：/gallery.html → gallery，/ → ''
 * 与旧版 main.js 的 norm() 行为一致。
 */
export function normalizePath(u: string): string {
  let path = String(u || '').split('?')[0].split('#')[0]
  path = path.split('/').pop() ?? ''
  path = path.replace(/\.html$/, '')
  if (path === 'index') path = ''
  return path
}

/** 当前页在导航里的 key */
export function currentNavKey(): string {
  return normalizePath(window.location.pathname)
}
