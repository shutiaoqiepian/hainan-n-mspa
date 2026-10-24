<script setup lang="ts">
import { ref } from 'vue'

/** 可折叠面板：默认展开状态可控、键盘可用（原生 details/summary）、可同时展开多个。
    第四层「专业判定与参考」统一用这个壳。 */

const props = withDefaults(
  defineProps<{ title: string; count?: string; open?: boolean; lazy?: boolean }>(),
  { count: '', open: false, lazy: false }
)

const isOpen = ref(props.open)
</script>

<template>
  <details class="fc-fold" :open="isOpen" @toggle="isOpen = ($event.target as HTMLDetailsElement).open">
    <summary>
      <span class="sq" aria-hidden="true"></span>
      <span class="t">{{ title }}</span>
      <span v-if="count" class="c">{{ count }}</span>
    </summary>
    <div class="body">
      <slot v-if="!lazy || isOpen" />
    </div>
  </details>
</template>
