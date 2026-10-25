<script setup lang="ts">
import { computed } from 'vue'
import { state } from '@/lib/forecast/state'
import { openSpotCard } from '@/lib/forecast/card-ui'
import { clarityLabel, pillarLabel, rainbowLabel, raysLabel } from '@/lib/forecast/scoring'
import { dateText } from '@/lib/forecast/time'
import type { Row } from '@/lib/forecast/types'

/** 首屏决策卡：分数 + 等级 + 结论 + 两个峰值时刻 + 六格指标 + 四个机会指数
    原来分散在「大标题 / 时间条 / 图例 / 首行卡片」里的信息，合成一张卡。 */

const props = defineProps<{ row: Row; rank: number; total: number; others: Row[] }>()

const emit = defineEmits<{ (e: 'select', name: string): void; (e: 'gotoRank'): void }>()

/* 决策卡只讲一个机位，很容易被当成「今天只有一个点」。
   这里把第 2–4 名做成三颗可点的胶囊，并给一个跳到完整排行的入口。 */
const rivals = computed(() => props.others.slice(0, 3))

const r = computed(() => props.row)
const d = computed(() => props.row.detail)
const m = computed(() => props.row.m)
const kindWord = computed(() => (state.kind === 'sunrise' ? '日出' : '日落'))

/* 等级尺：六档，当前档位不透明 */
const BANDS = [
  { c: '#5b636a', w: '不烧' },
  { c: '#8f979f', w: '微烧' },
  { c: '#9ad9b8', w: '小烧' },
  { c: '#ffd166', w: '中烧' },
  { c: '#ff9640', w: '大烧' },
  { c: '#ff6a3d', w: '火烧云' }
]

const opps = computed(() => {
  const v = r.value
  return [
    { k: '通透', v: v.clarity, w: clarityLabel(v.clarity), c: '#4fb3e8', note: '气溶胶 + 能见度 + 云量' },
    { k: '云隙光', v: v.rays, w: raysLabel(v.rays), c: '#ffd166', note: '丁达尔 · 耶稣光' },
    { k: '光柱', v: v.pillar, w: pillarLabel(v.pillar), c: '#c9a6ff', note: '冰晶竖着反射阳光' },
    { k: '彩虹', v: v.rainbowScore, w: rainbowLabel(v.rainbowScore), c: '#7fd6a8', note: '太阳 3–42° + 有雨' }
  ]
})

/* 六格关键指标 */
const cells = computed(() => {
  const mm = m.value
  const v = r.value
  const round = (x: number | null): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x))
  const fx = (x: number, n: number): string => (Math.round(x * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n)
  return [
    { k: '高云', v: round(mm.high), u: '%', s: '理想 40–80%', c: '' },
    { k: '中云', v: round(mm.mid), u: '%', s: '越少越好', c: '' },
    { k: '低云', v: round(mm.low), u: '%', s: '挡住地平线', c: '' },
    { k: 'AOD', v: fx(mm.aod, 2), u: '', s: mm.aodMissing ? '缺测' : v.aodName + ' · 0.5 内通透', c: '' },
    { k: '降水概率', v: round(mm.pop), u: '%', s: '越低越好', c: '' },
    { k: '鲜亮度', v: String(v.vivid), u: v.vividLabel, s: '本站 0–100，非 SunsetBot 口径', c: 'var(--accent-b)' }
  ]
})

const peakBetter = computed(() => r.value.peakScore > r.value.score + 4)

/* 单机位名片：图里带二维码，链接可以在弹窗里单独复制 */
function onShare(): void {
  openSpotCard(props.row)
}
</script>

