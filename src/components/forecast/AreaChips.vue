<script setup lang="ts">
import { AREAS } from '@/data/forecast/spots'
import { state } from '@/lib/forecast/state'

/** 区域筛选（旧版 #fc-areas 里的一排 chip） */
function pick(a: string): void {
  state.area = a
}
</script>

<template>
  <div class="fc-areas" id="fc-areas">
    <button v-for="a in AREAS" :key="a" class="chip" :class="{ 'is-on': state.area === a }" @click="pick(a)">{{ a }}</button>
  </div>
</template>
