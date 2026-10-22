<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useLightbox } from '@/composables/useLightbox'

/**
 * 灯箱（旧版 initLightbox）
 * 事件委托：点任意 .wall 里的 figure 打开大图，点遮罩 / ✕ / Esc 关闭。
 */

const { state, openLightbox, closeLightbox } = useLightbox()

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const fig = target?.closest?.('.wall figure') as HTMLElement | null
  if (!fig) return

  const src = fig.getAttribute('data-src')
  if (!src) return

  event.preventDefault()
  const caption = fig.querySelector('figcaption')
  openLightbox(src, caption?.textContent ?? '')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeLightbox()
}

function onBackdrop(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target === event.currentTarget || target.id === 'lightbox-close') closeLightbox()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  if (state.value.open) closeLightbox()
})
</script>

<template>
  <div id="lightbox" class="lightbox" :class="{ 'is-open': state.open }" @click="onBackdrop">
    <button id="lightbox-close" class="lightbox-close" aria-label="关闭">✕</button>
    <img id="lightbox-img" :src="state.src" alt="作品大图" />
    <p id="lightbox-cap" class="lightbox-cap">{{ state.caption }}</p>
  </div>
</template>
