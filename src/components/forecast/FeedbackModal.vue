<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import {
  FB_VALUES, closeFeedback, fb, fbSubText, selectValue, submitFeedback
} from '@/lib/forecast/feedback'

/** 反馈弹窗（旧版 #fb-modal）：旧站里它在页脚、静态表单之后，所以 Teleport 到 body 末尾 */
const sub = computed(() => fbSubText())

/* 弹窗打开时锁滚动 */
watch(
  () => fb.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  }
)

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeFeedback()
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="fb-modal" id="fb-modal" :class="{ 'is-open': fb.open }" @click.self="closeFeedback">
      <div class="fb-panel glass" role="dialog" aria-modal="true">
        <button class="fb-close" id="fb-close" aria-label="关闭" @click="closeFeedback">✕</button>

        <p class="eyebrow">Feedback</p>
        <h3 class="fb-title" id="fb-title">实际烧到什么程度？</h3>
        <p class="fb-sub" id="fb-sub">{{ sub }}</p>

        <div class="fb-options" id="fb-options">
          <button v-for="o in FB_VALUES" :key="o.v" type="button" :data-v="o.v" :class="{ 'is-on': fb.value === o.v }" @click="selectValue(o.v)">{{ o.label }}</button>
        </div>

        <input class="fb-input" id="fb-note" maxlength="140" placeholder="补充说明（可选）：几点最红？哪个方向？翻车原因？" v-model="fb.note" />
        <input class="fb-input" id="fb-name" maxlength="24" placeholder="你的称呼（可选）" v-model="fb.name" />

        <button class="btn btn-primary fb-submit" id="fb-submit" type="button" :disabled="fb.submitting" @click="submitFeedback">{{ fb.submitting ? '提交中…' : '提交反馈' }}</button>
        <p class="fb-tip">反馈会连同当前分数一起记录，用来校准算法。</p>
      </div>
    </div>
  </Teleport>
</template>
