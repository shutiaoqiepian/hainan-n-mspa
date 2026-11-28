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
const props = defineProps<{ tips: Phototip[]; otherTips?: Phototip[]; row?: Row }>()
const emit = defineEmits<{ (e: 'openAll'): void }>()

const list = computed(() => props.tips)
/* 今天其它时段才成立的词条（白天冰晶、夜间星空）。
   这里只报名字、不展开卡片 —— 它们不是「此刻能拍」的，展开会跟上面抢注意力。 */
const other = computed(() => props.otherTips ?? [])
const otherGroups = computed(() => {
  const out: Array<{ label: string; items: Phototip[] }> = []
  const day = other.value.filter((t) => t.scope === 'day')
  const night = other.value.filter((t) => t.scope === 'night')
  if (day.length) out.push({ label: '今天白天', items: day })
  if (night.length) out.push({ label: '今晚', items: night })
  return out
})
/* 词条总数从数据读，不要再写死 —— 这里原来写「60 条」，
   词库扩到 68 条之后就一直是错的。 */
const total = PHENOMENA.length
</script>

<template>
  <div v-if="list.length || row || otherGroups.length" class="fc-tipcards">
    <FogCard v-if="row" :row="row" />
    <details v-for="t in list" :key="t.key" class="fc-tipcard">
      <summary>
        <div class="name">
          <b>{{ t.name }}</b>
          <em class="ph-local" :class="'is-' + t.rarity" :title="'出现稀有度：' + t.rarity + '（词库按海南一年内的出现频率标定，高纬机位需自行下调）'">{{ t.rarity }}</em>
        </div>
        <small>{{ t.alias }}</small>
        <i class="caret" aria-hidden="true">+</i>
      </summary>
      <div class="tb">
        <p v-if="t.window"><b>出现时间：</b>{{ t.window }}</p>
        <p><b>为什么可能出现：</b>{{ t.why }}</p>
        <p><b>怎么拍：</b>{{ t.shoot }}</p>
      </div>
    </details>
    <div v-if="otherGroups.length" class="fc-tipother">
      <p v-for="g in otherGroups" :key="g.label">
        <b>{{ g.label }}</b>
        <em v-for="t in g.items" :key="t.key" :title="t.why">{{ t.name }}<span v-if="t.window">{{ t.window }}</span></em>
      </p>
    </div>
    <button class="fc-tipmore" type="button" @click="emit('openAll')">
      查看全部 {{ total }} 条词条 <span>▾</span>
    </button>
  </div>
</template>
