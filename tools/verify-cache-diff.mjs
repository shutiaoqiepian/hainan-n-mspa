/**
 * 验证「同一份数据重写一遍，文件逐字节不变」。
 *
 *   node tools/verify-cache-diff.mjs
 *
 * 为什么重要：缓存每次生成都会重写整份文件。如果排版不稳定
 * （字段顺序随机、数字格式飘、行尾 CRLF 之类），
 * 就会造成「数据没变但整个文件都算改了」——git 历史白白膨胀，diff 也没法看。
 * 这条测试保证：读出来再写回去，一个字节都不差。
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { writeCacheFile, outPath, OUT_DIR } from './shared/json-io.mjs'

const provs = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))

const backup = new Map()
for (const p of provs) backup.set(p, readFileSync(outPath(p), 'utf8'))

let bad = 0
let totalLines = 0

for (const p of provs) {
  const before = backup.get(p)
  const payload = JSON.parse(before)
  await writeCacheFile(p, payload)
  const after = readFileSync(outPath(p), 'utf8')
  totalLines += before.split('\n').length
  if (before !== after) {
    const a = before.split('\n')
    const b = after.split('\n')
    let first = -1
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { first = i; break }
    }
    console.log('[不一致] ' + p + '：第一处差异在第 ' + (first + 1) + ' 行')
    if (first >= 0) {
      console.log('  原: ' + String(a[first]).slice(0, 120))
      console.log('  新: ' + String(b[first]).slice(0, 120))
    }
    bad++
  }
}

console.log('')
console.log('检查 ' + provs.length + ' 个省、' + totalLines + ' 行')
if (bad) {
  console.log('❌ ' + bad + ' 个省的排版不稳定 —— 会导致「数据没变但文件全变」')
  process.exit(1)
}
console.log('✅ 读出来再写回去，逐字节一致')
