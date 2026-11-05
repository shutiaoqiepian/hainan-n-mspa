<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Row } from '@/lib/forecast/types'
import { computeFog, isMorningHour, FOG_WINDOW } from '@/lib/forecast/fog'
import { loadSst } from '@/lib/forecast/sst'
import { state } from '@/lib/forecast/state'

/**
 * 「雾」这一条天象 —— 唯一会显示百分比的天象。
 *
 * ★ 为什么单独一个组件，不塞进 PHENOMENA 词库
 *   1. 它要异步拿海温（Marine 接口）。词库的 match() 是同步纯函数，
 *      塞进去会让整条渲染链变成异步，风险太大。
 *   2. 现有 68 条词条用 match() 返回 0/1/2 参与排序，插一个 0–100 的进去
 *      会把 matchPhenomena 的四级排序搞乱（交接文档 §36 有记录）。
 *      放在这里就完全不碰排序。
 *
 * ★ 只在清晨显示（用户 2026-11-05 决策 3a）
 *   海南平流雾官方统计是「凌晨 2 点到上午 10 点，4–8 点最多」，
 *   所以只在日出档显示；日落档不显示，免得白占位置。
 *   但词库页面里那条描述性词条一直保留，随时能查。
 */

const props = defineProps<{ row: Row }>()

/** 海温。undefined = 还在加载，null = 这个点没有海温 */
const sst = ref<number | null | undefined>(undefined)
const failed = ref(false)

const spot = computed(() => props.row.spot)

/** 预报时刻的北京小时 */
const hour = computed(() => {
  const ms = props.row.ms
  if (!Number.isFinite(ms)) return -1
  return new Date(ms + 8 * 3600 * 1000).getUTCHours()
})

/** 只在「日出档 + 清晨窗口」显示 */
const visible = computed(
  () => state.kind === 'sunrise' && hour.value >= 0 && isMorningHour(hour.value)
)

async function refresh(): Promise<void> {
  const sp = spot.value
  if (!sp) return
  sst.value = undefined
  failed.value = false
  const r = await loadSst(sp.lat, sp.lon)
  sst.value = r.sst
  failed.value = !r.fetched
}

watch(() => [spot.value?.lat, spot.value?.lon], () => { if (visible.value) void refresh() }, {
  immediate: true
})

const fog = computed(() =>
  computeFog({
    t2m: props.row.m.t2m,
    td2m: props.row.m.td2m,
    rh: props.row.m.rh,
    low: props.row.m.low,
    wind10: props.row.m.wind10,
    sst: sst.value === undefined ? null : sst.value,
    hour: hour.value
  })
)

const loading = computed(() => sst.value === undefined)

/** 百分比徽章的文字与色调 */
const badge = computed(() => {
  if (loading.value) return { text: '算式中…', cls: 'is-loading' }
  const f = fog.value
  if (f.dataStatus === 'missing') return { text: '数据不足', cls: 'is-missing' }
  if (f.gate === 'no') return { text: '冷面不满足', cls: 'is-gate' }
  if (f.pct == null) return { text: '缺测', cls: 'is-missing' }
  const cls = f.pct >= 80 ? 'is-high' : f.pct >= 60 ? 'is-mid' : 'is-low'
  return { text: `符合度 ${f.pct}%`, cls }
})

/** 括号里那半句：说清这个百分比的分母 */
const fraction = computed(() => {
  const f = fog.value
  if (f.dataStatus === 'missing' || f.total === 0) return ''
  return `${f.hit}/${f.total} 项`
})

const STATE_ICON: Record<string, string> = { ok: '✓', no: '✗', na: '—', missing: '?' }
</script>

<template>
  <details v-if="visible" class="fc-tipcard fc-fog" :class="{ 'is-blocked': fog.gate === 'no' }">
    <summary>
      <div class="name">
        <b>平流雾 · 海雾</b>
        <em class="fc-fog-badge" :class="badge.cls">{{ badge.text }}</em>
        <em v-if="fraction" class="fc-fog-frac">{{ fraction }}</em>
      </div>
      <small>暖湿空气流经冷海面，贴着水面成雾；多在凌晨 4–8 点</small>
      <i class="caret" aria-hidden="true">+</i>
    </summary>

    <div class="tb">
      <!-- 这个百分比是什么，一句话先讲清，不能让人读成概率 -->
      <p class="fc-fog-note">
        <b>这不是「起雾概率」。</b>
        它是「{{ fog.total }} 条环境判据里满足了几条」的除法
        <template v-if="fog.pct != null">（{{ fog.hit }} ÷ {{ fog.total }} = {{ fog.pct }}%）</template>。
        我们没有雾的观测记录，算不了真正的概率。
        <!-- 必要条件不成立时，必须明说「几项满足也没用」，
             否则「4÷5=80%」会和「冷面不满足」互相打架 -->
        <template v-if="fog.gate === 'no'">
          而且这里最关键的「冷面条件」是<b>必要条件</b> —— 它不成立时，
          其余几条满足得再多也推不出平流雾。
        </template>
      </p>

      <p v-if="loading" class="fc-fog-loading">正在取海温…</p>

      <!-- 硬门槛不满足时，必须直说，不能拿「几项」掩盖 -->
      <p v-else-if="fog.gate === 'no'" class="fc-fog-gate">
        <b>冷面条件不满足</b>：露点低于海温，海面比空气还暖，平流雾的冷面条件不成立。
        这一类雾今天基本可以排除。
      </p>

      <ul class="fc-fog-basis">
        <li v-for="(b, i) in fog.basis" :key="i" :class="'is-' + b.state">
          <i class="ic" aria-hidden="true">{{ STATE_ICON[b.state] }}</i>
          <div class="bd">
            <span class="lb">{{ b.label }}</span>
            <span class="vl">{{ b.value }}</span>
            <span class="nd">要求 {{ b.need }}</span>
            <span class="wy">{{ b.why }}</span>
          </div>
        </li>
      </ul>

      <p class="fc-fog-caveat">
        <b>窗口</b>：只在凌晨 {{ FOG_WINDOW.from }}:00–{{ FOG_WINDOW.to }}:00 判断（海南海雾官方统计的时段）。
        <template v-if="failed"> 海温请求失败，这一次「冷面条件」没有评估。</template>
        <template v-else-if="fog.dataStatus === 'partial'"> 部分字段缺测，标了「?」的项没有参与计算。</template>
      </p>

      <div class="fc-fog-guide">
        <b>怎么结合别的数据判断</b>
        <ul>
          <li v-for="(g, i) in fog.guide" :key="i">{{ g }}</li>
        </ul>
      </div>
    </div>
  </details>
</template>
