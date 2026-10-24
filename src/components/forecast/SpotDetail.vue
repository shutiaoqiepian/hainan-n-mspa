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
        <span v-if="d.grid"><b>气象格点</b>{{ d.grid }}</span>
        <span v-if="row.quality.status !== 'ok'" class="fcd-quality">
          <b>数据完整度</b>{{ row.quality.completeness }}%（缺{{ row.quality.missing.join('、') }}）
        </span>
      </div>
    </div>

    <p class="fcd-headline">{{ d.interpret.headline }}</p>

    <p v-if="row.rawScore !== row.score" class="fcd-note">
      这个分数怎么来的：那一刻的天气单独算 <b>{{ row.rawScore }}</b> 分 →
      叠加逐时平滑{{ row.models > 1 ? '、模式分歧折扣（±' + row.spread + '）' : '' }}、机位朝向、高空湿度剖面后
      变成 <b>{{ row.score }}</b> 分。
      <template v-if="row.rawScore > row.score + 10">
        差得较多，说明天气本身不错，但<template v-if="row.spread >= 18">几个模式分歧很大，</template>可信度有限。
      </template>
    </p>
    <p v-if="row.quality.status !== 'ok'" class="fcd-note">
      ⚠ 这次预报缺了 {{ row.quality.missing.join('、') }}，缺的项按保守值估算，
      分数会偏低且不可信——这不代表天气真的差。
    </p>

    <div class="fcd-cols">
      <div class="fcd-col">
        <h5>云层剖面 · 各高度云种（ECMWF）</h5>
        <CloudProfile :layers="d.layers" />
        <div v-if="d.conflicts.length" class="fcd-conflict">
          <p class="fcd-conflict-title">⚠ 两家模式在这几层上打架</p>
          <ul>
            <li v-for="c in d.conflicts" :key="c.band">
              <b>{{ c.band }}</b>：多模式平均 <em>{{ c.avg }}%</em>，ECMWF 单模式 <em>{{ c.ecmwf }}%</em> — {{ c.text }}
            </li>
          </ul>
          <p class="fcd-conflict-hint">
            上面那行百分比是三个模式的平均值；下面云种剖面只用了 ECMWF 一家的气压层数据。
            差这么多时，<b>云种只能当参考</b>，别当成实况。
          </p>
        </div>

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
