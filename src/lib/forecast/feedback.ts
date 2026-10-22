import { reactive, ref } from 'vue'
import { copyText } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'
import { KINDS } from '@/data/forecast/levels'
import { dayWord, state } from './state'
import type { Row } from './types'

/* ---------- 实际结果反馈 ---------- */

export const FB_KEY = 'mspa_fb_v1'

/** 弹窗里那 7 个按钮（顺序即旧版 DOM 顺序）。
   注意最后一个：提交值是「没去」，按钮文案是「我没去」——旧版就是这样 */
export const FB_VALUES = [
  { v: '火烧云', label: '火烧云' },
  { v: '大烧', label: '大烧' },
  { v: '中烧', label: '中烧' },
  { v: '小烧', label: '小烧' },
  { v: '微烧', label: '微烧' },
  { v: '没烧', label: '没烧' },
  { v: '没去', label: '我没去' }
]

export const fb = reactive({
  open: false,
  row: null as Row | null,
  value: '',
  note: '',
  name: '',
  submitting: false
})

/* localStorage 不是响应式的：记一次反馈就 +1，让「✓」图标跟着变 */
const fbVersion = ref(0)

export function fbStore(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FB_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

export function fbKeyOf(r: Row): string {
  return r.spot.n + '|' + r.date + '|' + state.kind
}

export function isDone(r: Row): boolean {
  void fbVersion.value
  return !!fbStore()[fbKeyOf(r)]
}

function fbRemember(r: Row): void {
  const s = fbStore()
  s[fbKeyOf(r)] = Date.now()
  try {
    localStorage.setItem(FB_KEY, JSON.stringify(s))
  } catch {
    /* 忽略 */
  }
  fbVersion.value++
}

export function openFeedback(r: Row): void {
  fb.row = r
  fb.value = ''
  fb.note = ''
  fb.name = ''
  fb.submitting = false
  fb.open = true
}

export function closeFeedback(): void {
  fb.open = false
}

/** 弹窗副标题：机位 · 日期 · 系统给出的分数 */
export function fbSubText(): string {
  const r = fb.row
  if (!r) return ''
  return r.spot.n + ' · ' + r.date + ' · 系统给出 ' + r.score + ' 分（' + r.level.name + '）'
}

export function selectValue(v: string): void {
  fb.value = v
}

export function submitFeedback(): void {
  if (!fb.row) return
  if (!fb.value) {
    toast('请先选一个实际结果', { variant: 'forecast' })
    return
  }

  const r = fb.row
  const note = (fb.note || '').trim()
  const nick = (fb.name || '').trim()

  const body = new URLSearchParams()
  body.set('form-name', 'sunset-feedback')
  body.set('spot', r.spot.n)
  body.set('score', String(r.score))
  body.set('level', r.level.name)
  body.set('mode', KINDS[state.kind].word)
  body.set('date', r.date || '')
  body.set('actual', fb.value)
  body.set('note', note)
  body.set('nickname', nick)

  fb.submitting = true

  const oneLine = '霞光反馈｜' + dayWord(state.day) + KINDS[state.kind].word +
                  '｜' + r.spot.n + '｜' + (r.date || '') +
                  '｜系统 ' + r.score + ' 分（' + r.level.name + '）' +
                  '｜实际：' + fb.value +
                  (note ? '｜备注：' + note : '') +
                  (nick ? '｜来自：' + nick : '')

  fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status)
    fbRemember(r)
    closeFeedback()
    toast('已提交，谢谢反馈 🙏', { variant: 'forecast' })
  }).catch(() => {
    /* 表单服务没开通时也别让人白填：存在本机 + 复制一段可直接发的文本 */
    fbRemember(r)
    closeFeedback()
    /* 静默复制：失败也不打扰用户（旧版 copySilent 同样吞掉错误） */
    void copyText(oneLine).catch(() => {})
    toast('线上表单未开通：内容已复制，粘贴给管理员即可', { variant: 'forecast' })
  }).then(() => {
    fb.submitting = false
  })
}
