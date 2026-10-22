<script setup lang="ts">
import { useToast } from '@/composables/useToast'

/**
 * 预报页专用轻提示 #fc-toast.fc-toast（旧版 forecast.js 里的 toast()）。
 * 与站点通用的 .site-toast 是两套样式：这里字号更大、位置略高，
 * 多了阴影与毛玻璃。旧版是把元素 appendChild 到 body 末尾，这里用 Teleport 保持一致。
 */
const { message, shown, active, variant } = useToast()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active && variant === 'forecast'"
      id="fc-toast"
      class="fc-toast"
      :class="{ 'is-show': shown }"
    >{{ message }}</div>
  </Teleport>
</template>
