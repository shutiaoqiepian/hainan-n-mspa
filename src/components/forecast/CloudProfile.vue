<script setup lang="ts">
import { computed, ref } from 'vue'
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

/* ---------- 判据说明怎么读 ----------
   电脑上有鼠标，可以直接 hover（title）或者点开；
   手机没有 hover，所以每行都做成可点的按钮，点一下把说明展开在行下面。
   一次只展开一行，避免面板变得又长又乱。 */
const openKey = ref<number | null>(null)

function toggle(level: number): void {
  openKey.value = openKey.value === level ? null : level
}
</script>

<template>
  <div class="fcp">
    <div class="fcp-head">
      <span>高度</span>
      <span>云量</span>
      <span>云种</span>
    </div>

    <div v-for="l in rows" :key="l.level" class="fcp-item">
      <button
        class="fcp-row"
        :class="['is-' + band(l), { 'is-cloud': l.code !== '--', 'is-lit': l.lit, 'is-open': openKey === l.level }]"
        type="button"
        :aria-expanded="openKey === l.level ? 'true' : 'false'"
        :title="l.note"
        @click="toggle(l.level)"
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
        <i class="fcp-caret" aria-hidden="true">{{ openKey === l.level ? '−' : '?' }}</i>
      </button>

      <p v-if="openKey === l.level" class="fcp-note">
        <b>{{ l.genus === '无云' ? '这一层没有云' : l.genus + (l.species ? '（' + l.species + '）' : '') }}</b>
        ——{{ l.note }}。
        <span class="fcp-crit">
          判据：{{ l.level }} hPa 附近高度约 {{ heightText(l.height) }}，云量 {{ l.cover }}%、相对湿度 {{ l.rh }}%<template
            v-if="l.t != null"
          >、气温 {{ Math.round(l.t) }}℃</template>。
        </span>
      </p>
    </div>

    <p class="fcp-foot">
      高度是该气压层的位势高度；低于 2 km 为低云、2–6 km 为中云、高于 6 km 为高云（WMO 国际云图分档）。
      云种由「云量 + 湿度 + 温度 + 降水」推得，不是实测。<b>点任意一行</b>（电脑上鼠标停上去也行）看这一层的判据。
    </p>
  </div>
</template>
