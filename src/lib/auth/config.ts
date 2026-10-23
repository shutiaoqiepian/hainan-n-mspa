/**
 * 登录相关配置（预留）
 * ------------------------------------------------------------
 * 现在全站是纯静态站点，没有后端，所以 `AUTH_ENABLED` 为 false：
 * 登录页可以打开、可以看说明，但表单是禁用的，提交也只会提示「尚未开放」。
 *
 * 以后接入真实账号系统时，改这里一处即可：
 *   1. 把 AUTH_ENABLED 改成 true；
 *   2. 在 `lib/auth/session.ts` 的 signIn() 里换成真实接口调用；
 *   3. 别忘了登出与过期处理（见 session.ts 注释）。
 *
 * 想临时在前端预览「已开放」的样子，可以打开控制台执行：
 *   localStorage.setItem('mspa:auth:preview', '1')
 */

const PREVIEW_KEY = 'mspa:auth:preview'

/** 真正的开关：接后端前保持 false */
export const AUTH_ENABLED = false

/** 页面上实际是否按「已开放」渲染（含本地预览开关） */
export function isLaunchEnabled(): boolean {
  if (AUTH_ENABLED) return true
  try {
    return localStorage.getItem(PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}

/** 以后接的接口地址占位，现在用不到 */
export const AUTH_ENDPOINT = '/api/auth/login'
