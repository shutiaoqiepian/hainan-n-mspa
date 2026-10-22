<script setup lang="ts">
import PhotoFigure from '@/components/PhotoFigure.vue'
import type { Photo } from '@/data/photos'

/** 作品墙图块列表：放到 <div class="wall"> 里由父级决定容器样式 */
withDefaults(defineProps<{ photos: readonly Photo[]; variant?: 'gallery' | 'home' }>(), {
  variant: 'gallery'
})
</script>

<template>
  <PhotoFigure
    v-for="photo in photos"
    :key="photo.f"
    :photo="photo"
    :variant="variant"
  />
</template>
