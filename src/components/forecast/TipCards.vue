<script setup lang="ts">
import { computed } from 'vue'
import type { Phototip, Row } from '@/lib/forecast/types'
import { PHENOMENA } from '@/data/forecast/phenomena'
import FogCard from './FogCard.vue'

/** 当次能拍的天象：从词库里按当前天况挑出来的几条，做成小卡片。
    默认收着标题，点开看「为什么 / 怎么拍」——比原来藏在「详情」里更容易发现。
    每张卡片带一个稀有度评级（每天 / 常见 / 少见 / 罕见 / 几乎不可能），
    和词库用的是同一套词、同一套配色，用户不用记两套说法。 */

/* row 可选：给了就额外渲染「雾」那一条（唯一带百分比的天象）。
   它是异步取海温的，所以做成独立组件，不混进 tips 数组，
   也就不参与 matchPhenomena 的排序。 */
const props = defineProps<{ tips: Phototip[]; row?: Row }>()
const emit = defineEmits<{ (e: 'openAll'): void }>()

const list = computed(() => props.tips)
/* 词条总数从数据读，不要再写死 —— 这里原来写「60 条」，
   词库扩到 68 条之后就一直是错的。 */
const total = PHENOMENA.length
</script>

<template>
  <div v-if="list.length || row" class="fc-tipcards">
    <FogCard v-if="row" :row="row" />
    <details v-for="t in list" :key="t.key" class="fc-tipcard">
      <summary>
        <div class="name">
          <b>{{ t.name }}</b>
          <em class="ph-local" :class="'is-' + t.rarity" :title="'出现稀有度：' + t.rarity">{{ t.rarity }}</em>
        </div>
        <small>{{ t.alias }}</small>
        <i class="caret" aria-hidden="true">+</i>
      </summary>
      <div class="tb">
        <p><b>为什么可能出现：</b>{{ t.why }}</p>
        <p><b>怎么拍：</b>{{ t.shoot }}</p>
      </div>
    </details>
    <button class="fc-tipmore" type="button" @click="emit('openAll')">
      查看全部 {{ total }} 条词条 <span>▾</span>
    </button>
  </div>
</template>
