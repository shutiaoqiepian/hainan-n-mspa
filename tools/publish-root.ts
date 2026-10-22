import type { Plugin } from 'vite'
import { cp, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 与 vite.config.ts 里的 PAGES 一致 */
const PAGES = ['index', 'about', 'gallery', 'forecast', 'members', 'join', '404']
/** 这些目录在仓库根目录本来就是源目录，不要被产物覆盖 */
const SOURCE_DIRS = new Set(['src', 'tools', 'node_modules', 'data', 'images'])

/**
 * 把 dist/ 的产物同步一份到仓库根目录。
 *
 * 为什么需要它：线上 Cloudflare Pages 用的是旧配置——无构建命令、直接发布仓库根目录。
 * 仓库根目录保留的 *.html 是「源文件」（没有打包好的 js/css 引用），
 * 原样发布出去页面会白屏。构建完把成品覆盖回根目录，线上内容就与 dist/ 完全一致，
 * 用户不需要去改 Cloudflare 的任何设置。
 */
export function publishRoot(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'

  async function copyDir(from: string, to: string): Promise<void> {
    await cp(from, to, { recursive: true })
  }

  return {
    name: 'mspa:publish-root',
    apply: 'build',

    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
    },

    async closeBundle() {
      if (resolve(root) === outDir) return

      for (const name of PAGES) {
        const from = join(outDir, name + '.html')
        if (existsSync(from)) await cp(from, join(root, name + '.html'))
      }

      for (const entry of await readdir(outDir)) {
        if (entry.endsWith('.html') || SOURCE_DIRS.has(entry)) continue

        const from = join(outDir, entry)
        const to = join(root, entry)
        const info = await stat(from)

        if (info.isDirectory()) {
          // assets 目录整体替换，旧哈希文件不该留在根目录
          if (existsSync(to)) await rm(to, { recursive: true, force: true })
          await copyDir(from, to)
          continue
        }

        await cp(from, to)
      }
    }
  }
}
