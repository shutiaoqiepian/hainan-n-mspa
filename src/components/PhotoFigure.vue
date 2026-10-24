<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Photo } from '@/data/photos'
import { PHOTO_SIZES } from '@/data/photo-sizes'

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
let triedSmall = false

/* 真实像素尺寸（tools/make-photo-sizes.ps1 生成）。
   写成 width/height 属性，浏览器在图片到达之前就按比例把位置占好，
   否则每张图加载都会把下面整块内容顶下去（实测首页 CLS 0.26）。 */
const size = computed(() => PHOTO_SIZES[props.photo.f] ?? null)

/* 两档缩略图：手机列宽只有 180px 左右，没必要下载 800px 的那张。
   400px 那档由 tools/make-thumb-400.ps1 生成。
   sizes 按作品墙的实际列宽写：≤1000px 时两列（约 46vw），更宽时三列（约 32vw）。 */
const srcset = ref(
  'images/thumbs-400/' + props.photo.f + ' 400w, images/thumbs/' + props.photo.f + ' 800w'
)
const SIZES = '(max-width: 1000px) 46vw, 32vw'

function onError(): void {
  /* 小图那档没生成（新加了照片但忘了跑脚本）：先退回只用 800px 那张 */
  if (!triedSmall) {
    triedSmall = true
    srcset.value = ''
    return
  }
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
    background: 'linear-gradient(135deg, var(--accent-a-soft), var(--accent-b-soft))'
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
      :srcset="srcset || undefined"
      :sizes="srcset ? SIZES : undefined"
      :alt="photo.t || '18N-MSPA 作品'"
      :width="size ? size.w : undefined"
      :height="size ? size.h : undefined"
      loading="lazy"
      decoding="async"
      :class="{ 'is-loaded': isLoaded }"
      @load="isLoaded = true"
      @error="onError"
    />
    <div
      v-if="isMissing && variant === 'gallery'"
      class="photo-missing-note"
    >图片缺失：{{ photo.f }}</div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
