<script setup lang="ts">
import { computed } from 'vue'
import { KINDS, levelOf } from '@/data/forecast/levels'
import { DETAIL_SPOT } from '@/data/forecast/spots'
import { dayWord, shareSpot, state } from '@/lib/forecast/state'

/** 海口逐小时详细面板（旧版 #fc-detail） */
const detail = computed(() => state.detail)
const show = computed(() => !state.loading && !state.error && !!state.detail)

/* 副标题整串拼好，避免模板换行多出空格 */
const sub = computed(() => {
  const d = state.detail
  if (!d) return ''
  const word = KINDS[state.kind].word
  const dayTxt = dayWord(state.day)
  return dayTxt + word + ' ' + d.time + '　·　黄金时刻 ' + d.golden +
    '　·　蓝调 ' + d.blue + '（时刻为估算）'
})

function onShare(): void {
  shareSpot(DETAIL_SPOT)
}
</script>

<template>
  <div class="fc-detail glass" id="fc-detail" :style="{ display: show ? '' : 'none' }">
    <template v-if="show && detail">
      <div class="fcd-head">
        <div class="fcd-left">
          <p class="eyebrow">海口 · {{ dayWord(state.day) }}{{ KINDS[state.kind].word }}逐小时</p>
          <h3 class="fcd-title">{{ DETAIL_SPOT }}</h3>
          <p class="fcd-sub">{{ sub }}</p>
        </div>
        <button class="btn btn-ghost fcd-share" type="button" @click="onShare">分享海口这一条</button>
      </div>
      <div class="fcd-grid">
        <div class="fcd-row fcd-row-head"><span>时间</span><span>高云</span><span>中云</span><span>低云</span><span>AOD</span><span>降雨</span><span>评分</span></div>
        <div v-for="h in detail.hours" :key="h.t" class="fcd-row">
          <span class="fcd-time">{{ h.t }}</span>
          <span>{{ Math.round(h.high ?? 0) }}%</span>
          <span>{{ Math.round(h.mid ?? 0) }}%</span>
          <span>{{ Math.round(h.low ?? 0) }}%</span>
          <span>{{ h.aod.toFixed(2) }}</span>
          <span>{{ Math.round(h.pop ?? 0) }}%</span>
          <span class="fcd-score" :style="{ color: levelOf(h.score).color }">{{ h.score }}</span>
        </div>
      </div>
      <p class="fcd-tip">黄金时刻适合拍色彩，蓝调时刻适合拍城市灯光与海面的冷暖对比。低云 20% 以下、高云 30–88% 时最值得提前到场。</p>
    </template>
  </div>
</template>
