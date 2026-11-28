<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLightbox, type LightboxItem } from '@/composables/useLightbox'

/**
 * 灯箱（旧版 initLightbox）
 * 事件委托：点任意 .wall 里的 figure 打开大图，点遮罩 / ✕ / Esc 关闭。
 *
 * 2026-11-29 补的几件：
 *   · 同一个 .wall 里的图收成一组，← → 或两侧按钮翻页，底部显示「第几张 / 共几张」
 *   · Tab 锁在浮层里、关闭后焦点还回点开的那张图（键盘用户不会掉到页首）
 *   · 作品集页把当前这张写进 ?p=，发出去的链接能直接打开同一张
 */

const { state, openLightbox, closeLightbox, stepLightbox } = useLightbox()

const dialog = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)

/** 只有作品集页认 ?p=，首页精选不写地址栏 */
function isGalleryPage(): boolean {
  return /(^|\/)gallery(\.html)?$/.test(location.pathname)
}

function syncUrl(key: string): void {
  if (!isGalleryPage()) return
  try {
    const url = new URL(location.href)
    if (key) url.searchParams.set('p', key)
    else url.searchParams.delete('p')
    history.replaceState(history.state, '', url)
  } catch {
    /* file:// 或老浏览器不支持 replaceState：深链接失效，看图本身不受影响 */
  }
}

function itemsOf(fig: HTMLElement): LightboxItem[] {
  const wall = fig.closest('.wall')
  const nodes = wall
    ? Array.from(wall.querySelectorAll<HTMLElement>('figure[data-src]'))
    : [fig]

  return nodes
    .map((node) => ({
      src: node.getAttribute('data-src') ?? '',
      caption: node.querySelector('figcaption')?.textContent?.trim() ?? '',
      key: node.getAttribute('data-key') ?? ''
    }))
    .filter((item) => item.src)
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const fig = target?.closest?.('.wall figure') as HTMLElement | null
  if (!fig) return

  const src = fig.getAttribute('data-src')
  if (!src) return

  event.preventDefault()
  openLightbox(src, fig.querySelector('figcaption')?.textContent?.trim() ?? '', fig.getAttribute('data-key') ?? '', itemsOf(fig))
}

function onKeydown(event: KeyboardEvent): void {
  if (!state.value.open) return

  if (event.key === 'Escape') {
    event.preventDefault()
    closeLightbox()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    stepLightbox(-1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    stepLightbox(1)
    return
  }
  if (event.key === 'Tab') trapFocus(event)
}

/** 浮层里只有「关闭 / 上一张 / 下一张」三个按钮，Tab 在它们之间循环 */
function trapFocus(event: KeyboardEvent): void {
  const buttons = dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled])')
  if (!buttons || buttons.length === 0) return

  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  const active = document.activeElement
  /* 点图之后焦点可能落在浮层外的 body / 图块上，这时 Tab 也必须被拉回来 */
  const outside = !dialog.value?.contains(active)

  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => state.value.open,
  async (open) => {
    if (!open) {
      syncUrl('')
      return
    }
    syncUrl(state.value.key)
    await nextTick()
    closeBtn.value?.focus()
  }
)

/* 深链接进来时 GalleryPage 会在自己 mounted 里先打开，此时本组件的 watch 还没建立 */
watch(
  () => state.value.key,
  (key) => {
    if (state.value.open) syncUrl(key)
  }
)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)

  if (state.value.open) {
    syncUrl(state.value.key)
    void nextTick(() => closeBtn.value?.focus())
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  if (state.value.open) closeLightbox()
})
</script>

<template>
  <div
    id="lightbox"
    ref="dialog"
    class="lightbox"
    :class="{ 'is-open': state.open }"
    role="dialog"
    aria-modal="true"
    aria-label="作品大图"
    @click.self="closeLightbox"
  >
    <button
      id="lightbox-close"
      ref="closeBtn"
      class="lightbox-close"
      type="button"
      aria-label="关闭"
      @click="closeLightbox"
    >
      ✕
    </button>

    <template v-if="state.items.length > 1">
      <button class="lightbox-nav is-prev" type="button" aria-label="上一张" @click="stepLightbox(-1)">‹</button>
      <button class="lightbox-nav is-next" type="button" aria-label="下一张" @click="stepLightbox(1)">›</button>
    </template>

    <img id="lightbox-img" :src="state.src" :alt="state.caption || '作品大图'" />
    <p id="lightbox-cap" class="lightbox-cap">{{ state.caption }}</p>
    <p v-if="state.items.length > 1" class="lightbox-count">
      {{ state.index + 1 }} / {{ state.items.length }}
      <span class="lightbox-hint">← → 翻页</span>
    </p>
  </div>
</template>
