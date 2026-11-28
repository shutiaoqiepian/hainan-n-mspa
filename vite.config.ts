import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { rootStatic } from './tools/plugins/root-static'

/** 每个 HTML 都是独立入口：多页应用，产物文件名与线上 URL 一一对应 */
const PAGES = ['index', 'about', 'gallery', 'forecast', 'members', 'join', 'login', '404', 'cross']

/**
 * 入口路径必须与 Vite 的 root 同源，都用 process.cwd() 派生。
 *
 * 原来写的是 fileURLToPath(new URL(`./${name}.html`, import.meta.url))，
 * 它给出的盘符字母是大写（C:，来自 file:///C:/...）；而 Vite 的 config.root
 * 默认取 process.cwd()，在 Git Bash 下盘符是小写（c:）。
 * Vite 的 html-inline-proxy 用「字符串 replace(normalizePath(root), '')」算缓存键：
 * 写入时键是 '/index.html'，读取时因为大小写对不上替换失败、键变成整条绝对路径，
 * 于是加载内联 <style> 报 "No matching HTML proxy module found"。
 * Linux（Cloudflare Pages）没有盘符，所以线上构建一直正常，只有本地 Git Bash 会中招。
 */
const ROOT = process.cwd().replace(/^[a-zA-Z]:/, (d) => d.toUpperCase())

export default defineConfig({
  base: '/',
  root: ROOT,
  plugins: [
    vue({
      template: {
        // images/... 保持字面量，交给根目录静态资源直通（否则会多出一份带哈希的副本，
        // /images/* 的缓存头与首屏 preload 都会对不上）
        transformAssetUrls: false,
        compilerOptions: {
          // 旧站是手写 HTML，文本节点里的换行与缩进会被原样保留。
          // Vue 默认 whitespace:'condense' 会把它们压成一个空格，
          // 在小数行高 + 毛玻璃背景的卡片上会挪动 1px 栅格化位置（实测量到像素差）。
          whitespace: 'preserve'
        }
      }
    }),
    ...rootStatic()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    /**
     * 产物只放 dist/。线上 Cloudflare Pages 跑 npm run build 后发布 dist/
     * （2026-11-07 线上实测确认：只有 dist 里存在的文件能访问到）。
     *
     * 仓库根目录的 *.html 只是「构建入口的临时副本」：prebuild 的 restore-shells
     * 从 src/shells/ 复制过来，供下面 rollupOptions.input 当入口用。
     * 它们**不进 Git**（.gitignore 已忽略），也不再被产物覆盖
     * （2026-11-07 移除了 publish-root 插件，见交接文档第 5 章）。
     */
    assetsDir: 'assets',
    target: 'es2020',
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((name) => [name, resolve(ROOT, `${name}.html`)]))
    }
  }
})
