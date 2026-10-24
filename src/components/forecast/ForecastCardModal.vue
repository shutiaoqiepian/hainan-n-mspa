<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { KINDS } from '@/data/forecast/levels'
import { MODELS } from '@/data/forecast/models'
import { copyText } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'
import type { ForecastCardInput } from '@/lib/card/forecast-card'

/* 名片绘制 + 二维码库一共约 74 KB 源码，只有真正点「名片」时才用得到。
   改成动态 import：首屏不再下载它们，点开名片时再取（通常已经缓存）。 */
type CardModule = typeof import('@/lib/card/forecast-card')
let cardModule: Promise<CardModule> | null = null
function loadCardModule(): Promise<CardModule> {
  if (!cardModule) cardModule = import('@/lib/card/forecast-card')
  return cardModule
}
import { closeCard, cardUi } from '@/lib/forecast/card-ui'
import { dayWord, state } from '@/lib/forecast/state'
import { provEn, provName } from '@/data/forecast/spots'
import { dateText, clockText } from '@/lib/forecast/time'
import { currentTheme } from '@/lib/theme'
import {
  detectUA, downloadLikelyBlocked, openLongPressViewer, saveCardImage
} from '@/lib/card/save-image'
import type { Row } from '@/lib/forecast/types'

/**
 * 预报名片弹窗：Canvas 1080×1350，微信里长按可保存。
 * 两种版式：单个机位（每行的「名片」）与今日前 5（页面顶部按钮）。
 */

const canvas = ref<HTMLCanvasElement | null>(null)
/** 画完之后转成 <img> 显示：微信里 canvas 不能长按保存，img 可以 */
const preview = ref('')

const kindWord = computed(() => KINDS[state.kind].word)
const dayText = computed(() => dayWord(state.day))

function firstRow(): Row | null {
  return cardUi.mode === 'spot' ? cardUi.row : (cardUi.top[0] ?? null)
}

const spotUrl = computed(() => {
  /* 刻意用短域名 + 少参数：二维码越小越容易扫；a 参数可省（不传就是全部区域） */
  const base = 'https://hainan-n-mspa.pages.dev/forecast'
  const r = firstRow()
  const q = new URLSearchParams({ p: state.prov, d: String(state.day), k: state.kind })
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
    provName: provName(state.prov),
    provEn: provEn(state.prov),
    spot: cardUi.mode === 'spot' ? (cardUi.row ?? undefined) : undefined,
    top: cardUi.mode === 'list' ? cardUi.top : undefined
  }
})

function render(): void {
  if (!canvas.value || !input.value) return
  const cv = canvas.value
  const inp = input.value
  loadCardModule().then(({ drawForecastCard }) => {
    drawForecastCard(cv, inp)
    try {
      preview.value = cv.toDataURL('image/png')
    } catch {
      preview.value = ''
    }
  })
}

/** 当前环境能不能直接下载？不能就在界面上说清楚该怎么存 */
const env = detectUA()
const blocked = downloadLikelyBlocked()

watch(
  () => [cardUi.open, cardUi.row, cardUi.top, state.kind, state.day, state.model],
  () => {
    if (!cardUi.open) return
    void loadCardModule().then((m) => m.loadForecastCardImages(render))
  },
  { flush: 'post' }
)

function fileName(): string {
  const r = firstRow()
  const base = cardUi.mode === 'spot' && r ? r.spot.n : provName(state.prov) + dayText.value + kindWord.value
  return base + '-霞光预报名片.png'
}

/** 保存图片：桌面直接下载；微信 / iOS 走系统分享或长按，见 lib/card/save-image.ts */
async function onDownload(): Promise<void> {
  const cv = canvas.value
  if (!cv) return

  const out = await saveCardImage(cv, fileName(), preview.value || undefined)

  if (out.kind === 'downloaded') {
    toast('已保存到下载文件夹', { variant: 'forecast' })
    return
  }
  if (out.kind === 'shared') {
    toast('已打开分享面板，选「存储图像」即可', { variant: 'forecast' })
    return
  }
  if (out.kind === 'long-press') {
    /* 把图铺满屏幕，提示长按；微信里这是唯一能存进相册的路 */
    openLongPressViewer(preview.value)
    toast(out.reason, { variant: 'forecast' })
    return
  }
  toast(out.reason, { variant: 'forecast' })
}

function onCopyText(): void {
  const r = firstRow()
  if (!r) return
  const d = r.detail
  const lines =
    cardUi.mode === 'spot'
      ? [
          '【霞光预报】' + dateText(d.date, d.weekday) + ' ' + dayText.value + kindWord.value + ' ' + d.time,
          r.spot.n + '：' + r.score + ' 分（' + r.level.name + '）· 朝' + r.spot.face,
          '高云 ' + Math.round(r.m.high ?? 0) + '% · 中云 ' + Math.round(r.m.mid ?? 0) + '% · 低云 ' +
            Math.round(r.m.low ?? 0) + '% · AOD ' + r.m.aod.toFixed(2) + ' · 降雨 ' + Math.round(r.m.pop ?? 0) + '%',
          '最佳时刻 ' + r.peakTime + '（' + r.peakScore + ' 分）· 鲜艳度峰值 ' + r.vividPeakTime +
            '（' + r.vividPeakLabel + ' ' + r.vividPeak + '）',
          '通透 ' + r.clarity + ' · 云隙光 ' + r.rays + ' · 光柱 ' + r.pillar + ' · 彩虹 ' + r.rainbowScore,
          d.interpret.headline,
          d.tips.length ? '可能拍到：' + d.tips.slice(0, 3).map((t) => t.name).join(' / ') : '',
          '完整预报 → ' + spotUrl.value
        ].filter(Boolean)
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
      <canvas ref="canvas" width="1080" height="1350" class="card-canvas-hidden"></canvas>
      <img v-if="preview" :src="preview" class="card-preview" alt="预报名片" />
      <div class="card-modal-actions">
        <button class="btn btn-primary" type="button" @click="onDownload">
          {{ blocked ? '存到相册' : '保存图片' }}
        </button>
        <button class="btn btn-ghost" type="button" @click="onCopyText">复制文案</button>
        <button class="btn btn-ghost" type="button" @click="onCopyUrl">复制链接</button>
      </div>
      <p class="card-modal-tip">
        <template v-if="env.wechat">
          微信里点「<b>存到相册</b>」会打开大图，<b>长按图片 → 保存图片</b>即可；文字用「复制文案」
        </template>
        <template v-else-if="env.ios">
          点「<b>存到相册</b>」后在系统面板里选「存储图像」；也可以直接长按上面的图片
        </template>
        <template v-else-if="env.android">
          点「保存图片」直接存进相册 / 下载文件夹；发群里建议再点一次「复制文案」
        </template>
        <template v-else>
          点「保存图片」下载到电脑；手机上长按图片也能保存。发群里建议配「复制文案」的文字
        </template>
      </p>
    </div>
  </div>
</template>
