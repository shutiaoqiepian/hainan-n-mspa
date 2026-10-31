<script setup lang="ts">
import { ref, watch } from 'vue'

/** 可折叠面板：默认展开状态可控、键盘可用（原生 details/summary）、可同时展开多个。
    第四层「专业判定与参考」统一用这个壳。 */

const props = withDefaults(
  defineProps<{ title: string; count?: string; open?: boolean; lazy?: boolean }>(),
  { count: '', open: false, lazy: false }
)

const isOpen = ref(props.open)

/* 父级（预报页）会在窄屏/宽屏切换时改 open 的默认值。
   用户手动点开只改 isOpen、不改 open，所以这个 watch 不会和用户操作打架，
   只在「默认值本身变了」时把面板同步到新的默认状态。 */
watch(() => props.open, (v) => { isOpen.value = v })
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
