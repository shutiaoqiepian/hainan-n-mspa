import { ref } from 'vue'

/**
 * 轻提示（旧版 toastMsg / toast）：页面底部浮出一条 2.2 秒后消失。
 * 单例状态：任何组件都能调用 toast()。
 *
 * 两套外观沿用旧版的两种气泡：站点通用的 .site-toast（成员页/首页）与
 * 预报页专用的 .fc-toast（尺寸、阴影、毛玻璃都不同），用 variant 区分。
 * 各自由对应的组件渲染：.site-toast 在 AppShell 里，.fc-toast 在预报页里。
 */

export type ToastVariant = 'site' | 'forecast'

const message = ref('')
const shown = ref(false)
/** 旧版是第一次调用时才往 body 里插入提示元素，这里保持同样的时机 */
const active = ref(false)
const variant = ref<ToastVariant>('site')
let timer = 0

export function toast(text: string, options: { variant?: ToastVariant } = {}): void {
  message.value = text
  shown.value = true
  active.value = true
  variant.value = options.variant ?? 'site'
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    shown.value = false
  }, 2200)
}

export function useToast() {
  return { message, shown, active, variant, toast }
}
