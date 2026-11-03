/**
 * 数据缺口自动上报：有缺口就开一条 GitHub Issue，没有缺口就把旧的关掉。
 *
 *   node tools/report-gaps.mjs              # 正常跑（CI 用）
 *   node tools/report-gaps.mjs --dry        # 只打印要做什么，不碰 GitHub
 *
 * 为什么要有它：
 *   2026-10-31 起快照脚本因为一个 const/let 笔误每天崩，连崩 3 天没人发现。
 *   check-gaps.mjs 其实每天都在报「缺预报快照」，但它只是 tee 进 run summary，
 *   workflow 还写着 continue-on-error: true —— 崩了 Actions 依然是绿的，没人会点开看。
 *   结论：光有自检不够，还得让「有缺口」这件事主动找人。
 *
 * 规矩：
 *   1) 同一天最多开一条 Issue（用固定标题去重，重复跑不会刷屏）
 *   2) 缺口全消失时自动关闭该 Issue —— 否则会攒一堆「已解决但没人关」的
 *   3) 没有 GITHUB_TOKEN（本地手动跑）时只打印，不报错
 *
 * 需要的权限：issues: write（workflow 里已声明）
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TITLE = '🔴 数据链路有缺口（自动上报）'
const LABEL = 'data-gap'

const dry = process.argv.includes('--dry')

/**
 * 跑 check-gaps 拿输出与结论。
 * ★ 必须带 --strict：普通模式即使有缺口也是 exit 0，
 *   靠退出码判断会永远拿到「无缺口」（这个坑我第一版就踩了）。
 */
function runGaps() {
  try {
    const out = execFileSync(process.execPath, ['tools/check-gaps.mjs', '--strict'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { out, hasGap: false }
  } catch (e) {
    return { out: ((e.stdout || '') + (e.stderr || '')).trim(), hasGap: true }
  }
}

/** 用 gh 的前提：有 token。没有就用 REST API 走 fetch（不依赖 gh 是否安装） */
function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
}

function repoSlug() {
  const r = process.env.GITHUB_REPOSITORY
  if (r && /^[^/]+\/[^/]+$/.test(r)) return r
  /* 本地：从 git remote 推出来，省得每次手动设 */
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/)
    if (m) return m[1] + '/' + m[2]
  } catch { /* 没有 origin 就算了 */ }
  return ''
}

async function api(method, urlPath, body) {
  const t = token()
  const repo = repoSlug()
  if (!t || !repo) throw new Error('没有 GITHUB_TOKEN 或推不出仓库名，无法调用 GitHub API')
  const res = await fetch('https://api.github.com/repos/' + repo + urlPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + t,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok) throw new Error(method + ' ' + urlPath + ' → HTTP ' + res.status + ' ' + text.slice(0, 300))
  return text ? JSON.parse(text) : null
}

async function findOpen() {
  const list = await api('GET', '/issues?state=open&labels=' + encodeURIComponent(LABEL) + '&per_page=20')
  return (list || []).find((i) => i.title === TITLE) || null
}

/**
 * 保证标签存在。
 * GitHub 的「建 Issue 时带一个不存在的 label」会直接 422 失败 ——
 * 那会让「通知」这件事本身变成新的静默失败源，所以先确保标签在。
 */
async function ensureLabel() {
  try {
    await api('GET', '/labels/' + encodeURIComponent(LABEL))
    return true
  } catch {
    try {
      await api('POST', '/labels', { name: LABEL, color: 'd73a4a', description: '数据链路缺口（自动上报）' })
      console.log('已自动创建 label「' + LABEL + '」')
      return true
    } catch (e) {
      console.log('⚠ 创建 label 失败（' + e.message + '），将不带标签开 Issue')
      return false
    }
  }
}

function bjNow() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + '（北京）'
}

/* ---------- 主流程 ---------- */

const { out, hasGap } = runGaps()

