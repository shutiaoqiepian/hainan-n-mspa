/**
 * 站点体检：一条命令回答「现在的托管方式还能撑多久、内容还缺什么」。
 *
 * 只读本地仓库与 git，不发网络请求，结论可复现。
 * 用法：node tools/site-health.mjs
 * 退出码：0 = 正常，1 = 有「危险」项（需要在下次推送前处理）
 *
 * 为什么需要它：站点托在 Cloudflare Pages 免费版，硬上限是
 * 「每月 500 次构建 / 每次部署 20 000 个文件 / 单文件 25 MiB」。
 * 数据管线每天自动提交多次，每次提交都会触发一次整站构建 ——
 * 这个数只有看 git 才知道，界面不会提前警告。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const BUILD_QUOTA = 500 // Cloudflare Pages 免费版：每月构建次数
const BUILD_WARN = 350
const GIT_WARN_MB = 500
const DIST_WARN_MB = 60
const DIST_FILE_LIMIT = 20000

const rows = []
let danger = 0

function add(level, item, value, note) {
  if (level === 'danger') danger++
  rows.push({ level, item, value, note })
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function mb(bytes) {
  return Math.round(bytes / 1024 / 1024)
}

function du(p) {
  if (!existsSync(p)) return 0
  const st = statSync(p)
  if (st.isFile()) return st.size
  let total = 0
  for (const name of readdirSync(p)) {
    const full = join(p, name)
    const s = statSync(full)
    total += s.isDirectory() ? du(full) : s.size
  }
  return total
}

/* ---------- 1. 构建配额 ---------- */
const commits30 = Number(sh('git', ['log', '--since=30 days ago', '--format=%H']).split('\n').filter(Boolean).length)
const dataCommits30 = Number(
  sh('git', ['log', '--since=30 days ago', '--format=%s']).split('\n').filter((s) => s.startsWith('chore: update')).length
)
const buildLevel = commits30 >= BUILD_QUOTA * 0.96 ? 'danger' : commits30 >= BUILD_WARN ? 'warn' : 'ok'
add(
  buildLevel,
  '近 30 天推送（≈ 构建次数）',
  `${commits30} / ${BUILD_QUOTA}`,
  `其中数据管线 ${dataCommits30} 次；剩 ${BUILD_QUOTA - commits30} 次留给代码改动`
)

/* ---------- 2. 仓库与产物体积 ---------- */
const gitBytes = du(join(ROOT, '.git'))
add(
  gitBytes / 1024 / 1024 >= GIT_WARN_MB ? 'warn' : 'ok',
  '.git 体积',
  `${mb(gitBytes)} MB`,
  '数据文件反复提交是主要来源；超过 1 GB 后 GitHub 会警告、克隆变慢'
)
const distBytes = du(join(ROOT, 'dist'))

function countFiles(p) {
  if (!existsSync(p)) return 0
  let n = 0
  for (const name of readdirSync(p)) {
    const full = join(p, name)
    n += statSync(full).isDirectory() ? countFiles(full) : 1
  }
  return n
}

const hasDist = existsSync(join(ROOT, 'dist'))
const distFiles = hasDist ? countFiles(join(ROOT, 'dist')) : 0
add(
  distFiles > DIST_FILE_LIMIT ? 'danger' : distBytes / 1024 / 1024 >= DIST_WARN_MB ? 'warn' : 'ok',
  'dist 部署',
  hasDist ? `${mb(distBytes)} MB · ${distFiles} 文件` : '未构建',
  `上限 ${DIST_FILE_LIMIT} 文件、单文件 25 MiB；data/obs 已排除在外`
)

/* ---------- 3. 数据口径 ---------- */
const forecastFiles = existsSync(join(ROOT, 'data/forecast'))
  ? readdirSync(join(ROOT, 'data/forecast')).filter((f) => f.endsWith('.json')).length
  : 0
add('ok', '预报缓存文件', `${forecastFiles} 个`, '每省一个，构建时整体进 dist')

