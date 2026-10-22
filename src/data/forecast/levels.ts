import type { AodBand, Kind, KindKey, Level } from '@/lib/forecast/types'

export const KINDS: Record<KindKey, Kind> = {
  sunrise: { key: 'sunrise', word: '日出', name: '朝霞' },
  sunset: { key: 'sunset', word: '日落', name: '晚霞' }
}

export const LEVELS: Level[] = [
  { min: 92, name: '火烧云', color: '#ff6a3d' },
  { min: 82, name: '大烧', color: '#ff9640' },
  { min: 66, name: '中烧', color: '#ffd166' },
  { min: 48, name: '小烧', color: '#9ad9b8' },
  { min: 30, name: '微烧', color: '#8f979f' },
  { min: 0, name: '不烧', color: '#5b636a' }
]

export function levelOf(score: number): Level {
  for (let i = 0; i < LEVELS.length; i++) {
    if (score >= LEVELS[i].min) return LEVELS[i]
  }
  return LEVELS[LEVELS.length - 1]
}

/* AOD 通透度分级
   参照 SunsetBot 团队公开发布的对照表（550nm）：
     0~0.1 水晶天 / 0.1~0.2 湛蓝 / 0.2~0.3 较蓝
     0.3~0.5 普通 / 0.5~0.8 有霾 / >0.8 污烧 */
export const AOD_BANDS: AodBand[] = [
  { max: 0.1, name: '水晶天', v: 1.0 },
  { max: 0.2, name: '湛蓝', v: 0.97 },
  { max: 0.3, name: '较蓝', v: 0.92 },
  { max: 0.5, name: '普通', v: 0.8 },
  { max: 0.8, name: '有霾', v: 0.55 },
  { max: Infinity, name: '污烧', v: 0.3 }
]

export function aodBand(a: number): AodBand {
  for (let i = 0; i < AOD_BANDS.length; i++) {
    if (a <= AOD_BANDS[i].max) return AOD_BANDS[i]
  }
  return AOD_BANDS[AOD_BANDS.length - 1]
}
