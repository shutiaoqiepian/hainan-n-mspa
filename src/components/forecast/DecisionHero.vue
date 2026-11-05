<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { state } from '@/lib/forecast/state'
import { openSpotCard } from '@/lib/forecast/card-ui'
import { clarityLabel, pillarLabel, rainbowLabel, raysLabel } from '@/lib/forecast/scoring'
import { clockText, dateText } from '@/lib/forecast/time'
import type { Row } from '@/lib/forecast/types'

/** 首屏决策卡：分数 + 等级 + 结论 + 两个峰值时刻 + 六格指标 + 四个机会指数
    原来分散在「大标题 / 时间条 / 图例 / 首行卡片」里的信息，合成一张卡。 */

/* 2026-11-05 精简：原来还收 others（第 2–4 名）和 select / gotoRank 两个事件，
   用来在决策卡里放「另外 N 个机位」胶囊。那块已删（下面就是完整排行表），
   所以一并收窄，避免留死代码。 */
const props = defineProps<{ row: Row; rank: number; total: number }>()

const emit = defineEmits<{ (e: 'showLayers'): void }>()

/**
 * 跳到「大气剖面」页（/cross）的链接。
 *
 * 带的是机位**名字 + 经纬度**，不是 id —— 因为 spots.json 里没有 id 字段，
 * 而 /cross 的 national-index.json 里两者都有：那边会先按名字在全国 224 机位里
 * 精确匹配（resolveIncoming），匹配不到再按经纬度就近找。
 * 时次和方位不带：全国机位只有「当天日落方位」那一个剖面，
 * /cross 会自己选最接近日落的时次。
 *
 * ★ 必须带 kind（sunrise / sunset）。
 *   2026-11-04 用户报「我选的是日出，剖面却是日落」：
 *   原来这里不传 kind，/cross 又只有日落逻辑，于是从「朝霞」卡片点进去
 *   看到的仍是西面 254° 的日落剖面 —— 数据没错，但答非所问。
 *   /cross 读到 kind=sunrise 时会明确告诉用户「这是日落剖面，不是朝霞」。
 */
const crossHref = computed(() => {
  const sp = props.row.spot
  const q = new URLSearchParams({
    name: sp.n,
    lat: String(sp.lat),
    lon: String(sp.lon),
    kind: state.kind
  })
  return `cross.html?${q.toString()}`
})

/* 「下次约几点更新」——让用户知道手上的数据有多新、什么时候会变。
   时刻表在 lib/forecast/time.ts 的 CACHE_SLOTS 里，跟着 ECMWF/GFS 的发布走。
   只在读的是预生成缓存时才显示：实时请求没有「下次」这回事。 */
const nextText = computed(() =>
  state.fromStatic && state.nextUpdateAt ? clockText(state.nextUpdateAt) : ''
)

/* ---------- 云层剖面速览 ----------
   「能不能烧」的答案基本就写在 8 个气压层那几行里，
   但那张表在手机上要往下滚三屏。决策卡这里先用一根极简的竖条把它画出来：
   每层一条横条，长度 = 云量，**颜色 = 这层如果被照亮会染成什么色**
   （和顶部「鲜亮度 75 橙金」同一套档位），发光的 = 太阳能从底下穿透。
   点整块或右边的按钮 → 滚下去、把那 8 行判据全部摊开。 */

/** vividLabel 的七个档 → 实际颜色。刻意和等级色（灰/绿/黄/橙）分开，
    这样「能烧」和「烧成什么色」是两套视觉语言，不会互相打架。 */
const HUE_COLOR: Record<string, string> = {
  火烧: '#ff5a2e',
  橙金: '#ffa72b',
  粉紫: '#e07ef0',
  湛蓝: '#4fb3e8',
  淡彩: '#9fb6c4',
  近灰: '#7b848c',
  无: '#3a4046'
}

