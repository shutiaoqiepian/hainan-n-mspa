#!/usr/bin/env node
/**
 * 公众号接口权限探针（只读）
 * ------------------------------------------------------------------
 * 用途：个人订阅号的接口权限因号而异，官方文档的「适用范围」表与社区
 * 实测结果经常不一致（draft/add 官方标「公众号 ✔」，但部分号返回 48001）。
 * 只有用你自己的 AppID/AppSecret 实调一次，才能定论。
 *
 * 纪律：**只调只读接口**。不会建草稿、不会上传素材、不会发布、不会改菜单。
 *       所以跑完不会在你的公众号后台留下任何垃圾。
 *       写接口（draft/add、freepublish/submit、material/add_material）一律不探。
 *
 * 用法：
 *   1) 准备凭证，二选一（优先环境变量）：
 *        WX_APPID=wx... WX_SECRET=... node tools/wechat/probe.mjs
 *      或在仓库根建 .secrets/wechat.json（已被 .gitignore 忽略）：
 *        { "appid": "wx...", "secret": "..." }
 *
 *   2) 运行：
 *        node tools/wechat/probe.mjs
 *
 * 凭证从哪拿：
 *   微信开发者平台（https://developers.weixin.qq.com/platform/）→ 我的业务
 *   → 公众号 → 基础信息 → 开发信息。AppSecret 只在重置时显示一次。
 *
 * IP 白名单（必看）：
 *   官方原文：「配置 API IP 白名单后，仅白名单中的 IP 才可调用公众号/服务号
 *   的服务端 API（不局限于参数为 AppSecret 的接口，即通过 AppSecret 或者
 *   access_token 调用服务端接口时，均需将访问来源 IP 设置为白名单）。」
 *   路径：微信开发者平台 → 我的业务 → 公众号 → 基础信息 → 开发信息。
 *   本脚本遇到 40164 时会从 errmsg 里读出你的真实出口 IP 并打印出来，
 *   照那个 IP 加进白名单即可（支持 CIDR，不支持 172.0.0.* 写法）。
 *
 * 退出码：0 = 全部可读通；1 = 有接口无权限或凭证/IP 有问题。
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const API = 'https://api.weixin.qq.com'
const TIMEOUT_MS = 12_000

/* ------------------------------ 宽字符对齐 ------------------------------ */
const isWide = (c) => {
  const x = c.codePointAt(0)
  return (
    (x >= 0x1100 && x <= 0x115f) ||
    (x >= 0x2e80 && x <= 0xa4cf) ||
    (x >= 0xac00 && x <= 0xd7a3) ||
    (x >= 0xf900 && x <= 0xfaff) ||
    (x >= 0xfe30 && x <= 0xfe6f) ||
    (x >= 0xff00 && x <= 0xff60) ||
    (x >= 0xffe0 && x <= 0xffe6)
  )
}
const dw = (s) => [...String(s)].reduce((n, c) => n + (isWide(c) ? 2 : 1), 0)
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - dw(s)))

/* -------------------------------- 凭证 -------------------------------- */
function loadCredentials() {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (appid && secret) return { appid, secret, from: '环境变量 WX_APPID / WX_SECRET' }

  const file = resolve(process.cwd(), '.secrets/wechat.json')
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      if (j.appid && j.secret) return { appid: j.appid, secret: j.secret, from: file }
    } catch (e) {
      console.error(`凭证文件解析失败：${file}\n  ${e.message}`)
      process.exit(1)
    }
  }
  return null
}

