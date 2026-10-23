<script setup lang="ts">
import { computed } from 'vue'
import { PHENOMENA, PHENO_GROUPS } from '@/data/forecast/phenomena'

/** 摄影圈天象词库：把追霞圈的黑话和气象判据对上（纯静态） */

const groups = computed(() =>
  PHENO_GROUPS.map((g) => ({
    name: g,
    items: PHENOMENA.filter((p) => p.group === g)
  })).filter((g) => g.items.length)
)

const total = PHENOMENA.length
</script>

<template>
  <section class="fc-pheno glass">
    <h3 class="fc-pheno-title">摄影圈天象词库<span>{{ total }} 个词条</span></h3>
    <p class="fc-pheno-intro">
      追霞的人不说“层积云覆盖率 40%”，说的是「鱼鳞云」「排骨云」「云被烧穿」「耶稣光」。
      下面这些词条按「出现条件 → 怎么拍 → 主要平台」整理好，
      每个机位的<b>详情</b>里只会挑此刻真正可能出现的几条，不必全记。
    </p>

    <div class="fc-pheno-grid">
      <details v-for="g in groups" :key="g.name" class="fc-pheno-group">
        <summary>{{ g.name }}<small>{{ g.items.length }} 条</small></summary>
        <dl>
          <template v-for="p in g.items" :key="p.key">
            <dt>
              {{ p.name }}
              <span v-if="p.alias" class="ph-alias">{{ p.alias }}</span>
              <em v-if="p.local" class="ph-local" :class="'is-' + p.local">{{ p.local }}</em>
            </dt>
            <dd>
              <span class="ph-line"><b>出现条件</b>{{ p.when }}</span>
              <span class="ph-line"><b>怎么拍</b>{{ p.shoot }}</span>
              <span class="ph-line ph-plat"><b>平台</b>{{ p.platform }}</span>
            </dd>
          </template>
        </dl>
      </details>
    </div>

    <p class="fc-pheno-src">
      来源：WMO《国际云图》云属/云种命名；
      追霞圈「小烧/中烧/大烧」分级见
      <a href="http://news.cnhubei.com/content/2025-05/24/content_19201649.html" target="_blank" rel="noopener">荆楚网《小烧？中烧？大烧？追霞者网上分享火烧云情报》</a>；
      晕、幻日、环天顶弧等冰晶光学现象见
      <a href="https://zh.wikipedia.org/wiki/%E6%9A%88" target="_blank" rel="noopener">维基百科「晕」</a>；
      火烧云判据与 AOD 分级见
      <a href="https://www.sunsetbot.top/halo/" target="_blank" rel="noopener">SunsetBot 教程</a>；
      平台口语（天空调色盘、云被烧穿等）来自小红书/抖音追霞话题。
      <b>词条里的条件是为本站数据写的近似判据，不是严格气象定义。</b>
    </p>
  </section>
</template>
