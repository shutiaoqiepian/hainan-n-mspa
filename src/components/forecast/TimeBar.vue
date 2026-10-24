<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MODELS } from '@/data/forecast/models'
import { ageText, clockText } from '@/lib/forecast/time'
import { dayWord, leadText, state, targetText } from '@/lib/forecast/state'

/** 顶部时间条：把「预报的是哪一刻」和「数据是什么时候算的」分开讲清楚 */

const tick = ref(Date.now())
let timer = 0

onMounted(() => {
  timer = window.setInterval(() => { tick.value = Date.now() }, 30000)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

const target = computed(() => {
  void tick.value
  return targetText()
})

const lead = computed(() => {
  void tick.value
  return leadText()
})

const targetPast = computed(() => {
  const t = state.targetDate && state.targetTime
    ? Date.parse(state.targetDate + 'T' + state.targetTime + ':00+08:00')
    : NaN
  return !isNaN(t) && t < Date.now() - 10 * 60 * 1000
})

const updated = computed(() => {
  if (!state.updatedAt) return '正在读取…'
  const d = new Date(state.updatedAt)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return y + '年' + m + '月' + day + '日 ' + clockText(state.updatedAt)
})

const age = computed(() => {
  void tick.value
  return state.updatedAt ? ageText(state.updatedAt, tick.value) : ''
})

const next = computed(() => {
  void tick.value
  if (!state.fromStatic || !state.nextUpdateAt) return ''
  return clockText(state.nextUpdateAt)
})

const source = computed(() =>
  state.model === 'multi'
    ? '3 个模式平均（ECMWF + ICON + GFS）'
    : (MODELS.find((m) => m.id === state.model)?.name ?? state.model) + ' 单模式'
)

const kindWord = computed(() => dayWord(state.day))
const headWord = computed(() => kindWord.value + (state.kind === 'sunrise' ? '日出' : '日落'))
</script>

<template>
  <div class="fc-timebar glass">
    <div class="fct-grid">
      <div class="fct-cell">
        <span class="fct-label">预报对象</span>
        <b class="fct-value">{{ target }}</b>
        <span class="fct-note" :class="{ 'is-past': targetPast }">
          {{ targetPast ? '这个时刻已经过去，结果只作回顾' : lead }}
        </span>
      </div>
      <div class="fct-cell">
        <span class="fct-label">数据更新</span>
        <b class="fct-value">{{ updated }}</b>
        <span class="fct-note">
          {{ age }}<template v-if="next"> · 下次约 {{ next }}（每 6 小时一次）</template>
        </span>
      </div>
      <div class="fct-cell">
        <span class="fct-label">数据来源</span>
        <b class="fct-value">{{ source }}</b>
        <span class="fct-note">
          <template v-if="state.gridNote">格点 {{ state.gridNote }}；同一格内的机位共享一份气象数据</template>
          <template v-else>不同机位的数值本身就不同：气象模式按格点计算，同一格内的机位共享同一份数据</template>
        </span>
      </div>
    </div>
    <details class="fct-help">
      <summary>这三个时间分别是什么意思？</summary>
      <ul>
        <li><b>预报对象</b>：这一页所有分数，说的都是「{{ headWord }}那一刻」（{{ target }}）的情况，不是现在。</li>
        <li><b>数据更新</b>：气象模式什么时候算出来的这份预报。越新越准；超过 12 小时就参考价值下降。</li>
        <li><b>数据来源</b>：模式名与格点大小。格点是把地球切成方格来算天气的，同一格里的机位只能共享一份数据——所以挨得近的机位数值相同是正常的，不代表算错了。</li>
        <li><b>为什么各机位数值不同</b>：每个机位所在格子不同，云量也就不同；分数还额外乘了「太阳方位与机位朝向是否对得上」的系数。</li>
      </ul>
    </details>
  </div>
</template>