/* -------------------------------- 请求 -------------------------------- */
async function call(method, path, { token, query, body } = {}) {
  const qs = new URLSearchParams(query || {})
  if (token) qs.set('access_token', token)
  const url = `${API}${path}${qs.toString() ? '?' + qs : ''}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return { http: res.status, raw: text.slice(0, 300), parseError: true }
    }
    return { http: res.status, json }
  } catch (e) {
    return { error: e.name === 'AbortError' ? `超时（>${TIMEOUT_MS} ms）` : e.message }
  } finally {
    clearTimeout(timer)
  }
}

/* -------------------------------- 判定 -------------------------------- */
const IPHOST = /invalid ip\s+([0-9a-fA-F.:]+)/i

function judge(r) {
  if (r.error) return { state: 'net', note: r.error }
  if (r.parseError) return { state: 'net', note: `非 JSON 响应（HTTP ${r.http}）` }
  const { errcode, errmsg = '' } = r.json
  if (errcode === undefined || errcode === 0) return { state: 'ok', note: '可用' }

  switch (errcode) {
    case 48001:
      return { state: 'denied', note: '48001 该账号无此接口权限' }
    case 40164:
    case 61004: {
      const ip = errmsg.match(IPHOST)?.[1] || '（未能从 errmsg 解析）'
      return { state: 'ip', note: `IP 未加白名单，出口 IP = ${ip}`, ip }
    }
    case 40013:
      return { state: 'auth', note: '40013 AppID 无效' }
    case 40125:
      return { state: 'auth', note: '40125 AppSecret 无效' }
    case 40001:
      return { state: 'auth', note: '40001 access_token 无效或已过期' }
    case 42001:
      return { state: 'auth', note: '42001 access_token 已过期' }
    case 40243:
      return { state: 'auth', note: '40243 AppSecret 已被冻结（去后台解冻）' }
    default:
      return { state: 'other', note: `${errcode} ${errmsg.slice(0, 60)}` }
  }
}

/* ------------------------------ 探测清单 ------------------------------ */
/* 全部只读。写接口一个都不放，避免在真实账号里留垃圾。 */
const PROBES = [
  { name: '微信服务器 IP', method: 'GET', path: '/cgi-bin/get_api_domain_ip', group: '基础' },
  { name: '草稿列表', method: 'POST', path: '/cgi-bin/draft/batchget', body: { offset: 0, count: 1 }, group: '草稿箱' },
  { name: '素材总数', method: 'GET', path: '/cgi-bin/material/get_materialcount', group: '素材' },
  { name: '已发布文章列表', method: 'POST', path: '/cgi-bin/freepublish/batchget', body: { offset: 0, count: 1, no_content: 1 }, group: '发布' },
  { name: '用户列表', method: 'GET', path: '/cgi-bin/user/get', group: '用户' },
  { name: '标签列表', method: 'GET', path: '/cgi-bin/tags/get', group: '用户' },
  { name: '菜单查询', method: 'GET', path: '/cgi-bin/menu/get', group: '菜单' },
]

/* -------------------------------- 主流程 -------------------------------- */
const t0 = Date.now()
const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
console.log(`公众号接口探针   ${stamp}`)
console.log('─'.repeat(72))

const cred = loadCredentials()
if (!cred) {
  console.error('缺少凭证。二选一：')
  console.error('  A. 环境变量：  set WX_APPID=wx...  &&  set WX_SECRET=...  （PowerShell 用 $env:）')
  console.error('  B. 凭证文件：  新建 .secrets/wechat.json，内容 {"appid":"wx...","secret":"..."}')
  console.error('该文件已被 .gitignore 忽略，不会被提交。')
  process.exit(1)
}
console.log(`凭证来源   ${cred.from}`)

// 第一步：换 token。所有接口都靠它，也是最快暴露 IP 白名单问题的地方。
const tk = await call('GET', '/cgi-bin/token', {
  query: { grant_type: 'client_credential', appid: cred.appid, secret: cred.secret },
})
const tkJudge = judge(tk)
if (tkJudge.state !== 'ok') {
  console.log(`access_token  ${tkJudge.note}`)
  if (tkJudge.state === 'ip') {
    console.log('')
    console.log(`>>> 去加白名单：微信开发者平台 → 我的业务 → 公众号 → 基础信息 → 开发信息`)
    console.log(`>>> 把 ${tkJudge.ip} 填进 API IP 白名单，等几分钟生效后重跑本脚本。`)
    console.log('>>> 家庭宽带 IP 会变，变了要重新加。')
  }
  if (tkJudge.state === 'auth') {
    console.log('>>> 检查 AppID / AppSecret 是否正确；AppSecret 只在重置时显示一次，忘了就重置。')
  }
  process.exit(1)
}
const token = tk.json.access_token
console.log(`access_token  已取得（长度 ${token.length}，errcode 0）`)
console.log('─'.repeat(72))

const rows = []
for (const p of PROBES) {
  const r = await call(p.method, p.path, { token, body: p.body })
  rows.push({ ...p, ...judge(r) })
}

const W1 = 22
const W2 = 12
console.log(`${pad('分组', 6)}${pad('接口', W1)}${pad('结果', W2)}说明`)
for (const r of rows) {
  const mark = { ok: '可用', denied: '无权限', ip: 'IP 被拦', auth: '凭证问题', net: '网络异常', other: '未知' }[r.state]
  console.log(`${pad(r.group, 6)}${pad(r.name, W1)}${pad(mark, W2)}${r.note}`)
}

/* -------------------------------- 汇总 -------------------------------- */
const ok = rows.filter((r) => r.state === 'ok').length
const denied = rows.filter((r) => r.state === 'denied').length
const bad = rows.filter((r) => !['ok', 'denied'].includes(r.state)).length

console.log('─'.repeat(72))
console.log(`汇总：可用 ${ok} 项 / 无权限 ${denied} 项${bad ? ` / 异常 ${bad} 项` : ''}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`)
console.log('')
console.log('说明：')
console.log('  · 本脚本不探写接口。发布（freepublish/submit）官方口径是「仅认证」，')
console.log('    个人主体无法微信认证 → 不可用，无需实测。')
console.log('  · 草稿箱（draft/add）官方标「公众号 ✔」，但部分号返回 48001。')
console.log('    这里的「草稿列表」能通，说明 draft/* 这一族大概率可写，但不等价；')
console.log('    真要确认，得实际建一篇草稿再看返回码。')
console.log('  · 已发布文章列表不通，就没法把公众号文章自动同步进站；只能手工维护清单。')

process.exit(bad > 0 ? 1 : 0)
