<script setup lang="ts">
import { ref } from 'vue'
import { applyTheme, currentTheme, THEMES, type ThemeKey } from '@/lib/theme'
import { applyPerf, currentPerf, type PerfMode } from '@/lib/perf'

/**
 * 导航右侧的小胶囊，装两段互不影响的选择：
 *   · 配色：黑 / 灰 / 白（只换颜色，不碰特效）
 *   · 性能：标准 / 省电（只关特效，不碰颜色）
 * 没做成「黑/灰/白/省电」四选一——那样就选不出「黑 + 省电」了。
 * 两段之间用一根细竖线隔开，告诉用户这是两类设置。
 */

const active = ref<ThemeKey>(currentTheme())
const perf = ref<PerfMode>(currentPerf())

function pick(key: ThemeKey): void {
  active.value = key
  applyTheme(key)
}

function togglePerf(): void {
  const next: PerfMode = perf.value === 'on' ? 'off' : 'on'
  perf.value = next
  applyPerf(next)
}
</script>

<template>
  <div class="theme-switch" role="group" aria-label="配色与性能设置">
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

    <span class="ts-sep" aria-hidden="true"></span>

    <button
      type="button"
      class="perf-toggle"
      :class="{ 'is-on': perf === 'on' }"
      :aria-pressed="perf === 'on' ? 'true' : 'false'"
      :title="
        perf === 'on'
          ? '性能模式已开：毛玻璃和动画已关，省电但页面更朴素。点一下恢复'
          : '性能模式：手机发烫/卡顿时打开。关掉毛玻璃和动画，配色不变'
      "
      @click="togglePerf"
    >
      <i class="ts-dot perf-dot" aria-hidden="true"></i>
      <span class="ts-label">性能</span>
    </button>
  </div>
</template>
