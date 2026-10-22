<script setup lang="ts">
import { useToast } from '@/composables/useToast'

/**
 * 站点通用轻提示：样式见 .site-toast（默认透明且不挡点击，is-show 时浮出）
 * 预报页用的是另一套 .fc-toast 气泡，由预报页自己渲染。
 */
const { message, shown, active, variant } = useToast()
</script>

<template>
  <div
    v-if="active && variant === 'site'"
    id="site-toast"
    class="site-toast"
    :class="{ 'is-show': shown }"
  >{{ message }}</div>
</template>
