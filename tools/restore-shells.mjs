#!/usr/bin/env node
/**
 * 开发用：把 src/shells/ 的源 HTML 复制回仓库根目录。
 *
 * 为什么要这样：根目录的 *.html 是「发布产物」（由 npm run build 覆盖生成），
 * 源文件在 src/shells/。`npm run dev` 需要根目录有入口 HTML，所以先把源拷回去。
 *
 * ⚠️ 拷完根目录的 HTML 就是「源」状态，这种状态**不要提交**，
 *    否则 Cloudflare 直接发布会白屏。提交前务必跑一次 npm run build。
 */
import { copyFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHELLS = join(ROOT, 'src/shells')

const files = (await readdir(SHELLS)).filter((f) => f.endsWith('.html'))
for (const f of files) {
  await copyFile(join(SHELLS, f), join(ROOT, f))
}
console.log(`已把 ${files.length} 个源 HTML 复制到仓库根目录（仅用于 npm run dev）`)
