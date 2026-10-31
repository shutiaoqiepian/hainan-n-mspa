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

/** 预生成缓存的更新节奏：北京时间每天 8 次。
 *
 *  为什么是这几个点：不按整点拍脑袋定，而是**跟着两个气象模式的发布时间走**。
 *    ECMWF（欧洲中心）  北京 04:00 / 10:00 / 16:00 / 22:00
 *    GFS（美国）大更新  北京 07:30–08:30 / 19:30–20:30
 *    GFS 小更新        北京 01:30 / 13:30（仅中东部、东北）
 *  每个点都留 40~70 分钟余量，等模式跑完、Open-Meteo 把数据接上。
 *  最关键的是 20:50 这次：它是「当晚日落」最后一次用上 GFS 19:30 大更新的机会。
 *
 *  ⚠ 改这里必须同步改 .github/workflows/forecast-cache.yml 的两条 cron。
 *    那边是 UTC（北京 = UTC+8），这边是北京时刻 —— 两边对不上，
 *    「下次约几点」就会给出一个错的承诺。
 */
export const CACHE_SLOTS: Array<[number, number]> = [
  [5, 20], [9, 20], [11, 20], [14, 50], [17, 20], [20, 50], [22, 50], [2, 20]
]

/** 下一次缓存更新的时间（ms） */
export function nextUpdateMs(now = Date.now()): number {
  const d = new Date(now)
  const cands: number[] = []
  /* 跨两天找：凌晨 2:20 这种点，今天已经过了就得看明天 */
  for (const dayOff of [0, 1]) {
    for (const [h, min] of CACHE_SLOTS) {
      cands.push(
        new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOff, h, min, 0, 0).getTime()
      )
    }
  }
  const future = cands.filter((t) => t > now).sort((a, b) => a - b)
  return future.length ? future[0] : now + 3 * 3600000
}

/** 目标时刻（按日期的日出/日落）早已过去多久 */
export function isPast(ms: number, now = Date.now()): boolean {
  return ms < now - 10 * 60 * 1000
}

export function kindWord(kind: KindKey): string {
  return kind === 'sunrise' ? '日出' : '日落'
}
