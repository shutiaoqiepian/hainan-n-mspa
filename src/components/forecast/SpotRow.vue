<script setup lang="ts">
import { computed } from 'vue'
import { KINDS } from '@/data/forecast/levels'
import { clarityLabel, pillarLabel, rainbowLabel, raysLabel } from '@/lib/forecast/scoring'
import { isDone, openFeedback } from '@/lib/forecast/feedback'
import { state, toggleSpot } from '@/lib/forecast/state'
import { openSpotCard } from '@/lib/forecast/card-ui'
import { dateText } from '@/lib/forecast/time'
import type { Row } from '@/lib/forecast/types'

/** 一个机位一行（旧版 render() 里生成的 .fc-row） */
const props = defineProps<{ row: Row; index: number }>()

/* 整串拼好，避免模板换行多出空格 */
const meta = computed(() => {
  const r = props.row
  return dateText(r.detail.date, r.detail.weekday) + ' ' + KINDS[state.kind].word + ' ' + r.m.time +
    (r.sunAz != null ? ' · 太阳方位 ' + r.sunAz + '°' : '') +
    ' · 高云 ' + Math.round(r.m.high ?? 0) + '%' +
    ' · 中云 ' + Math.round(r.m.mid ?? 0) + '%' +
    ' · 低云 ' + Math.round(r.m.low ?? 0) + '%' +
    (r.cloudBaseLow != null ? ' · 低云云底≈' + r.cloudBaseLow + 'm' : '') +
    ' · AOD ' + r.m.aod.toFixed(2) + '（' + r.aodName + '）' +
    ' · 降雨 ' + Math.round(r.m.pop ?? 0) + '%'
})

const spreadText = computed(() =>
  props.row.spread >= 18
    ? '模式分歧 ±' + props.row.spread + '（分数已打折）'
    : '模式 ±' + props.row.spread
)

const done = computed(() => isDone(props.row))
const open = computed(() => state.openSpot === props.row.spot.n)
const fbTitle = computed(() => (done.value ? '你已反馈过这一条（可再次提交）' : '回填实际结果'))
const scoreStyle = computed(() => ({ '--p': String(props.row.score), '--c': props.row.level.color }))

/* 分享＝生成名片：图里带二维码，链接可以在弹窗里单独复制 */
function onShare(): void {
  openSpotCard(props.row)
}

function onFeedback(): void {
  openFeedback(props.row)
}

function onToggle(): void {
  toggleSpot(props.row.spot.n)
}
</script>

<template>
  <article class="fc-row" :class="{ 'is-top': index === 0, 'is-hl': state.shareSpot === row.spot.n }">
    <div class="fc-score" :style="scoreStyle"><span>{{ row.score }}</span></div>
    <div class="fc-main">
      <div class="fc-name"><b>{{ index + 1 }}</b> {{ row.spot.n }} <i class="fc-face">朝{{ row.spot.face }}</i></div>
      <div class="fc-meta">{{ meta }}</div>
      <div class="fc-chips">
        <span class="fc-badge b-clear">通透 {{ row.clarity }} · {{ clarityLabel(row.clarity) }}</span>
        <span class="fc-badge b-rays">云隙光 {{ row.rays }} · {{ raysLabel(row.rays) }}</span>
        <span class="fc-badge b-pillar">光柱 {{ row.pillar }} · {{ pillarLabel(row.pillar) }}</span>
        <span class="fc-badge b-rainbow">彩虹 {{ row.rainbowScore }} · {{ rainbowLabel(row.rainbowScore) }}</span>
        <span v-if="row.models > 1" class="fc-badge b-spread" :class="{ 'is-warn': row.spread >= 18 }">{{ spreadText }}</span>
      </div>
      <div v-if="row.detail.genusText" class="fc-prof">云种（ECMWF 单模式）：{{ row.detail.genusText }}</div>
      <div v-if="row.faceOff && row.sunAz != null" class="fc-faceoff">⚠ 朝向不符：机位朝{{ row.spot.face }}，太阳方位 {{ row.sunAz }}°</div>
      <div v-if="row.rainbow" class="fc-tag">🌈 可能有彩虹</div>
    </div>
    <div class="fc-level" :style="{ color: row.level.color }">{{ row.level.name }}</div>
    <button
      class="fc-detail-btn"
      :class="{ 'is-open': open }"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      :title="open ? '收起详情' : '展开预报详情：云种剖面、气象解读、拍摄题材'"
      @click.stop="onToggle"
    >{{ open ? '收起' : '详情' }}</button>
    <button class="fc-fb" :class="{ 'is-done': done }" type="button" :title="fbTitle" :aria-label="fbTitle" @click.stop="onFeedback">{{ done ? '✓' : '✎' }}</button>
    <button class="fc-share" type="button" title="生成名片分享" aria-label="生成名片分享" @click.stop="onShare">⤴</button>
  </article>
</template>
