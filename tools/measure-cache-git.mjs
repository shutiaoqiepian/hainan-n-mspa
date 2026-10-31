/**
 * 量一量缓存更新一次，git 历史涨多少。
 *
 *   node tools/measure-cache-git.mjs
 *
 * 在真 git 仓库里跑 56 轮（= 每天 8 次 × 一周），量对象库的增长。
 * 两种场景都测，因为「实际上涨多少」完全取决于它：
 *   - 乐观：每轮只有约 3 个省的数据变了（Open-Meteo 逐位相同的情况）
 *   - 悲观：每轮 34 个省全部变（数值全都不一样的极端情况）
 *
 * 两个前提：
 *   · generatedAt 每轮必变，所以**每个省的文件每轮都会被重写** —— 这是真实的
 *   · git 会拿新 blob 跟仓库里已有的相似 blob 做 delta 压缩
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { outPath, writeCacheFile } from './shared/json-io.mjs'

const srcDir = path.join(process.cwd(), 'data/forecast')
const files = readdirSync(srcDir).filter((f) => f.endsWith('.json')).sort()

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

function objectsBytes(cwd) {
  const rel = git(cwd, 'rev-parse', '--git-path', 'objects')
  const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel)
  let t = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else t += readFileSync(p).length
    }
  }
  walk(abs)
  return t
}

const base = new Map()
for (const f of files) base.set(f, JSON.parse(readFileSync(path.join(srcDir, f), 'utf8')))

/** 第 r 轮某省的内容。changes > 0 表示这个省的数据也要动 */
function objAt(f, r, changeData) {
  const o = JSON.parse(JSON.stringify(base.get(f)))
  o.generatedAt = new Date(Date.UTC(2026, 10, 1) + r * 3 * 3600 * 1000).toISOString()
  if (changeData) {
    const h = o.weather?.[0]?.hourly
    if (h) {
      const k = Object.keys(h).find((x) => x !== 'time' && Array.isArray(h[x]))
      if (k) h[k][30] = 10 + ((r * 13) % 85)
    }
  }
  return o
}

const ROUNDS = 56

async function run(pessimistic) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cachegit-'))
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'a@b.c')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'core.autocrlf', 'false')
  git(dir, 'config', 'gc.auto', '0')

  const marks = new Map()
  for (let r = 0; r <= ROUNDS; r++) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      /* 乐观：每轮只有 (i + r) % 11 === 0 的省真的换数值，约 3 个省 */
      const changeData = pessimistic ? true : (i + r) % 11 === 0
      const o = objAt(f, r, changeData)
      const tmp = mkdtempSync(path.join(tmpdir(), 'io-'))
      await writeCacheFile(tmp, o)
      writeFileSync(path.join(dir, f), readFileSync(outPath(tmp), 'utf8'))
    }
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'r' + r)
    /* 关键：真仓库会定期 gc/repack，届时 git 才拿新 blob 跟旧 blob 做 delta。
       不 repack 的话每个版本都存整份（这是仓库「还没被 gc」的临时状态）。 */
    if (r % 8 === 0) git(dir, 'repack', '-adf', '--quiet')
    if (r === 0 || r === 8 || r === ROUNDS) marks.set(r, objectsBytes(dir))
  }
  return marks
}

console.log('===== 每天 8 次缓存更新，git 历史涨多少 =====\n')

const opt = await run(false)
console.log('乐观场景（每轮约 3 个省换数值）')
console.log('  全量提交后        ' + (opt.get(0) / 1048576).toFixed(2) + ' MB')
console.log('  1 天后(8 次)      +' + ((opt.get(8) - opt.get(0)) / 1048576).toFixed(2) + ' MB')
console.log('  1 周后(56 次)     +' + ((opt.get(ROUNDS) - opt.get(0)) / 1048576).toFixed(2) + ' MB')
const optDay = (opt.get(ROUNDS) - opt.get(0)) / 7
console.log('  → 每天 ' + (optDay / 1024).toFixed(0) + ' KB，一年 ' + ((optDay * 365) / 1073741824).toFixed(2) + ' GB')

console.log('')
const pes = await run(true)
console.log('悲观场景（每轮 34 个省数值全变）')
console.log('  全量提交后        ' + (pes.get(0) / 1048576).toFixed(2) + ' MB')
console.log('  1 天后(8 次)      +' + ((pes.get(8) - pes.get(0)) / 1048576).toFixed(2) + ' MB')
console.log('  1 周后(56 次)     +' + ((pes.get(ROUNDS) - pes.get(0)) / 1048576).toFixed(2) + ' MB')
const pesDay = (pes.get(ROUNDS) - pes.get(0)) / 7
console.log('  → 每天 ' + (pesDay / 1024).toFixed(0) + ' KB，一年 ' + ((pesDay * 365) / 1073741824).toFixed(2) + ' GB')
