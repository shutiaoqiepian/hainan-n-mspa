<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { KINDS } from '@/data/forecast/levels'
import { MODELS } from '@/data/forecast/models'
import { copyText } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'
import { drawForecastCard, loadForecastCardImages, type ForecastCardInput } from '@/lib/card/forecast-card'
import { closeCard, cardUi } from '@/lib/forecast/card-ui'
import { dayWord, state } from '@/lib/forecast/state'
import { dateText, clockText } from '@/lib/forecast/time'
import { currentTheme } from '@/lib/theme'
import type { Row } from '@/lib/forecast/types'

/**
 * 预报名片弹窗：Canvas 1080×1350，微信里长按可保存。
 * 两种版式：单个机位（每行的「名片」）与今日前 5（页面顶部按钮）。
 */

const canvas = ref<HTMLCanvasElement | null>(null)

const kindWord = computed(() => KINDS[state.kind].word)
const dayText = computed(() => dayWord(state.day))

function firstRow(): Row | null {
  return cardUi.mode === 'spot' ? cardUi.row : (cardUi.top[0] ?? null)
}

const spotUrl = computed(() => {
  /* 刻意用短域名 + 少参数：二维码越小越容易扫；a 参数可省（不传就是全部区域） */
  const base = 'https://hainan-n-mspa.pages.dev/forecast'
  const r = firstRow()
  const q = new URLSearchParams({ d: String(state.day), k: state.kind })
  if (cardUi.mode === 'spot' && r) q.set('s', r.spot.n)
  return base + '?' + q.toString()
})

/* 数据更新时间（不是预报日期）：'10月23日 19:12' */
const updateLine = computed(() => {
  if (!state.updatedAt) return ''
  const dt = new Date(state.updatedAt)
  return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + clockText(state.updatedAt) + ' 更新'
})

const sourceText = computed(() =>
  state.model === 'multi'
    ? 'ECMWF + ICON + GFS 三模式平均'
    : (MODELS.find((m) => m.id === state.model)?.name ?? state.model) + ' 单模式'
)

const input = computed<ForecastCardInput | null>(() => {
  const r = firstRow()
  if (!r) return null
  const d = r.detail
  return {
    mode: cardUi.mode,
    theme: currentTheme(),
    dayWord: dayText.value,
    kindWord: kindWord.value,
    date: d.date,
    weekday: d.weekday,
    time: d.time,
    updatedText: updateLine.value,
    sourceText: sourceText.value,
    url: spotUrl.value,
    spot: cardUi.mode === 'spot' ? (cardUi.row ?? undefined) : undefined,
    top: cardUi.mode === 'list' ? cardUi.top : undefined
  }
})

function render(): void {
  if (!canvas.value || !input.value) return
  drawForecastCard(canvas.value, input.value)
}

watch(
  () => [cardUi.open, cardUi.row, cardUi.top, state.kind, state.day, state.model],
  () => {
    if (!cardUi.open) return
    loadForecastCardImages(render)
  },
  { flush: 'post' }
)

function fileName(): string {
  const r = firstRow()
  const base = cardUi.mode === 'spot' && r ? r.spot.n : '海南' + dayText.value + kindWord.value
  return base + '-霞光预报名片.png'
}

function onDownload(): void {
  const cv = canvas.value
  if (!cv) return
  cv.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName()
    document.body.appendChild(a)
    a.click()
    window.setTimeout(() => {
      URL.revokeObjectURL(a.href)
      a.remove()
    }, 1500)
  }, 'image/png')
}

function onCopyText(): void {
  const r = firstRow()
  if (!r) return
  const d = r.detail
  const lines =
    cardUi.mode === 'spot'
      ? [
          '【霞光预报】' + dateText(d.date, d.weekday) + ' ' + dayText.value + kindWord.value + ' ' + d.time,
          r.spot.n + '：' + r.score + ' 分（' + r.level.name + '）',
          '高云 ' + Math.round(r.m.high ?? 0) + '% · 中云 ' + Math.round(r.m.mid ?? 0) + '% · 低云 ' +
            Math.round(r.m.low ?? 0) + '% · AOD ' + r.m.aod.toFixed(2),
          '云隙光 ' + r.rays + ' · 光柱 ' + r.pillar + ' · 彩虹 ' + r.rainbowScore,
          d.interpret.headline,
          '完整预报 → ' + spotUrl.value
        ]
      : [
          '【霞光预报】' + dateText(d.date, d.weekday) + ' ' + dayText.value + kindWord.value + ' ' + d.time,
          cardUi.top
            .map((x, i) => i + 1 + '. ' + x.spot.n + ' ' + x.score + ' 分（' + x.level.name + '）')
            .join('\n'),
          '完整预报 → ' + spotUrl.value
        ]

  copyText(lines.join('\n')).then(
    () => toast('文案已复制，去群里发吧', { variant: 'forecast' }),
    () => toast('复制失败，请手动选中', { variant: 'forecast' })
  )
}

function onCopyUrl(): void {
  copyText(spotUrl.value).then(
    () => toast('链接已复制', { variant: 'forecast' }),
    () => toast('复制失败，请手动选中', { variant: 'forecast' })
  )
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && cardUi.open) closeCard()
}
if (typeof document !== 'undefined') document.addEventListener('keydown', onKey)
</script>

<template>
  <div
    id="fc-card-modal"
    class="card-modal"
    :class="{ 'is-open': cardUi.open }"
    role="dialog"
    aria-modal="true"
    aria-label="预报名片"
    @click.self="closeCard"
  >
    <div class="card-modal-inner">
      <button class="card-modal-close" aria-label="关闭" @click="closeCard">✕</button>
      <canvas ref="canvas" width="1080" height="1350"></canvas>
      <div class="card-modal-actions">
        <button class="btn btn-primary" type="button" @click="onDownload">保存图片</button>
        <button class="btn btn-ghost" type="button" @click="onCopyText">复制文案</button>
        <button class="btn btn-ghost" type="button" @click="onCopyUrl">复制链接</button>
      </div>
      <p class="card-modal-tip">手机上长按图片也能保存；发群里建议配「复制文案」的文字</p>
    </div>
  </div>
</template>
