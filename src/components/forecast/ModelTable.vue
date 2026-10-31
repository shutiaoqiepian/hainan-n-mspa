<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Row } from '@/lib/forecast/types'

/** 各模式怎么看：8 个模式各自报的逐层云量与对应分数。
    ECMWF / ICON / GFS 计分，其余 5 个作参考 —— 分歧大就说明这次预报不能当真。 */

const props = defineProps<{ row: Row }>()

const MAIN = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless']

const rows = computed(() =>
  props.row.perModel.map((p) => {
    const diff = p.score == null ? null : p.score - props.row.score
    return {
      ...p,
      main: MAIN.includes(p.id),
      diff,
      diffText: diff == null ? '' : diff === 0 ? '与均值持平' : (diff > 0 ? '高于均值 +' : '低于均值 ') + diff,
      color:
        p.score == null ? 'var(--muted-2)'
          : p.score >= 92 ? '#ff6a3d' : p.score >= 82 ? '#ff9640' : p.score >= 66 ? '#ffd166'
            : p.score >= 48 ? '#9ad9b8' : p.score >= 30 ? '#8f979f' : '#5b636a'
    }
  })
)

function n0(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v))
}

const highText = computed(() => {
  const get = (id: string): string => {
    const p = props.row.perModel.find((x) => x.id === id)
    return p ? n0(p.high) + '%' : '缺'
  }
  return 'ECMWF 报 ' + get('ecmwf_ifs025') + ' 高云、ICON 报 ' + get('icon_seamless') + '、GFS 报 ' + get('gfs_seamless')
})

/* ---------- 窄屏渐进式披露 ----------
   「各模式怎么看」是高级诊断：8 行逐层云量 + 相对均值，360 下实测 446px。
   回答「为什么是这个分」有用，但不是首屏决策信息。窄屏默认收成一行摘要
   （三家高云 + 分歧），点开与宽屏逐行一致；桌面（>560px）不渲染摘要行。 */
const NARROW_MQ = '(max-width: 560px)'
const narrow = ref(window.matchMedia(NARROW_MQ).matches)
let narrowMq: MediaQueryList | null = null
const open = ref(false)
function onNarrowChange(e: MediaQueryListEvent): void {
  narrow.value = e.matches
  if (e.matches) open.value = false
}
onMounted(() => {
  narrowMq = window.matchMedia(NARROW_MQ)
  narrow.value = narrowMq.matches
  narrowMq.addEventListener('change', onNarrowChange)
})
onBeforeUnmount(() => {
  narrowMq?.removeEventListener('change', onNarrowChange)
})
const shortText = computed(() => {
  const get = (id: string): string => {
    const p = props.row.perModel.find((x) => x.id === id)
    return p ? n0(p.high) + '%' : '缺'
  }
  return 'ECMWF ' + get('ecmwf_ifs025') + ' / ICON ' + get('icon_seamless') + ' / GFS ' + get('gfs_seamless') + ' 高云'
})
</script>

<template>
  <div class="fcm">
    <div class="fcm-head">
      <h3>各模式怎么看</h3>
      <span class="fcm-sub">
        8 个模式各自报的逐层云量与对应分数 · 分歧 ±{{ row.spread }}
        <b v-if="row.spread >= 18" style="color: var(--warn)">（≥18 已打折）</b>
      </span>
      <span class="fcm-legend">ECMWF / ICON / GFS 计分 · CMA·JMA·GEM·METNO·ACCESS 参考</span>
    </div>

    <button
      v-if="narrow"
      class="s2b-toggle fcm-toggle"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = !open"
    >
      <span class="s2b-tx"><b>8 个模式逐层对比</b><em>{{ shortText }} · 分歧 ±{{ row.spread }}</em></span>
      <span class="s2b-ic" aria-hidden="true">{{ open ? '收起' : '展开' }}</span>
    </button>

    <div v-show="!narrow || open" class="fcm-table">
      <div class="fcm-row fcm-hd">
        <span>模式</span><span>高云</span><span>中云</span><span>低云</span>
        <span class="r">分数</span><span>相对均值</span><span class="r">用途</span>
      </div>
      <div v-for="p in rows" :key="p.id" class="fcm-row" :class="{ ref: !p.main }">
        <span class="fcm-n"><b>{{ p.name }}</b><i>{{ p.tag }}</i></span>
        <span class="fcm-c">{{ n0(p.high) }}<template v-if="p.high != null">%</template></span>
        <span class="fcm-c">{{ n0(p.mid) }}<template v-if="p.mid != null">%</template></span>
        <span class="fcm-c">{{ n0(p.low) }}<template v-if="p.low != null">%</template></span>
        <span class="fcm-s" :style="{ color: p.color }">{{ p.score == null ? '缺测' : p.score }}</span>
        <span class="fcm-bar">
          <i :style="{ width: (p.score == null ? 0 : Math.max(2, p.score / 96 * 100)) + '%', background: p.color }"></i>
          <em>{{ p.diffText }}</em>
        </span>
        <span class="fcm-u">{{ p.main ? '计分' : '参考' }}</span>
      </div>
    </div>

    <p v-show="!narrow || open" class="fcm-note">{{ highText }} —— 三家差得越远，这次就越不能当真。</p>
  </div>
</template>