const profile = computed(() => {
  const ls = d.value.layers
  const hues = props.row.hues ?? []
  /* detail.layers 与 row.hues 同序同长（都在 compute 里按同一数组生成） */
  const layers = ls
    .map((l, i) => ({
      level: l.level,
      height: l.height,
      cover: l.cover,
      band: (l.height >= 6000 ? 'high' : l.height >= 2000 ? 'mid' : 'low') as 'high' | 'mid' | 'low',
      reachable: l.lit,
      genus: l.code === '--' ? '无云' : l.genus,
      hue: hues[i] && l.code !== '--' ? hues[i] : '无'
    }))
    .sort((a, b) => b.height - a.height)

  const lit = layers.filter((l) => l.reachable && l.cover > 0)

  /* ★ 「会烧成 X」只能由**中高云**决定。
     vividLabel 里的「湛蓝 / 近灰」原本是描述「整片天空鲜亮度」的词，
     拿它去说某层云「会烧成湛蓝」在物理上讲不通 —— 云不会被烧成蓝色，
     那是晴空底色。而且低层云（积云 / 层积云）太阳一低就被地面挡住，
     正常只成暗色剪影，根本谈不上「烧成什么色」。
     2026-11-05 用户报「积云会烧成湛蓝，下面却说高云被照亮」，就是这个原因。 */
  const isHighOrMid = (l: { height: number }): boolean => l.height >= 2000
  const canvasLit = lit.filter(isHighOrMid)

  /* 结论文案里代表「天上那张画布」的层：优先中高云。
     没有中高云时才退回低云，但那种情况下面会明确说它是剪影，不是画布。 */
  const topLit = canvasLit.length
    ? canvasLit.reduce((a, b) => (a.cover >= b.cover ? a : b))
    : (lit.length ? lit.reduce((a, b) => (a.cover >= b.cover ? a : b)) : null)

  /* 色阶只在中高云里取；「湛蓝 / 近灰 / 淡彩」这三档表示「几乎没有颜色」，
     不该被当成「会烧成这个色」播报（否则会出现「会烧成湛蓝」这种话）。
     至少要有「粉紫」及以上，才值得用「会烧成 X」的句式。 */
  const RANK = ['无', '近灰', '淡彩', '湛蓝', '粉紫', '橙金', '火烧']
  const COLORS = ['粉紫', '橙金', '火烧']
  let bestHue = '无'
  for (const l of canvasLit) {
    if (l.cover < 10) continue
    if (!COLORS.includes(l.hue)) continue
    if (RANK.indexOf(l.hue) > RANK.indexOf(bestHue)) bestHue = l.hue
  }

  return { layers, lit, canvasLit, topLit, bestHue, hueColor: HUE_COLOR }
})

const r = computed(() => props.row)
const d = computed(() => props.row.detail)
const m = computed(() => props.row.m)
const kindWord = computed(() => (state.kind === 'sunrise' ? '日出' : '日落'))

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
    /* 55–78% 才是评分里 fHigh 的满分区间，原来写 40–80% 会让 40–55% 的高云
       显示成「理想」却拿到低分，用户会以为算错了。 */
    { k: '高云', v: round(mm.high), u: '%', s: '理想 55–78%', c: '' },
    { k: '中云', v: round(mm.mid), u: '%', s: '越少越好', c: '' },
    { k: '低云', v: round(mm.low), u: '%', s: '挡住地平线', c: '' },
    { k: 'AOD', v: fx(mm.aod, 2), u: '', s: mm.aodMissing ? '缺测' : v.aodName + ' · 0.5 内通透', c: '' },
    { k: '降水概率', v: round(mm.pop), u: '%', s: '越低越好', c: '' },
    { k: '鲜亮度', v: String(v.vivid), u: v.vividLabel, s: '本站 0–100，非 SunsetBot 口径', c: 'var(--accent-b)' }
  ]
})

const peakBetter = computed(() => r.value.peakScore > r.value.score + 4)

/* ---------- 窄屏渐进式披露 ----------
   「四个机会指数」是参考项，不是「今天去不去」的结论。手机上 4 格色条要吃掉
   约 145px，而结论句 / 等级 / 数据状态已经在上面讲清楚了。这里窄屏默认收成
   一行摘要（数值一条不删，DOM 里始终存在），点开与宽屏完全一致。
   桌面（>560px）不渲染摘要行、网格照旧，布局零变化。 */
