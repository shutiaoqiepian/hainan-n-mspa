<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import Controls from '@/components/forecast/Controls.vue'
import TimeBar from '@/components/forecast/TimeBar.vue'
import Legend from '@/components/forecast/Legend.vue'
import SpotRow from '@/components/forecast/SpotRow.vue'
import SpotDetail from '@/components/forecast/SpotDetail.vue'
import Explanations from '@/components/forecast/Explanations.vue'
import Phenomena from '@/components/forecast/Phenomena.vue'
import References from '@/components/forecast/References.vue'
import ForecastToast from '@/components/forecast/ForecastToast.vue'
import ForecastCardModal from '@/components/forecast/ForecastCardModal.vue'
import { load } from '@/lib/forecast/api'
import { openListCard, openSpotCard } from '@/lib/forecast/card-ui'
import { initStateFromUrl, state } from '@/lib/forecast/state'
import { provEn, provName } from '@/data/forecast/spots'

/** 霞光预报（旧版 forecast.html 的 <main> + assets/forecast.js） */

const prov = computed(() => provName(state.prov))
const provLatin = computed(() => provEn(state.prov))

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

/* 页面顶部的「生成今日名片」 */
function onListCard(): void {
  openListCard(rows.value)
}

/* 支持 ?card=list / ?card=spot 直接打开名片（方便分享「打开就是名片」） */
let cardOpened = false
function autoOpenCard(): void {
  if (cardOpened || !state.rows.length) return
  const want = new URLSearchParams(location.search).get('card')
  if (want !== 'list' && want !== 'spot') return
  cardOpened = true
  if (want === 'list') {
    openListCard(rows.value)
    return
  }
  const row = state.rows.find((r) => r.spot.n === state.shareSpot) ?? rows.value[0]
  if (row) openSpotCard(row)
}

watch(() => state.rows, () => { void nextTick(autoOpenCard) }, { flush: 'post' })

onMounted(() => {
  initStateFromUrl()
  load()
})
</script>

<template>
  <section class="page-head">
    <div class="wrap">
      <p class="eyebrow">Sunset Forecast · {{ provLatin }}</p>
      <h1 class="silver">这两天，{{ prov }}哪里值得跑一趟</h1>
      <p>
        根据云层高度、云种、气溶胶与降水，估算{{ prov }}各机位今天、明天的朝霞与晚霞条件。
        数值越高，越有可能出现火烧云。点每行的「详情」可以看到逐高度云种、气象解读和拍摄题材。
      </p>
    </div>
  </section>

  <section class="section" style="padding-top:48px">
    <div class="wrap">
      <Controls />

      <TimeBar />

      <Legend />

      <div class="fc-sharebar">
        <button class="fc-sharebar-btn" type="button" @click="onListCard">
          <span class="fsb-icon" aria-hidden="true">▣</span>
          生成今日名片（前 5 个机位）
        </button>
        <span class="fc-sharebar-hint">发朋友圈 / 群里用；每行的 ⤴ 是单个机位的名片</span>
      </div>

      <div class="fc-list" id="fc-list">
        <div v-if="state.loading" class="fc-empty">正在获取海南各地的云层与气溶胶数据…</div>
        <div v-else-if="state.error" class="fc-empty" v-html="errorHtml"></div>
        <div v-else-if="!rows.length" class="fc-empty">这个区域暂时没有可用的预报点。</div>
        <template v-else>
          <div v-for="(r, i) in rows" :key="r.spot.n" class="fc-item">
            <SpotRow :row="r" :index="i" />
            <SpotDetail v-if="state.openSpot === r.spot.n" :row="r" />
          </div>
        </template>
      </div>

      <p class="fc-fb-hint">
        <b>拍完请回填一次</b>：点每行右侧的「✎」，记录实际烧到什么程度。
        攒够数据就能校准算法——这是让这个工具变准的唯一办法。
      </p>

      <Explanations />

      <Phenomena />

      <References />
    </div>
  </section>

  <ForecastToast />
  <ForecastCardModal />
</template>
