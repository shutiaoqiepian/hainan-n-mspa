#!/usr/bin/env node
/**
 * 把 src/shells/ 的源 HTML 复制到仓库根目录。
 *
 * 为什么需要：vite 的 `rollupOptions.input` 指向根目录的 `<name>.html`，
 * 但根目录那份**不进 Git**（2026-11-07 起），是纯构建中间产物。
 * 所以 predev / prebuild 都先跑这个脚本，从 src/shells/ 生成入口文件。
 *
 * 现状（2026-11-07 起）：
 *   · 根目录 *.html = 源版本副本，`.gitignore` 的 `/*.html` 已忽略，不用也不能提交
 *   · 构建产物只写 dist/（线上发布源）；publish-root 插件已移除
 *   · 改 <head> / SEO / 标题 → 改 src/shells/，别改根目录（下次 prebuild 会被覆盖回来）
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
console.log(`已把 ${files.length} 个源 HTML 复制到仓库根目录（供 vite 当入口；不进 Git）`)