const NARROW_MQ = '(max-width: 560px)'
const narrow = ref(window.matchMedia(NARROW_MQ).matches)
let narrowMq: MediaQueryList | null = null
const oppsOpen = ref(false)
function onNarrowChange(e: MediaQueryListEvent): void {
  narrow.value = e.matches
  if (e.matches) oppsOpen.value = false
}
onMounted(() => {
  narrowMq = window.matchMedia(NARROW_MQ)
  narrow.value = narrowMq.matches
  narrowMq.addEventListener('change', onNarrowChange)
})
onBeforeUnmount(() => {
  narrowMq?.removeEventListener('change', onNarrowChange)
})

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
      <!-- 出发建议 2026-11-05 从首屏撤掉：它和上面那句 headline 语义高度重叠
           （都是「这次不值得专门跑」）。原文没丢 —— 下方「专业判定与参考 →
           判定依据：这个分怎么来的」折叠面板里一直有完整的「出发建议」。 -->

      <!-- 单机位名片：这一页最需要转发的就是「这个机位这个分数」 -->
      <div class="dh-share">
        <button class="dh-share-btn" type="button" @click="onShare">
          <span class="ico" aria-hidden="true">⤴</span>
          <span class="tx">
            <b>生成{{ r.spot.n }}名片</b>
            <small>带二维码的图，发群里 / 朋友圈</small>
          </span>
        </button>
        <!-- 「5 分 · 不烧 · 日出 06:41」2026-11-05 删除：
             这三件事在上面分别已经出现过（大分数、等级名、时间行），
             名片按钮旁边再重复一遍没有信息增量。 -->
      </div>

      <!-- 云层剖面速览：8 层云量一根竖条，点开看每一层的判据 -->
      <div class="dh-prof">
        <div class="dh-prof-hd">
          <b>云层剖面</b>
          <span>{{ profile.layers.length }} 层 · 颜色 = 被{{ kindWord === '日出' ? '朝阳' : '夕阳' }}照亮后的色</span>
        </div>
        <button class="dh-prof-body" type="button" @click="emit('showLayers')">
          <span class="bars" aria-hidden="true">
            <i
              v-for="(l, i) in profile.layers"
              :key="l.level"
              :style="{
                '--w': Math.max(2, l.cover) + '%',
                '--c': profile.hueColor[l.hue],
                '--d': i * 30 + 'ms',
                opacity: l.reachable ? 1 : 0.4
              }"
              :class="{ lit: l.reachable, empty: l.cover < 2 }"
            ></i>
          </span>
          <span class="tx">
            <b>
              <!-- 只有识别出「粉紫 / 橙金 / 火烧」这种真正被染上的颜色，才说「会烧成 X」。
                   否则说「哪一层能被照亮」，而不是硬套一个颜色词
                   （「会烧成湛蓝」是说不通的 —— 蓝是晴空底色，不是云的烧色）。 -->
              <template v-if="profile.bestHue !== '无'">会烧成<span :style="{ color: profile.hueColor[profile.bestHue] }">{{ profile.bestHue }}</span></template>
              <template v-else-if="profile.topLit && profile.topLit.height >= 2000">
                有云可被照亮 · 颜色偏淡
              </template>
              <template v-else-if="profile.topLit">{{ profile.topLit.genus }}·剪影</template>
              <template v-else>没有能被照亮的云</template>
            </b>
            <small>
              <template v-if="profile.topLit">{{ profile.topLit.genus }} {{ profile.topLit.cover }}% · {{ profile.topLit.height >= 1000 ? (profile.topLit.height / 1000).toFixed(1) + ' km' : profile.topLit.height + ' m' }}</template>
              <template v-else>{{ profile.layers.length }} 层都不够薄，{{ kindWord === '日出' ? '朝阳' : '夕阳' }}穿不过去</template>
            </small>
          </span>
          <span class="ico" aria-hidden="true">↓</span>
          <span class="sr-only">展开云层剖面并查看每一层的判据</span>
        </button>
      </div>

      <!-- 「另外 24 个机位」三个胶囊 2026-11-05 删除：
           紧接着就是「全部 25 个机位」排行表，同样的机位、同样的分数、
           还多了 AOD 和鲜亮度。这一块纯属把下面那张表提前说一遍。 -->
    </div>

    <!-- 中：大分数 + 等级尺 + 两个峰值 -->
    <div class="dh-score">
      <div class="dh-big" :style="{ color: r.level.color }">{{ r.score }}<small>/96</small></div>
      <div class="dh-lvl" :style="{ color: r.level.color }">{{ r.level.name }}</div>
      <!-- 六档色尺（不烧/微烧/…/火烧云）2026-11-05 删除：
           大分数下面已经有等级名（「不烧」），色尺只是把同一件事再画一遍，
           白占 27px。真要对照全档位，排行表的等级列里一直有。 -->
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
      <!-- 每格下面的说明（「理想 55–78%」「越少越好」…）是**恒定文字，每天一样**，
           不是当天数据。2026-11-05 从版面上撤掉、改成 title 提示：
           信息还在（悬停可看、读屏可读），但不再占 6 行。 -->
      <div v-for="c in cells" :key="c.k" class="dh-cell" :title="c.s">
        <span class="k">{{ c.k }}</span>
        <span class="v" :style="c.c ? { color: c.c } : undefined">
          {{ c.v == null ? '缺测' : c.v }}<em v-if="c.u">{{ c.u }}</em>
        </span>
      </div>
    </div>

    <!-- 大气剖面：把「这个分数为什么是这样」摊开成一张切面图。
         放在「云层剖面速览」之后 —— 速览是结论，这里是同一件事的深入版。
         用 <a> 而不是 button：这是真跳转，新标签打开、右键复制链接都该正常。 -->
    <a class="dh-xsec" :href="crossHref">
      <span class="dh-xsec-ico" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="dh-xsec-tx">
        <b>大气剖面</b>
        <small>沿镜头方向切开 320 km：云在哪几层、阳光能不能照到</small>
      </span>
      <span class="dh-xsec-arw" aria-hidden="true">→</span>
    </a>

    <!-- 四个机会指数：窄屏默认收起为一行摘要（内容零删除，展开后与宽屏一致） -->
    <div class="dh-opps-wrap">
      <button
        v-if="narrow"
        class="dh-opps-sum s2b-toggle"
        type="button"
        :aria-expanded="oppsOpen ? 'true' : 'false'"
        @click="oppsOpen = !oppsOpen"
      >
        <b>四机会指数</b>
        <span>通透 {{ opps[0].v }} · 云隙光 {{ opps[1].v }} · 光柱 {{ opps[2].v }} · 彩虹 {{ opps[3].v }}</span>
        <i aria-hidden="true">{{ oppsOpen ? '收起判据' : '展开判据' }}</i>
      </button>
      <div v-show="!narrow || oppsOpen" class="dh-opps">
        <div v-for="o in opps" :key="o.k" class="dh-opp">
          <div class="oh"><b>{{ o.k }}</b><span :style="{ color: o.c }">{{ o.v }}</span></div>
          <div class="ob"><i :style="{ width: Math.max(0, Math.min(100, o.v)) + '%', background: o.c }"></i></div>
          <div class="ow" :style="{ color: o.c }">{{ o.w }}</div>
          <div class="on">{{ o.note }}</div>
        </div>
      </div>
    </div>

    <!-- 数据状态（替代原来 179px 的时间条） -->
    <div class="dh-status">
      <!-- 【预报对象】和上面的时间行完全重复（日期/星期/日出/时刻都有）；
           【来源 8 模式】和页面顶部的模式下拉框重复；
           【格点 18.50°N,110.00°E 同格点共享】是排障用的坐标，
           而机位详情面板里本来就写着。三条一并撤掉，只留「数据多新」和「完整度」。 -->
      <span>数据 <b>{{ state.updatedAt ? new Date(state.updatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '读取中' }}</b><template v-if="nextText"><em>下次约 {{ nextText }}</em></template></span>
      <span class="q" :class="{ bad: r.quality.status !== 'ok' }">
        数据完整度 <b>{{ r.quality.completeness }}%</b>
        <template v-if="r.quality.status !== 'ok'">（缺 {{ r.quality.missing.join('、') }}）</template>
      </span>
    </div>
  </section>
</template>
