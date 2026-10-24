<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Member } from '@/data/members'
import { drawCard, loadCardImages, siteBase } from '@/lib/card/canvas'
import { copyTextSilent } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'

/**
 * 名片预览弹窗（旧版 openCard + #card-modal）：
 * 打开后等图片就绪再绘制 canvas，然后才能保存 / 复制主页链接。
 */

const props = defineProps<{ member: Member | null }>()
const emit = defineEmits<{ close: [] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
/** 画完转成 <img>：微信里 canvas 不能长按保存，img 可以 */
const preview = ref('')
const inWeChat = /MicroMessenger/i.test(navigator.userAgent)
/** 旧版存在 modal.dataset.url 里，复制按钮读它 */
const shareUrl = ref('')

watch(
  () => props.member,
  (m) => {
    if (!m) return
    shareUrl.value = siteBase() + 'members.html#m-' + m.id
    loadCardImages(m, (shots) => {
      if (!canvas.value) return
      drawCard(canvas.value, m, shots)
      try {
        preview.value = canvas.value.toDataURL('image/png')
      } catch {
        preview.value = ''
      }
    })
  }
)

function onDownload(): void {
  const cv = canvas.value
  const m = props.member
  if (!cv || !m) return
  cv.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = m.name + '-18N-MSPA名片.png'
    document.body.appendChild(a)
    a.click()
    window.setTimeout(() => {
      URL.revokeObjectURL(a.href)
      a.remove()
    }, 1500)
  }, 'image/png')
}

function onShare(): void {
  copyTextSilent(shareUrl.value)
  toast('主页链接已复制')
}
</script>

<template>
  <div
    id="card-modal"
    class="card-modal"
    :class="{ 'is-open': !!member }"
    role="dialog"
    aria-modal="true"
    aria-label="成员名片"
    @click.self="emit('close')"
  >
    <div class="card-modal-inner">
      <button id="card-close" class="card-modal-close" aria-label="关闭" @click="emit('close')">
        ✕
      </button>
      <canvas id="card-canvas" ref="canvas" width="1080" height="1350" class="card-canvas-hidden"></canvas>
      <img v-if="preview" :src="preview" class="card-preview" alt="成员名片" />
      <div class="card-modal-actions">
        <button id="card-download" class="btn btn-primary" type="button" @click="onDownload">
          保存图片
        </button>
        <button id="card-share" class="btn btn-ghost" type="button" @click="onShare">
          复制主页链接
        </button>
      </div>
      <p class="card-modal-tip">
        <template v-if="inWeChat">微信里请<b>长按图片 → 保存图片</b></template>
        <template v-else>手机上长按图片也能保存</template>
      </p>
    </div>
  </div>
</template>
