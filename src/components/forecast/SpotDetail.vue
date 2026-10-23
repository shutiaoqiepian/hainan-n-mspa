<script setup lang="ts">
import { computed } from 'vue'
import CloudProfile from './CloudProfile.vue'
import { state } from '@/lib/forecast/state'
import { dateText } from '@/lib/forecast/time'
import type { Row } from '@/lib/forecast/types'

/** 单个机位的「预报详情」：云种剖面 + 气象解读 + 拍摄题材 + 逐小时 */

const props = defineProps<{ row: Row }>()

const d = computed(() => props.row.detail)
const kindWord = computed(() => (state.kind === 'sunrise' ? '日出' : '日落'))

const sunText = computed(() => {
  if (d.value.sunEl == null) return ''
  const el = d.value.sunEl
  return (el >= 0 ? '太阳高度 ' + el.toFixed(1) + '°' : '太阳已落到地平线下 ' + Math.abs(el).toFixed(1) + '°')
})
</script>

<template>
  <div class="fcd glass">
    <div class="fcd-top">
      <div>
        <p class="eyebrow">
          {{ dateText(d.date, d.weekday) }} · {{ kindWord }} {{ d.time }} · {{ row.spot.area }}
        </p>
        <h4 class="fcd-title-line">
          {{ row.spot.n }} 的预报详情
          <span class="fcd-sun">{{ sunText }}</span>
        </h4>
        <p class="fcd-genus">{{ d.genusText }}</p>
      </div>
      <div class="fcd-times">
        <span><b>黄金时刻</b>{{ d.golden }}</span>
        <span><b>蓝调时刻</b>{{ d.blue }}</span>
        <span v-if="d.sunAz != null"><b>太阳方位</b>{{ d.sunAz }}°</span>
      </div>
    </div>

    <p class="fcd-headline">{{ d.interpret.headline }}</p>

    <div class="fcd-cols">
      <div class="fcd-col">
        <h5>云层剖面 · 各高度云种（ECMWF）</h5>
        <CloudProfile :layers="d.layers" />
        <p class="fcd-note">
          云种按 ECMWF 单模式的气压层数据推得；上面那行的百分比是多模式平均，两者口径不同。
          当前多模式平均：高云 {{ Math.round(row.m.high ?? 0) }}%、中云 {{ Math.round(row.m.mid ?? 0) }}%、低云 {{ Math.round(row.m.low ?? 0) }}%。
          差得远时，说明模式之间本身不一致，以平均值为准、云种只作参考。
        </p>
      </div>
      <div class="fcd-col">
        <h5>为什么是这个分</h5>
        <ul class="fcd-list">
          <li v-for="p in d.interpret.pros" :key="p" class="is-pro"><i>+</i>{{ p }}</li>
          <li v-for="c in d.interpret.cons" :key="c" class="is-con"><i>−</i>{{ c }}</li>
        </ul>
        <p class="fcd-advice">{{ d.interpret.advice }}</p>
      </div>
    </div>

    <div v-if="d.tips.length" class="fcd-tips">
      <h5>这个天值得拍的题材</h5>
      <div class="fcd-tip-cards">
        <details v-for="t in d.tips" :key="t.key" class="fcd-tipcard">
          <summary>
            <b>{{ t.name }}</b>
            <small>{{ t.alias }}</small>
          </summary>
          <p><b>为什么可能出现：</b>{{ t.why }}</p>
          <p><b>怎么拍：</b>{{ t.shoot }}</p>
        </details>
      </div>
    </div>

    <div v-if="d.hourly.length" class="fcd-hours">
      <h5>{{ kindWord }}前后逐小时</h5>
      <div class="fcd-grid">
        <div class="fcd-row fcd-row-head">
          <span>时间</span><span>高云</span><span>中云</span><span>低云</span><span>AOD</span><span>降雨</span><span>评分</span>
        </div>
        <div v-for="h in d.hourly" :key="h.t" class="fcd-row">
          <span class="fcd-time">{{ h.t }}</span>
          <span>{{ Math.round(h.high ?? 0) }}%</span>
          <span>{{ Math.round(h.mid ?? 0) }}%</span>
          <span>{{ Math.round(h.low ?? 0) }}%</span>
          <span>{{ h.aod.toFixed(2) }}</span>
          <span>{{ Math.round(h.pop ?? 0) }}%</span>
          <span class="fcd-score">{{ h.score }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
