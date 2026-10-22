import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { rootStatic } from './tools/plugins/root-static'

/** 每个 HTML 都是独立入口：多页应用，产物文件名与线上 URL 一一对应 */
const PAGES = ['index', 'about', 'gallery', 'forecast', 'members', 'join', '404']

export default defineConfig({
  base: '/',
  plugins: [
    // 模板里的 images/... 一律保持字面量，交给根目录静态资源直通，
    // 不要被当成模块引入（否则会复制一份带哈希的图，且缓存头对不上）
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
    assetsDir: 'assets',
    target: 'es2020',
    rollupOptions: {
      input: Object.fromEntries(
        PAGES.map((name) => [name, fileURLToPath(new URL(`./${name}.html`, import.meta.url))])
      )
    }
  }
})
