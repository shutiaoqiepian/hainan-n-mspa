<script setup lang="ts">
import { computed } from 'vue'
import type { Phototip } from '@/lib/forecast/types'

/** 当次能拍的题材：从 60 条词库里按当前天况挑出来的几条，做成小卡片。
    默认收着标题，点开看「为什么 / 怎么拍」——比原来藏在「详情」里更容易发现。 */

const props = defineProps<{ tips: Phototip[] }>()
const emit = defineEmits<{ (e: 'openAll'): void }>()

const list = computed(() => props.tips)
</script>

<template>
  <div v-if="list.length" class="fc-tipcards">
    <details v-for="t in list" :key="t.key" class="fc-tipcard">
      <summary>
        <b>{{ t.name }}</b>
        <small>{{ t.alias }}</small>
        <i class="caret" aria-hidden="true">+</i>
      </summary>
      <div class="tb">
        <p><b>为什么可能出现：</b>{{ t.why }}</p>
        <p><b>怎么拍：</b>{{ t.shoot }}</p>
      </div>
    </details>
    <button class="fc-tipmore" type="button" @click="emit('openAll')">
      查看全部 60 条词条 <span>▾</span>
    </button>
  </div>
</template>
