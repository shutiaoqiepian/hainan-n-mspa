<script setup lang="ts">
import { computed } from 'vue'
import { state } from '@/lib/forecast/state'
import type { Row } from '@/lib/forecast/types'

/** 逐时表：时间横排×指标竖排，比原来的「时间/高云/中云/低云/AOD/降雨/评分」七列多几项
    （太阳高度、通透、鲜亮度），并把最佳时次/最鲜艳时次标出来。 */

const props = defineProps<{ row: Row }>()

const hours = computed(() => props.row.detail.hourly)

const bestScore = computed(() => {
  let i = 0
  hours.value.forEach((h, k) => {
    if (h.score > hours.value[i].score) i = k
  })
  return i
})

const bestVivid = computed(() => {
  let i = 0
  hours.value.forEach((h, k) => {
    if (h.vivid > hours.value[i].vivid) i = k
  })
  return i
})

const kindWord = computed(() => (state.kind === 'sunrise' ? '日出' : '日落'))

function n0(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function fx(v: number | null, d = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(d)
}
</script>

<template>
  <div v-if="hours.length" class="fc-hours2">
    <div class="fh-head">
      <h3>{{ kindWord }}前后逐小时</h3>
      <span class="fh-sub">{{ hours.length }} 个时次 · 蓝框 = 分数最高 · 绿框 = 最鲜艳</span>
    </div>
    <div class="fh-scroll">
      <div class="fh-table">
        <div class="fh-row fh-times">
          <span class="fh-k"></span>
          <span
            v-for="(h, i) in hours"
            :key="h.t"
            class="fh-th"
            :class="{ 'is-best': i === bestScore, 'is-vivid': i === bestVivid }"
          >
            <b>{{ h.t }}</b>
            <em>{{ i === bestScore ? '分数最高' : i === bestVivid ? '最鲜艳' : ' ' }}</em>
          </span>
        </div>
        <div class="fh-row">
          <span class="fh-k">太阳高度</span>
          <span v-for="h in hours" :key="h.t" class="fh-v">{{ h.sunEl == null ? '—' : h.sunEl.toFixed(1) + '°' }}</span>
        </div>
        <div class="fh-row">
          <span class="fh-k">高云</span>
          <span v-for="h in hours" :key="h.t" class="fh-v">{{ n0(h.high) }}%</span>
        </div>
        <div class="fh-row">
          <span class="fh-k">中云</span>
          <span v-for="h in hours" :key="h.t" class="fh-v">{{ n0(h.mid) }}%</span>
        </div>
        <div class="fh-row">
          <span class="fh-k">低云</span>
          <span v-for="h in hours" :key="h.t" class="fh-v">{{ n0(h.low) }}%</span>
        </div>
        <div class="fh-row">
          <span class="fh-k">AOD</span>
          <span v-for="h in hours" :key="h.t" class="fh-v">{{ fx(h.aod) }}<em>{{ h.aodName }}</em></span>
        </div>
        <div class="fh-row">
          <span class="fh-k">降雨</span>
          <span v-for="h in hours" :key="h.t" class="fh-v">{{ n0(h.pop) }}%</span>
        </div>
        <div class="fh-row">
          <span class="fh-k">通透</span>
          <span v-for="h in hours" :key="h.t" class="fh-v" style="color: #4fb3e8">
            {{ h.clarity }}<em>{{ h.clarityLabel }}</em>
          </span>
        </div>
        <div class="fh-row">
          <span class="fh-k">鲜亮度</span>
          <span v-for="h in hours" :key="h.t" class="fh-v" style="color: var(--accent-b)">
            {{ h.vivid }}<em>{{ h.vividLabel }}</em>
          </span>
        </div>
        <div class="fh-row fh-score">
          <span class="fh-k">评分</span>
          <span
            v-for="(h, i) in hours"
            :key="h.t"
            class="fh-v fh-s"
            :style="{ color: i === bestScore ? 'var(--accent-a)' : 'var(--text)' }"
          >{{ h.score }}</span>
        </div>
      </div>
    </div>
    <p class="fh-note">逐时分为单时次原始天气打分，未叠加平滑与朝向；决策区用的是平滑后的正点分。</p>
  </div>
</template>
