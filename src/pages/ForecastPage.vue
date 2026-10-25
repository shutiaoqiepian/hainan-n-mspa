<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Controls from '@/components/forecast/Controls.vue'
import DecisionHero from '@/components/forecast/DecisionHero.vue'
import ModelTable from '@/components/forecast/ModelTable.vue'
import SpotTable from '@/components/forecast/SpotTable.vue'
import SpotPanel from '@/components/forecast/SpotPanel.vue'
import TipCards from '@/components/forecast/TipCards.vue'
import FoldPanel from '@/components/forecast/FoldPanel.vue'
import Explanations from '@/components/forecast/Explanations.vue'
import Phenomena from '@/components/forecast/Phenomena.vue'
import References from '@/components/forecast/References.vue'
import ForecastToast from '@/components/forecast/ForecastToast.vue'
import ForecastCardModal from '@/components/forecast/ForecastCardModal.vue'
import { load } from '@/lib/forecast/api'
import { openListCard, openSpotCard } from '@/lib/forecast/card-ui'
import { initStateFromUrl, state } from '@/lib/forecast/state'
import { provName } from '@/data/forecast/spots'
import { layerVerdict } from '@/lib/forecast/scoring'
import type { Row } from '@/lib/forecast/types'

/** 霞光预报
    版面按「决策顺序」分四层：
      ① 决策区（去掉大标题区，合成一张卡）
      ② 当次题材 + 机位排行 + 各模式怎么看
      ③ 选中机位的气象条件分析（含逐时）
      ④ 专业判定与参考（折叠，默认展开三项）
    不删任何信息，只调整优先级和默认展开状态。 */

const prov = computed(() => provName(state.prov))

/* 选中机位：默认第一行，点表格换 */
const picked = ref('')

const rows = computed(() => {
  const list = state.rows.filter((r) => state.area === '全部' || r.spot.area === state.area)
  return list
})

const selected = computed<Row | null>(() => {
  const list = rows.value
  if (!list.length) return null
  if (state.openSpot) {
    const hit = list.find((r) => r.spot.n === state.openSpot)
    if (hit) return hit
  }
  return list.find((r) => r.spot.n === picked.value) ?? list[0]
})

const rank = computed(() => {
  if (!selected.value) return 1
  return rows.value.indexOf(selected.value) + 1
})

const showAll = ref(false)

/* 决策卡里展示的第 2–4 名（不含当前选中项） */
const others = computed(() => {
  const cur = selected.value
  if (!cur) return []
  return rows.value.filter((r) => r.spot.n !== cur.spot.n).slice(0, 3)
})

