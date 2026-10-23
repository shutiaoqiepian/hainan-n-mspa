import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { rootStatic } from './tools/plugins/root-static'
import { publishRoot } from './tools/publish-root'

/** 每个 HTML 都是独立入口：多页应用，产物文件名与线上 URL 一一对应 */
const PAGES = ['index', 'about', 'gallery', 'forecast', 'members', 'join', 'login', '404']

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
    ...rootStatic(),
    publishRoot()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    /**
     * 产物放到独立的 dist/，同时也要写一份到仓库根目录——根目录那份是给线上看的。
     * 仓库根目录仍保留源 HTML（含 <head> 元信息），只是构建时被同名的成品覆盖。
     * 这样 Cloudflare Pages 沿用旧配置（无构建命令、输出目录=仓库根）也能发布正确内容。
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
