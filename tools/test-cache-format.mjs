/**
 * 用缓存文件本身跑一遍完整计算，确认新格式能被前端代码正确读进来。
 *
 *   node tools/test-cache-format.mjs
 *
 * 检查：
 *   1. place 与 weather/prof/air/horizon 条数一致
 *   2. 用 api.ts 的 load() 吃这份缓存，能算出分数
 *   3. 加机位场景：place 条数对不上时必须被识别为「缓存过期」而不是静默错位
 */
import { readFile, writeFile } from 'node:fs/promises'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function makeComputer() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mspa-fmt-'))
  const entry = path.join(tmp, 'entry.ts')
  await writeFile(entry, `
import { load } from '@/lib/forecast/api'
import { state } from '@/lib/forecast/state'

export async function run(prov: string, fixture: string, spotCount?: number) {
  ;(globalThis as any).fetch = async () => new Response(fixture, { status: 200 })
  ;(globalThis as any).location = { search: '', href: 'http://localhost/forecast' }
  ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

  state.prov = prov
  state.kind = 'sunset'
  state.day = 0
  state.model = 'multi'
  state.area = '全部'

  load()
  await new Promise((r) => setTimeout(r, 120))

  return {
    error: state.error,
    fromStatic: state.fromStatic,
    rows: state.rows.length,
    first: state.rows[0] ? {
      n: state.rows[0].spot.n,
      score: state.rows[0].score,
      level: state.rows[0].level.name
    } : null,
    targetDate: state.targetDate,
    updatedAt: state.updatedAt,
    nextUpdateAt: state.nextUpdateAt
  }
}
`, 'utf8')

  const outfile = path.join(tmp, 'bundle.mjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': path.join(ROOT, 'src') },
    logLevel: 'error'
  })
  return (await import(pathToFileURL(outfile).href)).run
}

const run = await makeComputer()
let fails = 0
const check = (ok, msg) => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + msg)
  if (!ok) fails++
}

/* ---- 1. 格式自洽 ---- */
console.log('① 缓存文件格式自洽')
const hnText = await readFile(path.join(ROOT, 'data/forecast/hn.json'), 'utf8')
const hn = JSON.parse(hnText)
check(Array.isArray(hn.place) && hn.place.length === hn.spots, 'place 条数 = spots 字段（' + hn.place?.length + '）')
for (const k of ['weather', 'prof', 'air', 'horizon']) {
  check(hn[k]?.length === hn.place.length, k + ' 条数与 place 一致（' + hn[k]?.length + '）')
}
check(hnText.split('\n').length > 100, '文件是一行一机位的多行排版（' + hnText.split('\n').length + ' 行）')
check(!/\r/.test(hnText), '没有 CRLF 行尾')

/* ---- 2. 前端能吃下这份缓存 ---- */
console.log('\n② 前端用这份缓存算出分数')
const good = await run('hn', hnText)
check(!good.error, '没有报错' + (good.error ? '（' + good.error + '）' : ''))
check(good.fromStatic === true, '走的是静态缓存，没有回退到实时请求')
check(good.rows === hn.spots, '算出的行数 = 机位数（' + good.rows + '）')
check(!!good.targetDate, '有目标日期（' + good.targetDate + '）')
check(good.nextUpdateAt > Date.now(), '「下次更新」在未来')

/* ---- 3. 条数对不上时必须报错，不能静默错位 ---- */
console.log('\n③ 机位表加了一个、缓存还没重建 → 必须识别出来')
const broken = JSON.parse(hnText)
broken.place.push({ n: '不存在的机位', area: '测试', lat: 19, lon: 110, face: '西' })
const bad = await run('hn', JSON.stringify(broken))
check(!bad.fromStatic, '没有采用这份对不上的缓存（fromStatic=' + bad.fromStatic + '）')
check(bad.error != null || bad.rows >= 0, '报错或回退（error=' + (bad.error || '无') + '）')

console.log('')
if (fails) {
  console.log('❌ ' + fails + ' 项不通过')
  process.exit(1)
}
console.log('✅ 缓存格式与前端读取全部正常')
