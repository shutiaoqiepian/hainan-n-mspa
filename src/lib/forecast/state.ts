import { reactive } from 'vue'
import { copyText } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'
import { KINDS } from '@/data/forecast/levels'
import { AREAS } from '@/data/forecast/spots'
import type { ForecastState, KindKey, Row } from './types'

/* 整个页面共用一份状态：旧版也是模块级的 state 对象 */
export const state = reactive<ForecastState>({
  day: 0,          /* 0=今天 1=明天 */
  kind: 'sunset',  /* sunrise / sunset */
  model: 'multi',  /* multi 或单个模式 id */
  area: '全部',
  rows: [],
  detail: null,
  shareSpot: '',
  error: null,
  loading: false,
  updatedAt: 0,
  fromStatic: false
})

export function dayWord(d: number): string {
  return d === 1 ? '明天' : '今天'
}

/* 距离这个时刻还有多久 / 过去多久 */
export function leadText(ms: number): string {
  const h = (ms - Date.now()) / 3600000
  const wd = dayWord(state.day) + KINDS[state.kind].word
  if (h < -0.5) return wd + ' · 已过去 ' + Math.round(-h) + ' 小时 · 仅作回顾'
  if (h < 1) return wd + ' · 就在 ' + Math.round(h * 60) + ' 分钟内'
  if (h <= 24) return wd + ' · 约 ' + Math.round(h) + ' 小时 · 可信度较高'
  return wd + ' · 约 ' + Math.round(h) + ' 小时 · 时效参考'
}

export function nextUpcoming(): { day: number; kind: KindKey } {
  /* 没得选的时候，默认给“最近的一个还没到的时刻”：
     Hainan 日出大约 6:20–7:10，日落大约 18:00–19:20 */
  const now = new Date()
  const h = now.getHours() + now.getMinutes() / 60
  if (h < 7.2) return { day: 0, kind: 'sunrise' }
  if (h < 18.2) return { day: 0, kind: 'sunset' }
  return { day: 1, kind: 'sunrise' }
}

/* 从分享链接还原状态；旧链接的 ?m= 也认 */
export function initStateFromUrl(): void {
  let picked = false

  try {
    const q = new URLSearchParams(location.search)
    const k = q.get('k') || q.get('m')
    if (k === 'sunset' || k === 'sunrise') { state.kind = k; picked = true }
    const d = q.get('d')
    if (d === '0' || d === '1') { state.day = Number(d); picked = true }
    const a = q.get('a')
    if (a && AREAS.indexOf(a) >= 0) state.area = a
    const s = q.get('s')
    if (s) state.shareSpot = s
  } catch {
    /* 忽略 */
  }

  if (!picked) {
    const up = nextUpcoming()
    state.day = up.day
    state.kind = up.kind
  }
}

/* ---------- 分享 ---------- */
export function shareSpot(name: string): void {
  const row = state.rows.find((r) => r.spot.n === name)
  if (row) shareRow(row)
}

export function shareRow(r: Row): void {
  const base = location.href.split('?')[0].split('#')[0]
  const url = base + '?d=' + state.day + '&k=' + state.kind +
              '&a=' + encodeURIComponent(r.spot.area) +
              '&s=' + encodeURIComponent(r.spot.n)
  const word = dayWord(state.day) + KINDS[state.kind].word
  const text = '【' + word + '】' + r.spot.n +
               ' 霞光指数 ' + r.score + '（' + r.level.name + '）' +
               ' · ' + r.m.time + ' ' + KINDS[state.kind].word +
               '\n' + url
  copyText(text).then(
    () => toast('已复制，去群里发吧', { variant: 'forecast' }),
    () => toast('复制失败，请手动选中链接', { variant: 'forecast' })
  )
}
