<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Photo } from '@/data/photos'

/**
 * 作品墙里的一张（旧版 buildWall / initHomeWall 里的 figure 构造）
 * 先加载缩略图，缩略图缺失退回原图；都没有就变成一块渐变色占位。
 * gallery 变体额外显示"图片缺失：文件名"，home 变体只留色块。
 */

const props = withDefaults(
  defineProps<{ photo: Photo; variant?: 'gallery' | 'home' }>(),
  { variant: 'gallery' }
)

const src = ref('images/thumbs/' + props.photo.f)
const isLoaded = ref(false)
const isMissing = ref(false)
let triedFull = false

function onError(): void {
  if (!triedFull) {
    triedFull = true
    src.value = 'images/' + props.photo.f
    return
  }
  isMissing.value = true
}

const caption = computed(() => {
  if (!props.photo.t) return ''
  return props.variant === 'home'
    ? props.photo.t
    : props.photo.t + (props.photo.a ? ' · ' + props.photo.a : '')
})

const figureStyle = computed(() => {
  if (!isMissing.value) return undefined
  return {
    minHeight: props.variant === 'home' ? '220px' : '240px',
    background: 'linear-gradient(135deg, rgba(79,179,232,.14), rgba(53,214,192,.06))'
  }
})
</script>

<template>
  <figure
    :data-src="'images/' + photo.f"
    :class="{ 'is-missing': isMissing }"
    :style="figureStyle"
  >
    <img
      v-if="!isMissing"
      :src="src"
      :alt="photo.t || '18N-MSPA 作品'"
      loading="lazy"
      decoding="async"
      :class="{ 'is-loaded': isLoaded }"
      @load="isLoaded = true"
      @error="onError"
    />
    <div
      v-if="isMissing && variant === 'gallery'"
      style="padding:24px;font-size:12px;color:#8f979f;letter-spacing:.1em;word-break:break-all"
    >图片缺失：{{ photo.f }}</div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
