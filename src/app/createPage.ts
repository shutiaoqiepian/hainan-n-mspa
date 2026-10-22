import { createApp, h, type Component } from 'vue'
import AppShell from './AppShell.vue'
import '@/styles/index.css'

export interface PageOptions {
  /** 页脚版权行，不传用默认文案 */
  copyright?: string
  /** 渲染在 </main> 之后、页脚之前的浮层（例如灯箱） */
  afterMain?: Component
  /** 渲染在页脚之后的浮层（例如预报页的反馈弹窗） */
  overlay?: Component
}

/** 每个 HTML 入口都调它：把页面组件挂进全站外壳 */
export function createPage(page: Component, options: PageOptions = {}): void {
  const root = document.getElementById('app')
  if (!root) return

  createApp({
    render: () =>
      h(
        AppShell,
        {
          copyright: options.copyright,
          afterMain: options.afterMain,
          overlay: options.overlay
        },
        { default: () => h(page) }
      )
  }).mount(root)
}
