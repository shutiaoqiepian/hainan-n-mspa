<script setup lang="ts">
import { computed } from 'vue'
import { leadText, state } from '@/lib/forecast/state'

/** 标题条：还要多久 / 数据更新时间（旧版 #fc-stamp 的 textContent） */
const text = computed(() => {
  if (state.loading) return '正在读取最新数据…'
  if (!state.rows.length) return ''
  const first = state.rows[0]
  const spanTxt = first && first.ms ? leadText(first.ms) : '正在读取时间'
  return spanTxt + '　｜　数据更新 ' +
    new Date(state.updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false }) +
    (state.fromStatic ? '（每 4 小时更新）' : '')
})
</script>

<template>
  <div class="fc-stamp" id="fc-stamp">{{ text }}</div>
</template>
