import { readonly, ref } from 'vue'

/**
 * 灯箱（旧版 initLightbox）：点击作品墙里任意一张图看大图。
 * 单例状态，任何页面里的任意组件都能直接打开。
 */

interface LightboxState {
  open: boolean
  src: string
  caption: string
}

const state = ref<LightboxState>({ open: false, src: '', caption: '' })

export function openLightbox(src: string, caption = ''): void {
  state.value = { open: true, src, caption }
  document.body.style.overflow = 'hidden'
}

export function closeLightbox(): void {
  state.value = { open: false, src: '', caption: '' }
  document.body.style.overflow = ''
}

export function useLightbox() {
  return { state: readonly(state), openLightbox, closeLightbox }
}
