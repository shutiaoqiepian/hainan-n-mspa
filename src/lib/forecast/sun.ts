import type { Spot, SunPos } from '@/lib/forecast/types'

/* 太阳高度角 + 方位角（NOAA 低精度公式） */
export function sunPosition(timeMs: number, latDeg: number, lonDeg: number): SunPos {
  const rad = Math.PI / 180
  const n = timeMs / 86400000 + 2440587.5 - 2451545.0

  const L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360
  const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360
  const lambda = (L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad)) * rad
  const eps = (23.439 - 0.0000004 * n) * rad

  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))

  const gmst = ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360
  const lst = ((gmst + lonDeg) % 360 + 360) * rad
  const ha = lst - ra

  const latR = latDeg * rad
  let sinEl = Math.sin(latR) * Math.sin(dec) +
              Math.cos(latR) * Math.cos(dec) * Math.cos(ha)
  sinEl = Math.max(-1, Math.min(1, sinEl))

  const el = Math.asin(sinEl)
  const cosEl = Math.cos(el) || 1e-6

  const sinA = -Math.cos(dec) * Math.sin(ha) / cosEl
  const cosA = (Math.sin(dec) - sinEl * Math.sin(latR)) / (cosEl * Math.cos(latR))
  let az = Math.atan2(sinA, cosA) / rad
  if (az < 0) az += 360

  return { el: el / rad, az: az }
}

export function sunElevation(timeMs: number, latDeg: number, lonDeg: number): number {
  return sunPosition(timeMs, latDeg, lonDeg).el
}

/* 机位朝向 → 中心方位角（正北 0°，顺时针） */
export const FACE_AZ: Record<string, number | undefined> = {
  西: 270, 西南: 235, 南: 180, 东南: 135,
  东: 90, 西北: 305, 北: 0
}

/* 太阳落在这个方向，这个机位才拍得到。偏太多就明显降分 */
export function faceMatch(spot: Spot, az: number): number {
  /* "—" 是「观测互补点位」（机场）：四周开阔，不存在拍不到的方向。
     这里必须返回 1，否则机场分被平白打折 10%，
     拿它和机场 METAR 实况比对时会带一层系统性偏低。 */
  if (spot.face === '—') return 1
  const center = FACE_AZ[spot.face]
  if (center == null) return 0.9          /* 山顶等不限方向 */

  let d = Math.abs(((az - center) % 360 + 360) % 360)
  if (d > 180) d = 360 - d

  return 0.55 + 0.45 * clamp(1 - d / 110, 0, 1)
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}
