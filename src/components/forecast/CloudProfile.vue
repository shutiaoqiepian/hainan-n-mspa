<script setup lang="ts">
import { computed } from 'vue'
import type { CloudLayer } from '@/lib/forecast/types'

/** 云层剖面：像 SunsetBot 的「大气截面图」一样，把每一层的云量和云种列出来 */

const props = defineProps<{ layers: CloudLayer[] }>()

/* 从高到低排列，读起来像一张垂直剖面 */
const rows = computed(() => [...props.layers].reverse())

function heightText(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'
}

function band(l: CloudLayer): string {
  return l.height >= 6000 ? 'high' : l.height >= 2000 ? 'mid' : 'low'
}
</script>

<template>
  <div class="fcp">
    <div class="fcp-head">
      <span>高度</span>
      <span>云量</span>
      <span>云种</span>
    </div>
    <div
      v-for="l in rows"
      :key="l.level"
      class="fcp-row"
      :class="['is-' + band(l), { 'is-cloud': l.code !== '--', 'is-lit': l.lit }]"
      :title="l.note"
    >
      <span class="fcp-h">{{ heightText(l.height) }}<i>{{ l.level }} hPa</i></span>
      <span class="fcp-bar">
        <i :style="{ width: Math.max(2, l.cover) + '%' }"></i>
        <em>{{ l.cover }}%</em>
      </span>
      <span class="fcp-genus">
        <template v-if="l.code === '--'">—</template>
        <template v-else>
          <b>{{ l.genus }}</b>
          <small v-if="l.species">· {{ l.species }}</small>
          <small v-if="l.lit" class="fcp-lit">· 能被夕阳照亮</small>
        </template>
      </span>
    </div>
    <p class="fcp-foot">
      高度是该气压层的位势高度；低于 2 km 为低云、2–6 km 为中云、高于 6 km 为高云（WMO 国际云图分档）。
      云种由「云量 + 湿度 + 温度 + 降水」推得，不是实测；每一行的灰字是判据说明，鼠标停上去可看。
    </p>
  </div>
</template>
