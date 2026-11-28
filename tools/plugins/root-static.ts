import type { Plugin } from 'vite'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

/** 站点地址的占位符，与 .env 里的 VITE_SITE_ORIGIN 对应 */
const ORIGIN_MARK = '%VITE_SITE_ORIGIN%'
/** sitemap.xml 是纯静态 XML，Vite 不会处理它，由插件在复制时替换 */
const SITEMAP_OLD_ORIGIN = 'https://hainan-n-mspa.pages.dev'

/** 仓库根目录下的大体积静态资源：图片、预报缓存 */
const DIRS = ['images', 'data']
/** 仓库根目录下的单文件静态资源：Cloudflare Pages 头配置、爬虫文件、微信域名验证文件 */
const FILES = ['_headers', 'robots.txt', 'sitemap.xml', 'a6809bfbd48060b8861226be0e283f4e.txt']

/**
 * 不发布到线上的子目录。
 * data/obs/ 是「实况存档 + 分数快照」（每天十几 KB 地长），
 * 只有审计脚本会用，访客不需要，也不该占部署体积。
 */
const EXCLUDE_DIRS = ['data/obs']

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
  let siteOrigin = SITEMAP_OLD_ORIGIN

  return {
    name: 'mspa:root-static',

    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
      siteOrigin = (config.env.VITE_SITE_ORIGIN || '').replace(/\/+$/, '')
      /* 构建时必须有值：占位符留在页面上，搜索引擎会把整页当脏数据丢掉，
         而且不会报错，只有收录消失后才发现 —— 宁可构建失败。 */
      if (config.command === 'build' && !siteOrigin) {
        throw new Error('[root-static] 缺少 VITE_SITE_ORIGIN：请在仓库根目录的 .env 里配置站点地址')
      }
      if (!siteOrigin) siteOrigin = SITEMAP_OLD_ORIGIN
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
        await cp(from, join(outDir, dir), {
          recursive: true,
          /* data/obs 只在本地/仓库里，不进部署产物 */
          filter: (src) => {
            const rel = relative(root, src).split(sep).join('/')
            return !EXCLUDE_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))
          }
        })
      }
      /* 有些 Node 版本即使 filter 返回 false 也会把目录建出来，这里兜底删掉 */
      for (const d of EXCLUDE_DIRS) await rm(join(outDir, d), { recursive: true, force: true })
      for (const file of FILES) {
        const from = join(root, file)
        if (!existsSync(from)) continue
        await cp(from, join(outDir, file))
      }

      /* sitemap.xml 与 robots.txt 不受 Vite 的 %ENV% 替换影响，单独把域名换掉 */
      for (const file of ['sitemap.xml', 'robots.txt']) {
        const p = join(outDir, file)
        if (!existsSync(p)) continue
        const text = readFileSync(p, 'utf8').split(SITEMAP_OLD_ORIGIN).join(siteOrigin)
        writeFileSync(p, text)
      }

      /* 兜底校验：任何一页还留着占位符，就说明替换没生效，宁可构建失败 */
      const leftovers: string[] = []
      for (const name of ['index', 'about', 'gallery', 'forecast', 'members', 'join', 'login', 'cross']) {
        const p = join(outDir, name + '.html')
        if (!existsSync(p)) continue
        const html = readFileSync(p, 'utf8')
        if (html.includes(ORIGIN_MARK)) leftovers.push(name + '.html（占位符未替换）')
        /* 配了新域名却还编译出旧域名 —— 只可能是根目录那份入口副本没刷新，
           也就是漏跑了 prebuild 的 restore-shells，直接构建会静默发出错页 */
        else if (siteOrigin !== SITEMAP_OLD_ORIGIN && html.includes(SITEMAP_OLD_ORIGIN)) {
          leftovers.push(name + '.html（仍是旧域名，请用 npm run build）')
        }
      }
      if (leftovers.length) {
        throw new Error('[root-static] 页面地址未按 .env 生成：' + leftovers.join('、'))
      }
    }
  }
}

export function rootStatic(): Plugin[] {
  return [escapePlugin(), restorePlugin(), passthroughPlugin()]
}
