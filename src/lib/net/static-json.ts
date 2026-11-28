/**
 * 静态 JSON 的统一取数：先本站，再 jsDelivr 的 GitHub 镜像。
 *
 * 为什么需要镜像：2026-11-28 实测，从国内网络访问 *.pages.dev 会整段时间
 * 取不到东西（直连与代理都超时，连首字节都拿不到），页面因此报
 * 「取不到数据 · Failed to fetch」；同一份文件走 jsDelivr 4 秒内就能取到
 * （海南缓存 879 KB）。镜像不是加速手段，是「主站不通时还能用」的兜底。
 *
 * 顺序：本站 → 镜像；每个源默认重试一次（国内到 pages.dev 的失败多是
 * 链路抖动，重试常能过），全失败才抛错，让调用方回落实时接口。
 */

/** jsDelivr 的仓库镜像前缀。改仓库名/分支时这里一起改。 */
export const STATIC_MIRROR = 'https://cdn.jsdelivr.net/gh/shutiaoqiepian/hainan-n-mspa@main/'

/** 带超时的 fetch：主站不通时浏览器默认会挂很久，不设上限就轮不到下一个源 */
export function fetchWithTimeout(url: string, ms = 9000): Promise<Response> {
  if (typeof AbortController === 'undefined') return fetch(url)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer))
}

/** 依次试本站与镜像，返回第一份解析成功的 JSON */
export async function fetchStaticJson<T>(file: string, triesPerSource = 2): Promise<T> {
  const path = file.replace(/^\.?\//, '')
  const urls = [file, STATIC_MIRROR + path]
  let lastErr: unknown = null
  for (const u of urls) {
    for (let attempt = 0; attempt < triesPerSource; attempt++) {
      try {
        const r = await fetchWithTimeout(u)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return (await r.json()) as T
      } catch (e) {
        lastErr = e
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('取不到数据')
}
