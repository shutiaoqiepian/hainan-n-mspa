import { reactive } from 'vue'
import { copyText } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'
import { KINDS } from '@/data/forecast/levels'
import { ACTIVE_PROVINCES, areasFor } from '@/data/forecast/spots'
import { dateText, distanceText } from './time'
import type { ForecastState, KindKey, Row } from './types'

/* 整个页面共用一份状态：旧版也是模块级的 state 对象 */
export const state = reactive<ForecastState>({
  prov: 'hn',
  day: 0,          /* 0=今天 1=明天 */
  kind: 'sunset',  /* sunrise / sunset */
  model: 'multi',  /* multi 或单个模式 id */
  area: '全部',
  rows: [],
  detail: null,
  shareSpot: '',
  openSpot: '',
  error: null,
  loading: false,
  updatedAt: 0,
  fromStatic: false,
  targetDate: '',
  targetTime: '',
  nextUpdateAt: 0,
  gridNote: '',
  obsMode: false
})

export function dayWord(d: number): string {
  return d === 1 ? '明天' : '今天'
}

/* 预报对象：'2026年10月23日 周五 · 今天日落 18:14' */
export function targetText(): string {
  if (!state.targetDate || !state.targetTime) return dayWord(state.day) + KINDS[state.kind].word
  return dateText(state.targetDate) + ' · ' + dayWord(state.day) + KINDS[state.kind].word + ' ' + state.targetTime
}

/* 距离目标时刻还有多久：'还有 1 小时 42 分钟' */
export function leadText(ms?: number): string {
  const t = ms ?? (state.targetDate && state.targetTime
    ? Date.parse(state.targetDate + 'T' + state.targetTime + ':00+08:00')
    : NaN)
  if (isNaN(t)) return ''
  return distanceText(t)
}

/* 展开 / 收起某个机位的详情 */
export function toggleSpot(name: string): void {
  state.openSpot = state.openSpot === name ? '' : name
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
    const known = ACTIVE_PROVINCES.map((p) => p.key)
    const p = q.get('p')
    if (p && known.indexOf(p) >= 0) state.prov = p
    else {
      /* 没带参数就沿用上次看的省份（默认海南） */
      try {
        const saved = localStorage.getItem('mspa:forecast:prov')
        if (saved && known.indexOf(saved) >= 0) state.prov = saved
      } catch { /* 隐私模式忽略 */ }
    }
    const d = q.get('d')
    if (d === '0' || d === '1') { state.day = Number(d); picked = true }
    const a = q.get('a')
    if (a && areasFor(state.prov).indexOf(a) >= 0) state.area = a
    /* 观测点模式：只给自己人看，用来核对机场预报分与 METAR 实况 */
    if (q.get('obs') === '1') state.obsMode = true
    /* 分享链接直接展开那个机位的详情 */
    const s = q.get('s')
    if (s) { state.shareSpot = s; state.openSpot = s }
  } catch {
    /* 忽略 */
  }

  try {
    localStorage.setItem('mspa:forecast:prov', state.prov)
  } catch { /* 忽略 */ }

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
  const url = base + '?p=' + state.prov + '&d=' + state.day + '&k=' + state.kind +
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
