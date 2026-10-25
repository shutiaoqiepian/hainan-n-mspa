<script setup lang="ts">
import { areasFor } from '@/data/forecast/spots'
import { state } from '@/lib/forecast/state'

import { computed } from 'vue'

/** 区域筛选（旧版 #fc-areas 里的一排 chip）；分区随省份变化。
    观测点模式（?obs=1）下多出「XX·观测点」，方便核对机场预报分。 */
const areas = computed(() => areasFor(state.prov, state.obsMode))
function pick(a: string): void {
  state.area = a
}
</script>

<template>
  <div class="fc-areas" id="fc-areas">
    <button v-for="a in areas" :key="a" class="chip" :class="{ 'is-on': state.area === a }" @click="pick(a)">{{ a }}</button>
  </div>
</template>
