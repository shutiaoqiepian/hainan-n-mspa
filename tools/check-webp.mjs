/**
 * 检查每张作品都有 WebP 缩略图。
 *
 * 作品墙用 <picture> 优先取 images/thumbs-webp 与 images/thumbs-400-webp，
 * 这两份由 tools/make-webp.py 生成。新增照片忘了跑脚本时，页面会退回 JPG
 * （体积大一倍）而不是裂图，所以只提示、不阻断构建。
 *
 *   node tools/check-webp.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['images/thumbs-webp', 'images/thumbs-400-webp']

const source = readFileSync(join(ROOT, 'src/data/photos.ts'), 'utf8')
const names = [...source.matchAll(/f:\s*'([^']+)'/g)].map((m) => m[1])
if (!names.length) {
  console.error('没从 src/data/photos.ts 里读到任何照片')
  process.exit(1)
}

let missing = 0
for (const dir of DIRS) {
  const gone = names.filter((f) => !existsSync(join(ROOT, dir, f.replace(/\.(jpe?g|png)$/i, '.webp'))))
  if (gone.length) {
    missing += gone.length
    console.error(`✗ ${dir} 缺 ${gone.length} 张：`)
    gone.forEach((f) => console.error('   ' + f))
  } else {
    console.log(`✓ ${dir} 齐全（${names.length} 张）`)
  }
}

if (missing) {
  console.error('\n跑一次 python tools/make-webp.py 补上；缺的图会退回 JPG，页面不会裂。')
  process.exit(1)
}
