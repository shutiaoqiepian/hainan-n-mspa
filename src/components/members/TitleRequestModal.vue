<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Member } from '@/data/members'
import { copyTextSilent } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'

/**
 * 申请头衔弹窗（旧版 openTitle + #title-modal）：
 * 输入框按 / , ， 、 空格 切成最多 4 个头衔，生成一行可粘贴的数据。
 */

const props = defineProps<{ member: Member | null }>()
const emit = defineEmits<{ close: [] }>()

const raw = ref('')

/** 副标题：名字 + 现在已有的头衔 */
const sub = computed(() => {
  const m = props.member
  if (!m) return ''
  return m.name + ' · 现在的头衔：' + (m.titles.length ? m.titles.join(' / ') : '还没有')
})

watch(
  () => props.member,
  (m) => {
    if (!m) return
    raw.value = ''
  }
)

function onSubmit(): void {
  const m = props.member
  if (!m) return
  const text = raw.value.trim()
  if (!text) {
    toast('先写一个头衔')
    return
  }
  const list = text.split(/[/,，、\s]+/).filter(Boolean).slice(0, 4)
  const line =
    '{ id: "' +
    m.id +
    '", name: "' +
    m.name +
    '", group: "' +
    m.group +
    '", titles: ["' +
    list.join('", "') +
    '"] },'
  copyTextSilent(line)
  toast('已复制，发给管理员即可')
  emit('close')
}
</script>

<template>
  <div
    id="title-modal"
    class="card-modal"
    :class="{ 'is-open': !!member }"
    role="dialog"
    aria-modal="true"
    aria-label="申请头衔"
    @click.self="emit('close')"
  >
    <div class="fb-panel glass" style="max-width:440px">
      <button id="title-close" class="fb-close" aria-label="关闭" @click="emit('close')">✕</button>
      <p class="eyebrow">Title Request</p>
      <h3 class="fb-title">申请头衔</h3>
      <p id="title-sub" class="fb-sub">{{ sub }}</p>
      <input
        id="title-input"
        v-model="raw"
        class="fb-input"
        maxlength="40"
        placeholder="比如：风光 / 星野 / 航拍 / 人文"
      />
      <button id="title-copy" class="btn btn-primary fb-submit" type="button" @click="onSubmit">
        生成并复制申请
      </button>
      <p class="fb-tip">头衔需要管理员审核。复制后发给管理员，通过后会加到你的卡片上。</p>
    </div>
  </div>
</template>
