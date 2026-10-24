<script setup lang="ts">
import AreaChips from './AreaChips.vue'
import { MODELS } from '@/data/forecast/models'
import type { KindKey } from '@/lib/forecast/types'
import { load, clearCache } from '@/lib/forecast/api'
import { state } from '@/lib/forecast/state'
import { REGIONS, provincesOfRegion, provName } from '@/data/forecast/spots'
import type { ProvKey } from '@/lib/forecast/types'

/** 日期 / 时段 / 模式切换（旧版 .fc-controls） */

function pickDay(d: number): void {
  state.day = d
  load()
}

function pickKind(k: KindKey): void {
  state.kind = k
  load()
}

/* 切省份：清缓存、区域复位、重新取数据 */
function onProv(e: Event): void {
  const sel = e.target as HTMLSelectElement
  pickProv(sel.value)
}

function pickProv(p: ProvKey): void {
  if (state.prov === p) return
  if (!provName(p)) return
  state.prov = p
  state.area = '全部'
  state.openSpot = ''
  clearCache()
  load(true)
}

/* 切模式要强制刷新：旧版直接清掉 CACHE 再 load(true) */
function pickModel(e: Event): void {
  const sel = e.target as HTMLSelectElement
  state.model = sel.value || 'multi'
  clearCache()
  load(true)
}
</script>

<template>
  <div class="fc-controls">
    <div class="fc-picks">
      <label class="fc-prov-wrap">
        <span>省份</span>
        <select class="fc-select fc-prov" aria-label="省份" :value="state.prov" @change="onProv">
          <optgroup v-for="r in REGIONS" :key="r" :label="r">
            <option v-for="p in provincesOfRegion(r)" :key="p.key" :value="p.key">{{ p.name }}</option>
          </optgroup>
        </select>
      </label>
      <div class="fc-modes" role="group" aria-label="日期">
        <button class="fc-mode" :class="{ 'is-on': state.day === 0 }" type="button" data-day="0" @click="pickDay(0)">今天</button>
        <button class="fc-mode" :class="{ 'is-on': state.day === 1 }" type="button" data-day="1" @click="pickDay(1)">明天</button>
      </div>
      <div class="fc-modes" role="group" aria-label="时段">
        <button class="fc-mode" :class="{ 'is-on': state.kind === 'sunrise' }" type="button" data-kind="sunrise" @click="pickKind('sunrise')">日出</button>
        <button class="fc-mode" :class="{ 'is-on': state.kind === 'sunset' }" type="button" data-kind="sunset" @click="pickKind('sunset')">日落</button>
      </div>
      <label class="fc-model-wrap">
        <span>模式</span>
        <select id="fc-model" class="fc-select" aria-label="预报模式" :value="state.model" @change="pickModel">
          <option value="multi">多模式（ECMWF+ICON+GFS）</option>
          <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.name }} · {{ m.tag }}</option>
        </select>
      </label>
    </div>
    <AreaChips />
  </div>
</template>
