<script setup lang="ts">
import type { Component } from 'vue'
import SiteNav from '@/components/layout/SiteNav.vue'
import SiteFooter from '@/components/layout/SiteFooter.vue'
import Toast from '@/components/layout/Toast.vue'
import { useReveal } from '@/composables/useReveal'
import { COPYRIGHT } from '@/data/site'

/**
 * 全站外壳：导航 + 主内容 + 页脚 + 轻提示。
 * afterMain / overlay 两个位置留给页面级浮层（灯箱、反馈弹窗），
 * 保证它们的 DOM 位置与旧版 HTML 完全一致。
 * 滚动淡入的观察器在这里统一初始化，页面里后插入的 .reveal 也会被接管。
 */

const props = withDefaults(
  defineProps<{ copyright?: string; afterMain?: Component; overlay?: Component }>(),
  { copyright: COPYRIGHT }
)

useReveal()

const { copyright, afterMain, overlay } = props
</script>

<template>
  <SiteNav />
  <main>
    <slot />
  </main>
  <component :is="afterMain" v-if="afterMain" />
  <SiteFooter :copyright="copyright" />
  <component :is="overlay" v-if="overlay" />
  <Toast />
</template>