function gotoRank(): void {
  const el = document.getElementById('fc-rank')
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onSelect(name: string): void {
  picked.value = name
  /* 与旧版共用同一个「打开的是哪个机位」状态，分享链接行为不变 */
  state.openSpot = name
}

/* 分享链接里带的机位：滚到那一行（旧版在每次 render 末尾做） */
function scrollToShare(): void {
  if (!state.shareSpot) return
  const hl = document.querySelector('.fc-rank .hl')
  if (hl instanceof HTMLElement) hl.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(
  () => [state.rows, state.area],
  () => { void nextTick(scrollToShare) },
  { flush: 'post' }
)

/* 换省份/日期/时段后，选中项复位到第一 */
watch(
  () => [state.prov, state.day, state.kind, state.model],
  () => {
    picked.value = ''
    state.openSpot = ''
    showAll.value = false
  }
)

/* 页面顶部的「生成今日名片」 */
function onListCard(): void {
  openListCard(rows.value)
}

/* 支持 ?card=list / ?card=spot 直接打开名片 */
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

/* 「查看全部 60 条词条」滚到天象词库 */
function gotoPhenomena(): void {
  const el = document.getElementById('fc-phenomena')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(() => {
  initStateFromUrl()
  picked.value = ''
  load()
})
</script>

<template>
  <section class="page-head fc-head">
    <div class="wrap">
      <p class="eyebrow">Sunset Forecast · {{ prov }}</p>
      <h1 class="fc-h1">这两天，<b>{{ prov }}</b>哪里值得跑一趟</h1>
      <p class="fc-lede">
        根据云层高度、云种、气溶胶与降水，估算{{ prov }}各机位今天、明天的朝霞与晚霞条件。
        数值越高，越有可能出现火烧云。点每个机位的「详情」可以看到逐高度云种、气象解读和拍摄题材。
      </p>
    </div>
  </section>

  <section class="section fc-section">
    <div class="wrap">
      <!-- 查询条件 + 数据状态，合成一条工具条 -->
      <Controls />

      <div v-if="state.loading" class="fc-empty">正在获取{{ prov }}各地的云层与气溶胶数据…</div>
      <div v-else-if="state.error" class="fc-empty">
        {{ state.error }}<br /><br />请确认电脑已联网，然后刷新页面。
      </div>
      <div v-else-if="!rows.length" class="fc-empty">这个区域暂时没有可用的预报点。</div>

      <template v-else>
        <!-- ① 决策区 -->
        <DecisionHero
          v-if="selected"
          class="fc-reveal fc-o-hero"
          :row="selected"
          :rank="rank"
          :total="rows.length"
          :others="others"
          @select="onSelect"
          @goto-rank="gotoRank"
        />

        <!-- ② 当次题材 -->
        <div v-if="selected" class="fc-block fc-reveal fc-o-tips">
          <div class="fc-block-head">
            <h2>当次能拍的题材</h2>
            <span class="sub">
              {{ selected.spot.n }} · 从 60 条词库里按当前天况挑出的 {{ selected.detail.tips.length }} 条 · 点卡片看怎么拍
            </span>
          </div>
          <TipCards :tips="selected.detail.tips" @open-all="gotoPhenomena" />
        </div>

        <!-- ② 机位排行 -->
        <div id="fc-rank" class="fc-block fc-reveal fc-o-rank">
          <div class="fc-block-head">
            <h2>全部 {{ rows.length }} 个机位</h2>
            <span class="sub">按分数排序 · 点任意一行看它的完整分析</span>
            <button class="fc-btn primary" type="button" @click="onListCard">▣ 生成今日名片</button>
          </div>
          <SpotTable
            :rows="rows"
            :selected="selected"
            :show-all="showAll"
            @select="onSelect"
            @toggle-all="showAll = !showAll"
          />
        </div>

        <!-- ② 各模式怎么看 -->
        <div v-if="selected" class="fc-block fc-reveal fc-o-mode">
          <ModelTable :row="selected" />
        </div>

        <!-- ③ 气象条件分析 -->
        <SpotPanel v-if="selected" :row="selected" class="fc-block fc-reveal fc-o-panel" />

        <!-- ④ 专业判定与参考 -->
        <div class="fc-block fc-reveal fc-o-fold">
          <div class="fc-block-head">
            <h2>专业判定与参考</h2>
            <span class="sub">可同时展开多个 · 原有内容一条未删</span>
          </div>
          <div class="fc-folds">
            <FoldPanel title="判定依据：这个分怎么来的" :count="selected ? selected.detail.interpret.pros.length + ' 加分 / ' + selected.detail.interpret.cons.length + ' 减分' : ''" open>
              <div v-if="selected" class="fc-why">
                <p>{{ selected.detail.interpret.headline }}</p>
                <div class="fc-why-cols">
                  <ul>
                    <li v-for="t in selected.detail.interpret.pros" :key="t" class="is-pro"><i>+</i>{{ t }}</li>
                  </ul>
                  <ul>
                    <li v-for="t in selected.detail.interpret.cons" :key="t" class="is-con"><i>−</i>{{ t }}</li>
                  </ul>
                </div>
                <p><b>出发建议：</b>{{ selected.detail.interpret.advice }}</p>
              </div>
            </FoldPanel>
            <FoldPanel title="云种剖面与每层判据" :count="selected ? selected.detail.layers.length + ' 层' : ''" open>
              <ul v-if="selected" class="fc-genus">
                <li v-for="l in [...selected.detail.layers].reverse()" :key="l.level">
                  <b>{{ l.level }} hPa · {{ l.genus }}<template v-if="l.species && l.species !== l.genus">（{{ l.species }}）</template></b>
                  ：{{ l.note }}<br /><span class="muted">{{ layerVerdict(l) }}</span>
                </li>
              </ul>
              <p class="muted">云种按 ECMWF 单模式的气压层数据推得，上方云量百分比是多模式平均，两者口径不同。WMO 国际云图分档：低云 &lt;2 km、中云 2–6 km、高云 &gt;6 km。<b>这是推断，不是实测。</b></p>
            </FoldPanel>
            <FoldPanel title="方法说明：时间口径 / 四个机会 / 怎么算的 / 我们做不到的" count="8 节">
              <Explanations />
            </FoldPanel>
            <FoldPanel title="摄影圈天象词库" count="60 条 · 6 组" open>
              <div id="fc-phenomena"><Phenomena /></div>
            </FoldPanel>
            <FoldPanel title="参考文献与方法来源" count="13 条">
              <References />
            </FoldPanel>
          </div>
        </div>

        <p class="fc-fb-hint fc-o-hint">
          <b>拍完请回填一次</b>：点表格每行右侧的「✎」，记录实际烧到什么程度。
          攒够数据就能校准算法——这是让这个工具变准的唯一办法。
        </p>
      </template>
    </div>
  </section>

  <ForecastToast />
  <ForecastCardModal />
</template>
