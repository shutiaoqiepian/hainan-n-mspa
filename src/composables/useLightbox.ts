import { readonly, ref } from 'vue'

/**
 * 灯箱（旧版 initLightbox）：点击作品墙里任意一张图看大图。
 * 单例状态，任何页面里的任意组件都能直接打开。
 *
 * 2026-11-29 起不只是「一张图」：
 *   · 打开时把同一个 .wall 里的图收成一组，支持前后翻页（← / →）
 *   · 每张带 key（photos.ts 的文件名），作品集页据此写 ?p= 深链接
 *   · 打开前记住焦点、关闭后还回去，键盘用户不会「掉」到页首
 */

export interface LightboxItem {
  /** 原图地址，形如 images/xxx.jpg */
  src: string
  /** 图注，取 figure 里的 figcaption 文本 */
  caption: string
  /** 稳定标识，作品集页用文件名，其它场景可为空 */
  key: string
}

interface LightboxState {
  open: boolean
  src: string
  caption: string
  key: string
  /** 当前是这一组的第几张，从 0 起 */
  index: number
  items: readonly LightboxItem[]
}

const EMPTY_ITEMS: readonly LightboxItem[] = []

const state = ref<LightboxState>({
  open: false,
  src: '',
  caption: '',
  key: '',
  index: 0,
  items: EMPTY_ITEMS
})

/** 打开前的焦点，关闭时还回去 */
let returnFocus: HTMLElement | null = null

function applyItem(index: number): void {
  const items = state.value.items
  if (!items.length) return
  const i = ((index % items.length) + items.length) % items.length
  const item = items[i]
  state.value = { ...state.value, src: item.src, caption: item.caption, key: item.key, index: i }
}

/**
 * 打开大图。
 * @param src     原图地址
 * @param caption 图注
 * @param key     稳定标识（作品集页传文件名）
 * @param items   同组的所有图；不传就只显示这一张
 */
export function openLightbox(
  src: string,
  caption = '',
  key = '',
  items: readonly LightboxItem[] = []
): void {
  const list = items.length ? items : [{ src, caption, key }]
  const index = Math.max(
    0,
    list.findIndex((it) => it.key === key && it.src === src)
  )

  /* 只在第一次打开时记焦点：翻页改的是同一层浮层，不该反复覆盖 */
  if (!state.value.open) returnFocus = document.activeElement as HTMLElement | null

  const current = list[index]
  state.value = {
    open: true,
    src,
    /* 图注以传入的为准（缩略图可能没有 figcaption），没有再用同组那份 */
    caption: caption || current?.caption || '',
    key,
    index,
    items: list
  }
  document.body.style.overflow = 'hidden'
}

export function closeLightbox(): void {
  state.value = { open: false, src: '', caption: '', key: '', index: 0, items: EMPTY_ITEMS }
  document.body.style.overflow = ''

  const target = returnFocus
  returnFocus = null
  /* 元素可能已不在文档里（翻分类后重渲染），先确认还能聚焦 */
  if (target && document.contains(target) && typeof target.focus === 'function') target.focus()
}

/** 前后翻页，越过首尾会绕回 */
export function stepLightbox(delta: number): void {
  if (!state.value.open || state.value.items.length < 2) return
  applyItem(state.value.index + delta)
}

export function useLightbox() {
  return { state: readonly(state), openLightbox, closeLightbox, stepLightbox }
}