/* ---------- 4. 页面元信息 ---------- */
const shells = readdirSync(join(ROOT, 'src/shells')).filter((f) => f.endsWith('.html'))
const pages = shells.filter((f) => f !== '404.html')
const missingMeta = []
for (const f of pages) {
  const s = readFileSync(join(ROOT, 'src/shells', f), 'utf8')
  for (const [key, re] of [
    ['title', /<title>.+<\/title>/],
    ['description', /name="description"/],
    ['canonical', /rel="canonical"/],
    ['og:image', /property="og:image"/]
  ]) {
    if (!re.test(s)) missingMeta.push(`${f}:${key}`)
  }
}
add(
  missingMeta.length ? 'warn' : 'ok',
  '页面元信息',
  missingMeta.length ? `${missingMeta.length} 处缺失` : `${pages.length} 页齐全`,
  missingMeta.length ? missingMeta.join('、') : 'title / description / canonical / og:image'
)

const rawDomain = shells.filter((f) => readFileSync(join(ROOT, 'src/shells', f), 'utf8').includes('pages.dev')).length
add(
  rawDomain ? 'warn' : 'ok',
  '域名硬编码',
  `${rawDomain} 个页面写死了域名`,
  rawDomain ? '应改用 %VITE_SITE_ORIGIN%，否则换域名要逐页改' : '全部走 .env 的 VITE_SITE_ORIGIN'
)

/* ---------- 5. 作品完整性 ---------- */
const photoSrc = readFileSync(join(ROOT, 'src/data/photos.ts'), 'utf8')
const photos = [...photoSrc.matchAll(/\{ f: '([^']*)', t: '([^']*)', c: '([^']*)', a: '([^']*)' \}/g)].map((m) => ({
  f: m[1],
  t: m[2],
  c: m[3],
  a: m[4]
}))
const noFile = photos.filter((p) => !existsSync(join(ROOT, 'images', p.f)))
const noThumb = photos.filter((p) => !existsSync(join(ROOT, 'images/thumbs', p.f)))
const noTitle = photos.filter((p) => !p.t)
const noAuthor = photos.filter((p) => !p.a)
const categories = new Set(photos.map((p) => p.c).filter(Boolean))
add(
  noFile.length ? 'danger' : noThumb.length ? 'warn' : 'ok',
  '作品文件',
  `${photos.length} 条`,
  noFile.length ? `原图缺失：${noFile.map((p) => p.f).join('、')}` : noThumb.length ? `缩略图缺失 ${noThumb.length} 张` : '原图与缩略图齐全'
)
add(
  noTitle.length || noAuthor.length ? 'warn' : 'ok',
  '作品元数据',
  `无标题 ${noTitle.length} · 无署名 ${noAuthor.length}`,
  `${categories.size} 个分类在用`
)

/* ---------- 6. 成员 ---------- */
const memberSrc = readFileSync(join(ROOT, 'src/data/members.ts'), 'utf8')
const names = [...memberSrc.matchAll(/name: '([^']*)'/g)].map((m) => m[1])
const dupNames = names.filter((n, i) => names.indexOf(n) !== i)
add(
  dupNames.length ? 'danger' : 'ok',
  '成员表',
  `${names.length} 人`,
  dupNames.length ? `重名：${[...new Set(dupNames)].join('、')}` : '无重名（作品署名按姓名精确匹配）'
)

/* ---------- 输出 ---------- */
const mark = { ok: '正常', warn: '注意', danger: '危险' }
/* 中文按 2 列宽算，否则 padEnd 会把表格排歪 */
const width = (s) =>
  [...s].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0)
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)))
const w1 = Math.max(...rows.map((r) => width(r.item))) + 2
const w2 = Math.max(...rows.map((r) => width(r.value))) + 2
console.log('站点体检 · 18N-MSPA\n')
for (const r of rows) {
  console.log(`[${mark[r.level]}] ${pad(r.item, w1)}${pad(r.value, w2)}${r.note}`)
}
const warns = rows.filter((r) => r.level === 'warn').length
console.log(`\n合计：${danger} 项危险，${warns} 项注意，${rows.length - danger - warns} 项正常。`)
if (danger) process.exit(1)
