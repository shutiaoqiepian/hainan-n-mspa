<script setup lang="ts">
import { computed } from 'vue'
import type { Phototip } from '@/lib/forecast/types'
import { PHENOMENA } from '@/data/forecast/phenomena'

/** 当次能拍的天象：从词库里按当前天况挑出来的几条，做成小卡片。
    默认收着标题，点开看「为什么 / 怎么拍」——比原来藏在「详情」里更容易发现。
    每张卡片带一个稀有度评级（每天 / 常见 / 少见 / 罕见 / 几乎不可能），
    和词库用的是同一套词、同一套配色，用户不用记两套说法。 */

const props = defineProps<{ tips: Phototip[] }>()
const emit = defineEmits<{ (e: 'openAll'): void }>()

const list = computed(() => props.tips)
/* 词条总数从数据读，不要再写死 —— 这里原来写「60 条」，
   词库扩到 68 条之后就一直是错的。 */
const total = PHENOMENA.length
</script>

<template>
  <div v-if="list.length" class="fc-tipcards">
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