<template>
  <section class="dh" :class="{ 'is-loading': state.loading }">
    <!-- 左：谁 / 什么时候 / 为什么 -->
    <div class="dh-main">
      <div class="dh-eyebrow">
        第 {{ rank }} / {{ total }} 顺位
        <span class="dh-flag">{{ rank === 1 ? '当前最高分' : '当前选中' }}</span>
        <span v-if="state.model !== 'multi'" class="dh-flag mdl">{{ state.model }} 单模式</span>
      </div>
      <h1 class="dh-name">
        {{ r.spot.n }}
        <span class="dh-fac">朝{{ r.spot.face }} · {{ r.spot.area }}</span>
      </h1>
      <p class="dh-when">
        <b>{{ dateText(d.date, d.weekday) }} · {{ kindWord }} {{ d.time }}</b>
        <span class="sep">|</span>太阳方位 {{ r.sunAz == null ? '—' : r.sunAz + '°' }}
        <span class="sep">|</span>黄金时刻 {{ d.golden }}
        <span class="sep">|</span>蓝调 {{ d.blue }}
      </p>
      <p class="dh-head">{{ d.interpret.headline }}</p>
      <p class="dh-advice">{{ d.interpret.advice }}</p>

      <!-- 单机位名片：这一页最需要转发的就是「这个机位这个分数」 -->
      <div class="dh-share">
        <button class="dh-share-btn" type="button" @click="onShare">
          <span class="ico" aria-hidden="true">⤴</span>
          <span class="tx">
            <b>生成{{ r.spot.n }}名片</b>
            <small>带二维码的图，发群里 / 朋友圈</small>
          </span>
        </button>
        <span class="dh-share-hint">{{ r.score }} 分 · {{ r.level.name }} · {{ kindWord }} {{ d.time }}</span>
      </div>

      <!-- 这一页不止一个机位：把第 2–4 名直接摆出来 -->
      <div v-if="total > 1" class="dh-rivals">
        <span class="k">另外 {{ total - 1 }} 个机位</span>
        <div class="chips">
          <button
            v-for="o in rivals"
            :key="o.spot.n"
            type="button"
            :title="'切到 ' + o.spot.n + '（朝' + o.spot.face + '，' + o.level.name + '）'"
            @click="emit('select', o.spot.n)"
          >
            {{ o.spot.n }}<b :style="{ color: o.level.color }">{{ o.score }}</b>
          </button>
        </div>
        <button class="all" type="button" @click="emit('gotoRank')">全部 {{ total }} 个 ↓</button>
      </div>
    </div>

    <!-- 中：大分数 + 等级尺 + 两个峰值 -->
    <div class="dh-score">
      <div class="dh-big" :style="{ color: r.level.color }">{{ r.score }}<small>/96</small></div>
      <div class="dh-lvl" :style="{ color: r.level.color }">{{ r.level.name }}</div>
      <div class="dh-scale">
        <div class="dh-bar">
          <i
            v-for="b in BANDS"
            :key="b.c"
            :style="{ background: b.c, opacity: r.level.color === b.c ? 1 : 0.3 }"
          ></i>
        </div>
        <div class="dh-lab"><span v-for="b in BANDS" :key="b.w">{{ b.w }}</span></div>
      </div>
      <div class="dh-moments">
        <div class="dh-mom">
          <span class="k">最佳时刻</span>
          <b :style="{ color: peakBetter ? 'var(--warn)' : 'var(--muted)' }">{{ r.peakTime || '—' }}</b>
          <span class="v">{{ r.peakScore }} 分</span>
          <span class="n">分数最高的一小时</span>
        </div>
        <div class="dh-mom">
          <span class="k">鲜艳度峰值</span>
          <b style="color: var(--accent-b)">{{ r.vividPeakTime || '—' }}</b>
          <span class="v">{{ r.vividPeakLabel }} · {{ r.vividPeak }}</span>
          <span class="n">颜色最浓的一小时</span>
        </div>
      </div>
    </div>

    <!-- 六格关键指标 -->
    <div class="dh-grid">
      <div v-for="c in cells" :key="c.k" class="dh-cell">
        <span class="k">{{ c.k }}</span>
        <span class="v" :style="c.c ? { color: c.c } : undefined">
          {{ c.v == null ? '缺测' : c.v }}<em v-if="c.u">{{ c.u }}</em>
        </span>
        <span class="s">{{ c.s }}</span>
      </div>
    </div>

    <!-- 四个机会指数 -->
    <div class="dh-opps">
      <div v-for="o in opps" :key="o.k" class="dh-opp">
        <div class="oh"><b>{{ o.k }}</b><span :style="{ color: o.c }">{{ o.v }}</span></div>
        <div class="ob"><i :style="{ width: Math.max(0, Math.min(100, o.v)) + '%', background: o.c }"></i></div>
        <div class="ow" :style="{ color: o.c }">{{ o.w }}</div>
        <div class="on">{{ o.note }}</div>
      </div>
    </div>

    <!-- 数据状态（替代原来 179px 的时间条） -->
    <div class="dh-status">
      <span>预报对象 <b>{{ dateText(d.date, d.weekday) }} {{ kindWord }} {{ d.time }}</b></span>
      <span>数据 <b>{{ state.updatedAt ? new Date(state.updatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '读取中' }}</b></span>
      <span>来源 <b>{{ state.model === 'multi' ? '8 模式（ECMWF/ICON/GFS 计分）' : state.model + ' 单模式' }}</b></span>
      <span>格点 <b>{{ d.grid || '—' }}</b><em>同格点共享一份气象数据</em></span>
      <span class="q" :class="{ bad: r.quality.status !== 'ok' }">
        数据完整度 <b>{{ r.quality.completeness }}%</b>
        <template v-if="r.quality.status !== 'ok'">（缺 {{ r.quality.missing.join('、') }}）</template>
      </span>
    </div>
  </section>
</template>
