<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import Controls from '@/components/forecast/Controls.vue'
import Stamp from '@/components/forecast/Stamp.vue'
import Legend from '@/components/forecast/Legend.vue'
import DetailPanel from '@/components/forecast/DetailPanel.vue'
import SpotRow from '@/components/forecast/SpotRow.vue'
import Explanations from '@/components/forecast/Explanations.vue'
import References from '@/components/forecast/References.vue'
import ForecastToast from '@/components/forecast/ForecastToast.vue'
import { load } from '@/lib/forecast/api'
import { initStateFromUrl, state } from '@/lib/forecast/state'

/** 霞光预报（旧版 forecast.html 的 <main> + assets/forecast.js） */

const rows = computed(() =>
  state.rows.filter((r) => state.area === '全部' || r.spot.area === state.area)
)

const errorHtml = computed(() =>
  state.error ? state.error + '<br /><br />请确认电脑已联网，然后刷新页面。' : ''
)

/* 分享链接里带的机位：滚到那一行（旧版在每次 render 末尾做） */
function scrollToShare(): void {
  if (!state.shareSpot) return
  const hl = document.querySelector('#fc-list .is-hl')
  if (hl instanceof HTMLElement) hl.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(
  () => [state.rows, state.area],
  () => { void nextTick(scrollToShare) },
  { flush: 'post' }
)

onMounted(() => {
  initStateFromUrl()
  load()
})
</script>

<template>
  <section class="page-head">
    <div class="wrap">
      <p class="eyebrow">Sunset Forecast · Hainan</p>
      <h1 class="silver">这两天，海南哪里值得跑一趟</h1>
      <p>
        根据云层高度、气溶胶与降水，估算海南各机位今天、明天的朝霞与晚霞条件。
        数值越高，越有可能出现火烧云。
      </p>
    </div>
  </section>

  <section class="section" style="padding-top:48px">
    <div class="wrap">
      <Controls />

      <Stamp />

      <Legend />

      <DetailPanel />

      <div class="fc-list" id="fc-list">
        <div v-if="state.loading" class="fc-empty">正在获取海南各地的云层与气溶胶数据…</div>
        <div v-else-if="state.error" class="fc-empty" v-html="errorHtml"></div>
        <div v-else-if="!rows.length" class="fc-empty">这个区域暂时没有可用的预报点。</div>
        <template v-else>
          <SpotRow v-for="(r, i) in rows" :key="r.spot.n" :row="r" :index="i" />
        </template>
      </div>

      <p class="fc-fb-hint">
        <b>拍完请回填一次</b>：点每行右侧的「✎」，记录实际烧到什么程度。
        攒够数据就能校准算法——这是让这个工具变准的唯一办法。
      </p>

      <Explanations />

      <References />
    </div>
  </section>

  <ForecastToast />
</template>
