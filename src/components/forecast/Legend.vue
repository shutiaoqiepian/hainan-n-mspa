<script setup lang="ts">
/** 等级图例：六档颜色与分数阈值。
 *  2026-11-06 起不再手写阈值，直接从 LEVELS 生成 —— 上次「最高档改名」就得手改
 *  六行 HTML，改漏一行就会和图例打架。
 *  2026-11-07 起派生逻辑抽到 levels.ts 的 levelBands()，这里只渲染。
 *  （顺带修掉一个旧 bug：最低档「不烧」原来写成 '<0'，正确是 '0–29'。） */
import { SCORE_MAX, levelBands } from '@/data/forecast/levels'

const bands = levelBands()
</script>

<template>
  <div class="fc-legend-wrap">
    <div class="fc-legend">
      <span v-for="b in bands" :key="b.name"><i :style="{ background: b.color }"></i>{{ b.name }} {{ b.range }}</span>
    </div>
    <p class="fc-legend-note">
      <b>本站口径</b>：上面是本站自己的 0–{{ SCORE_MAX }} 分制，不是任何一家的官方分级。
      SunsetBot 用 0–2.5 的“鲜艳度”，莉景天气、Windy 又各有阈值，
      「大烧」这个词在每家对应的数字都不一样 —— 拿去和别人对比时，先看是不是同一套口径。
      <br />
      分数正好压在分界上的时候，档位会写成区间（例如「小烧到中烧」）：这是在说
      「别把这个档次当成定论」，不是概率，也不是「小烧和小烧中间还有一档」。
    </p>
  </div>
</template>