console.log('===== 数据缺口自动上报 =====')
console.log('自检结论：' + (hasGap ? '有缺口' : '无缺口'))
console.log('')

const t = token()
const repo = repoSlug()
if (!t || !repo) {
  console.log('[本地模式] 没有 GITHUB_TOKEN 或仓库名，只打印不汇报。')
  console.log('要真的上报：GITHUB_TOKEN=xxx GITHUB_REPOSITORY=' + (repo || 'owner/repo') + ' node tools/report-gaps.mjs')
  console.log('')
  console.log(out)
  process.exit(0)
}

if (!hasGap) {
  /* 缺口消失 → 关掉旧 Issue */
  let open = null
  try {
    open = await findOpen()
  } catch (e) {
    console.log('⚠ 查不到已有 Issue（可能 token 权限不够）：' + e.message)
    process.exit(0)
  }
  if (open) {
    if (dry) {
      console.log('[dry] 会关闭 Issue #' + open.number)
    } else {
      await api('POST', '/issues/' + open.number + '/comments', {
        body: '✅ ' + bjNow() + ' 自检通过，缺口已消失。自动关闭。\n\n```\n' + out.trim() + '\n```'
      })
      await api('PATCH', '/issues/' + open.number, { state: 'closed' })
      console.log('✅ 已关闭 Issue #' + open.number)
    }
  } else {
    console.log('✅ 无缺口，也没有遗留的 Issue。')
  }
  process.exit(0)
}

/* 有缺口 → 开 Issue（已开就加评论，不重复开） */
const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? process.env.GITHUB_SERVER_URL + '/' + repo + '/actions/runs/' + process.env.GITHUB_RUN_ID
    : ''

const body = [
  '自检发现数据链路缺口。**这个 Issue 由 `tools/report-gaps.mjs` 自动创建**，缺口消失后会自动关闭。',
  '',
  '时间：' + bjNow(),
  runUrl ? '本次运行：[Actions 日志](' + runUrl + ')' : '',
  '',
  '### 自检输出',
  '',
  '```',
  out.trim(),
  '```',
  '',
  '### 怎么处理',
  '',
  '1. 先看上面的清单区分是哪一类缺口（缺快照 / 缺 accuracy / 日期对不上）。',
  '2. **缺快照**：`node tools/snapshot-forecast.mjs` 手跑一遍。',
  '   如果它报错，说明脚本本身坏了——先修脚本，再谈补数据。',
  '3. **缺 accuracy**：`node tools/check-accuracy.mjs --save`。',
  '4. 历史日期通常**补不回来**（快照必须当天算），重点是「下次不再漏」。',
  '5. 修完点一次这个 workflow 的 Run，自检通过后 Issue 会自动关闭。',
  '',
  '> 参考：`交接文档.md` 26.7.4（10-28 丢一天）与 26.9（10-31 起连崩 3 天）。'
]
  .filter(Boolean)
  .join('\n')

let open = null
try {
  open = await findOpen()
} catch (e) {
  console.log('⚠ 查不到已有 Issue：' + e.message)
}

if (dry) {
  console.log('[dry] 会' + (open ? '评论已有 Issue #' + open.number : '新建 Issue') + '：' + TITLE)
  console.log('')
  console.log(out)
  process.exit(0)
}

try {
  if (open) {
    await api('POST', '/issues/' + open.number + '/comments', { body })
    console.log('📝 已有 Issue #' + open.number + '，追加了一条评论（不重复开）')
  } else {
    const hasLabel = await ensureLabel()
    const payload = { title: TITLE, body }
    if (hasLabel) payload.labels = [LABEL]
    const created = await api('POST', '/issues', payload)
    console.log('🔴 已开 Issue #' + created.number + '：' + (created.html_url || ''))
  }
} catch (e) {
  /* 上报失败不能把 workflow 搞绿——要让人看见 */
  console.log('::error::上报失败：' + e.message)
  process.exit(1)
}

console.log('')
console.log(out)
process.exit(0)
