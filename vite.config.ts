import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { rootStatic } from './tools/plugins/root-static'

/** 每个 HTML 都是独立入口：多页应用，产物文件名与线上 URL 一一对应 */
const PAGES = ['index', 'about', 'gallery', 'forecast', 'members', 'join', 'login', '404', 'cross']

export default defineConfig({
  base: '/',
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
      input: Object.fromEntries(
        PAGES.map((name) => [name, fileURLToPath(new URL(`./${name}.html`, import.meta.url))])
      )
    }
  }
})
