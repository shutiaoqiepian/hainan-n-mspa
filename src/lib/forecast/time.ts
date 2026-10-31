/* ============================================================
   时间文案：把「预报对象」和「数据更新」讲清楚
   ------------------------------------------------------------
   旧版只写「今天日落 · 约 6 小时 · 数据更新 2026/10/22 21:41」，
   用户根本不知道：
     · 预报的是哪一天、几点几分？
     · 数据是什么时候算的？现在这个时间还新不新？
   统一在这里生成带日期和时刻的中文文案。
   ============================================================ */

import type { KindKey } from './types'

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 北京时间「今天 / 明天」的 YYYY-MM-DD。
 *
 * ⚠ 不要用 `new Date().toISOString().slice(0,10)`：那是 UTC 日期，
 *   北京时间 00:00–08:00 之间会退到昨天，凌晨打开页面就会显示成「昨天」。
 * day：0 = 今天，1 = 明天。
 */
export function localDateStr(day = 0, nowMs = Date.now()): string {
  /* 先把时间平移到 UTC+8，再用 UTC 方法取年月日，避免依赖运行环境的时区设置 */
  const d = new Date(nowMs + 8 * 3600 * 1000)
  d.setUTCDate(d.getUTCDate() + day)
  const m = ('0' + (d.getUTCMonth() + 1)).slice(-2)
  const dt = ('0' + d.getUTCDate()).slice(-2)
  return d.getUTCFullYear() + '-' + m + '-' + dt
}

/** '2026-10-23T18:14' → { date, time, weekday } */
export function parseIso(iso: string): { date: string; time: string; weekday: string } {
  const date = (iso || '').slice(0, 10)
  const time = (iso || '').slice(11, 16)
  const ms = Date.parse(date + 'T00:00:00+08:00')
  const weekday = isNaN(ms) ? '' : WEEKDAYS[new Date(ms).getDay()]
  return { date, time, weekday }
}

/** '2026-10-23' → '2026年10月23日 周五' */
export function dateText(date: string, weekday?: string): string {
  const p = date.split('-')
  if (p.length !== 3) return date
  const wd = weekday ?? WEEKDAYS[new Date(date + 'T00:00:00+08:00').getDay()]
  return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日 ' + wd
}

/** '2026-10-23' + '18:14' → '2026年10月23日 周五 18:14' */
export function pointText(date: string, time: string, weekday?: string): string {
  return dateText(date, weekday) + ' ' + time
}

/** ms → 'HH:MM'（北京时间） */
export function clockText(ms: number): string {
  const d = new Date(ms)
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
}

/** 距离目标时刻还有多久：'还有 1 小时 42 分钟' / '已过去 20 分钟' */
export function distanceText(targetMs: number, now = Date.now()): string {
  const diff = targetMs - now
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600000)
  const m = Math.round((abs % 3600000) / 60000)
  const body = h >= 1 ? h + ' 小时' + (m ? ' ' + m + ' 分钟' : '') : m + ' 分钟'
  return (diff >= 0 ? '还有 ' : '已过去 ') + body
}

/** 相对时效：数据越新越可信 */
export function ageText(fromMs: number, now = Date.now()): string {
  const h = (now - fromMs) / 3600000
  if (h < 0.75) return '刚更新'
  if (h < 4) return (Math.round(h * 10) / 10) + ' 小时前'
  return Math.round(h) + ' 小时前'
}

/** 预生成缓存的更新节奏：每 6 小时一次（01/07/13/19 点 05 分，北京时间 09/15/21/03） */
export const CACHE_HOURS = [1, 7, 13, 19]

/** 下一次缓存更新的时间（ms） */
export function nextUpdateMs(now = Date.now()): number {
  const d = new Date(now)
  for (const h of CACHE_HOURS) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 5, 0, 0)
    if (t.getTime() > now) return t.getTime()
  }
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, CACHE_HOURS[0], 5, 0, 0)
  return t.getTime()
}

/** 目标时刻（按日期的日出/日落）早已过去多久 */
export function isPast(ms: number, now = Date.now()): boolean {
  return ms < now - 10 * 60 * 1000
}

export function kindWord(kind: KindKey): string {
  return kind === 'sunrise' ? '日出' : '日落'
}
