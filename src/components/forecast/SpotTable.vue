<script setup lang="ts">
import { computed } from 'vue'
import { KINDS } from '@/data/forecast/levels'
import { isDone, openFeedback } from '@/lib/forecast/feedback'
import { openSpotCard } from '@/lib/forecast/card-ui'
import { state } from '@/lib/forecast/state'
import type { Row } from '@/lib/forecast/types'

/** 机位排行表：一行 44px，替掉原来每行 187px（手机 360px）的大卡片。
    默认只列前 8 个，其余折叠成一条「展开其余 N 个」。 */

const props = defineProps<{
  rows: Row[]
  selected: Row | null
  showAll: boolean
}>()

const emit = defineEmits<{
  (e: 'select', name: string): void
  (e: 'toggleAll'): void
}>()

const visible = computed(() => (props.showAll ? props.rows : props.rows.slice(0, 8)))
const rest = computed(() => props.rows.slice(8))
const restText = computed(() => {
  if (!rest.value.length) return ''
  const lo = rest.value[rest.value.length - 1].score
  const hi = rest.value[0].score
  return '展开其余 ' + rest.value.length + ' 个机位（' + lo + '–' + hi + ' 分，全部不烧）'
})

function n0(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function fx(v: number, d = 2): string {
  return Number.isFinite(v) ? v.toFixed(d) : '—'
}
function onFeedback(r: Row): void {
  openFeedback(r)
}
function onShare(r: Row): void {
  openSpotCard(r)
}
const kindWord = computed(() => KINDS[state.kind].word)
</script>

<template>
  <div class="fc-rank">
    <div class="fr-row fr-hd">
      <span>#</span>
      <span>机位</span>
      <span class="col-bar">分数</span>
      <span class="r">分</span>
      <span class="c">等级</span>
      <span class="col-cloud">高 / 中 / 低云</span>
      <span class="col-aod r">AOD</span>
      <span class="col-vivid r">鲜亮度</span>
      <span class="col-spread r">分歧</span>
      <span></span>
    </div>

    <div
      v-for="(r, i) in visible"
      :key="r.spot.n"
      class="fr-row fr-line"
      :style="{ '--fc-i': i }"
      :class="{ sel: selected && selected.spot.n === r.spot.n, hl: state.shareSpot === r.spot.n }"
      @click="emit('select', r.spot.n)"
    >
      <span class="fr-rk" :class="{ top: i === 0 }">{{ rows.indexOf(r) + 1 }}</span>
      <span class="fr-name">
        <b>{{ r.spot.n }}</b>
        <i class="fac">朝{{ r.spot.face }}</i>
        <i v-if="r.faceOff" class="tag" title="机位朝向与太阳方位不符">⚠朝向</i>
        <i v-if="r.rainbow" class="tag" title="可能有彩虹">🌈</i>
      </span>
      <span class="fr-bar col-bar">
        <i :style="{ width: Math.max(2, r.score / 96 * 100) + '%', background: r.level.color }"></i>
      </span>
      <span class="fr-score" :style="{ color: r.level.color }">{{ r.score }}</span>
      <span class="fr-lvl c" :style="{ color: r.level.color }">{{ r.level.name }}</span>
      <span class="fr-dim col-cloud">{{ n0(r.m.high) }} / {{ n0(r.m.mid) }} / {{ n0(r.m.low) }}</span>
      <span class="fr-dim col-aod r">{{ fx(r.m.aod) }}</span>
      <span class="fr-dim col-vivid r" style="color: var(--accent-b)">{{ r.vivid }} {{ r.vividLabel }}</span>
      <span class="fr-dim col-spread r">{{ r.models > 1 ? '±' + r.spread : '—' }}</span>
      <span class="fr-acts">
        <button class="fr-icb" :class="{ done: isDone(r) }" type="button" title="回填实际结果" @click.stop="onFeedback(r)">
          {{ isDone(r) ? '✓' : '✎' }}
        </button>
        <button class="fr-icb" type="button" title="生成这个机位的名片" @click.stop="onShare(r)">⤴</button>
      </span>
    </div>

    <div v-if="!showAll && rest.length" class="fr-more" @click="emit('toggleAll')">
      {{ restText }} <span>▾</span>
    </div>
    <div v-else-if="showAll && rows.length > 8" class="fr-more" @click="emit('toggleAll')">
      收起到前 8 个 <span>▴</span>
    </div>
  </div>
  <p class="fr-note">
    表格里每个分数都与「{{ kindWord }}那一刻」对应；点任意一行，下面的气象分析会换成那个机位。
  </p>
</template>
