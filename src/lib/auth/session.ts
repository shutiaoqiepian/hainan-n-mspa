/**
 * 会话占位（预留）
 * ------------------------------------------------------------
 * 现在没有后端，所以这里**不做任何校验、不发任何请求**。
 * 等以后接入真实账号系统时，把 signIn() 换成真实接口即可，
 * 其余代码（页面、组件）都不用改。
 *
 * 接后端时需要注意的三件事（先记在这里，免得将来踩坑）：
 *   1. 不要把密码写进 localStorage —— 只存服务端签发的 token，
 *      并且最好是 HttpOnly Cookie（JS 读不到，XSS 偷不走）；
 *   2. 一定要做过期与登出：token 有有效期，登出时让服务端作废；
 *   3. 静态站点要放 `/api/*`，需要在 Cloudflare Pages 里配 Functions
 *      或反代到别的服务，否则接口不存在。
 */

import { AUTH_ENABLED, AUTH_ENDPOINT } from './config'

export interface Session {
  /** 登录后的显示名（现在是占位） */
  name: string
  /** 签发时间 */
  at: number
}

const SESSION_KEY = 'mspa:session'

export interface SignInResult {
  ok: boolean
  message: string
}

/**
 * 预留：现在一律返回「尚未开放」，并且**不保存任何东西**。
 */
export async function signIn(account: string, password: string): Promise<SignInResult> {
  if (!AUTH_ENABLED) {
    /* 参数保留给将来的实现，这里刻意不用它们 */
    void account
    void password
    return { ok: false, message: '登录功能尚未开放，暂时不需要账号' }
  }

  /* ↓ 以下是接后端时的骨架，现在不会执行到 */
  void AUTH_ENDPOINT
  return { ok: false, message: '尚未接入账号服务' }
}

/** 读当前会话：没有就当未登录 */
export function currentSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    return s && typeof s.at === 'number' ? s : null
  } catch {
    return null
  }
}

/** 登出：清掉本地会话（接后端后还要通知服务端作废 token） */
export function signOut(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* 忽略：隐私模式下可能不允许写 */
  }
}
