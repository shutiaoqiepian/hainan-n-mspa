<script setup lang="ts">
import { ref } from 'vue'
import { applyTheme, currentTheme, THEMES, type ThemeKey } from '@/lib/theme'

/** 主题切换：黑 / 灰 / 白（导航右侧的小胶囊） */

const active = ref<ThemeKey>(currentTheme())

function pick(key: ThemeKey): void {
  active.value = key
  applyTheme(key)
}
</script>

<template>
  <div class="theme-switch" role="group" aria-label="配色主题">
    <button
      v-for="t in THEMES"
      :key="t.key"
      type="button"
      :class="{ 'is-on': active === t.key }"
      :aria-pressed="active === t.key ? 'true' : 'false'"
      :title="'切换到' + t.label + '色主题'"
      @click="pick(t.key)"
    >
      <i class="ts-dot" :data-swatch="t.key" aria-hidden="true"></i>
      <span class="ts-label">{{ t.label }}</span>
    </button>
  </div>
</template>
