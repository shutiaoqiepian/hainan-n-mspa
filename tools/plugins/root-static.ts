import type { Plugin } from 'vite'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

/** 仓库根目录下的大体积静态资源：图片、预报缓存 */
const DIRS = ['images', 'data']
/** 仓库根目录下的单文件静态资源：Cloudflare Pages 头配置、爬虫文件 */
const FILES = ['_headers', 'robots.txt', 'sitemap.xml']

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
}

/**
 * 这些 URL 必须在产物里保持原样。Vite 会把 HTML 里的 images/... 改写成
 * 带哈希的模块资源，那样 /images/* 的 7 天缓存头会失效，首屏 preload 与
 * 实际 <img> 也会指向两份不同的文件（白下 470KB）。
 */
const ATTRS = ['href="', 'src="']
const STATIC_DIRS = ['images/', 'data/']
const ESCAPED = 'https://__mspa_static__/'

function escapeStaticUrls(html: string): string {
  let out = html
  for (const attr of ATTRS) {
    for (const dir of STATIC_DIRS) {
      out = out.split(attr + dir).join(attr + ESCAPED + dir)
    }
  }
  return out
}

/** 让 HTML 里的静态资源引用不被 Vite 改写（必须在 build-html 之前跑） */
function escapePlugin(): Plugin {
  return {
    name: 'mspa:escape-static-urls',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return escapeStaticUrls(html)
      }
    }
  }
}

/** 把上面临时改过的地址还原成原样 */
function restorePlugin(): Plugin {
  return {
    name: 'mspa:restore-static-urls',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.split(ESCAPED).join('')
      }
    }
  }
}

/**
 * 让仓库根目录下的 images/ 与 data/ 保持原位（图片压缩脚本、GitHub Action
 * 写缓存、.gitignore 规则都依赖这些路径），但开发服务器能直接访问、
 * 构建时原样复制进 dist/。
 */
function passthroughPlugin(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'

  return {
    name: 'mspa:root-static',

    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = (req.url || '/').split('?')[0].split('#')[0]
        if (!raw || raw === '/') return next()

        let path: string
        try {
          path = decodeURIComponent(raw)
        } catch {
          return next()
        }

        const wanted =
          DIRS.some((d) => path.startsWith('/' + d + '/')) ||
          FILES.some((f) => path === '/' + f)
        if (!wanted) return next()

        const file = resolve(root, '.' + path)
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
          return next()
        }

        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },

    async closeBundle() {
      for (const dir of DIRS) {
        const from = join(root, dir)
        if (!existsSync(from)) continue
        await cp(from, join(outDir, dir), { recursive: true })
      }
      for (const file of FILES) {
        const from = join(root, file)
        if (!existsSync(from)) continue
        await cp(from, join(outDir, file))
      }
    }
  }
}

export function rootStatic(): Plugin[] {
  return [escapePlugin(), restorePlugin(), passthroughPlugin()]
}
