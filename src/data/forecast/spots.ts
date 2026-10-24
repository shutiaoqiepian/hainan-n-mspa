import raw from './spots.json'
import type { ProvKey, Spot } from '@/lib/forecast/types'

/* ============================================================
   机位库（唯一事实来源）
   ------------------------------------------------------------
   数据写在 spots.json 里，因为 tools/build-cache.mjs 也直接读这份 JSON
   —— 原来是 TS 和脚本各存一份，靠「名字对得上」互相校验，加省份后
   两份必然漂移，所以合并成一份。

   字段：
     n    机位名（也用作分享链接里的 s 参数）
     lat  纬度      lon 经度（近似到公里级即可，气象格点本身 6–28 km）
     face 主要朝向   area 省内分区    prov 省份（hn=海南 / gd=广东）
   ============================================================ */

export const SPOTS: Spot[] = raw as Spot[]

export interface Province {
  key: ProvKey
  name: string
  /** 英文名：页头小标题用（Sunset Forecast · Hainan） */
  en: string
  /** 数据文件（相对站点根） */
  data: string
}

/** 省份列表：加省份时这里加一项，同时补 spots.json 与 build-cache.mjs */
export const PROVINCES: readonly Province[] = [
  { key: 'hn', name: '海南', en: 'Hainan', data: 'data/forecast.json' },
  { key: 'gd', name: '广东', en: 'Guangdong', data: 'data/forecast-gd.json' }
]

/** 省内分区（顺序即界面上筛选按钮的顺序） */
export const AREAS_BY_PROV: Record<ProvKey, readonly string[]> = {
  hn: ['全部', '东岸', '西岸', '南部', '中部', '海口'],
  gd: ['全部', '广州', '深圳', '珠海', '惠州', '珠三角', '粤东', '粤西', '粤北']
}

/** 兼容旧导入：海南的分区 */
export const AREAS = AREAS_BY_PROV.hn

export function areasFor(prov: ProvKey | string): readonly string[] {
  return AREAS_BY_PROV[prov as ProvKey] ?? AREAS_BY_PROV.hn
}

export function spotsFor(prov: ProvKey | string): Spot[] {
  return SPOTS.filter((s) => s.prov === prov)
}

export function provName(prov: ProvKey | string): string {
  return PROVINCES.find((p) => p.key === prov)?.name ?? '海南'
}

export function provEn(prov: ProvKey | string): string {
  return PROVINCES.find((p) => p.key === prov)?.en ?? 'Hainan'
}

export function dataFileFor(prov: ProvKey | string): string {
  return PROVINCES.find((p) => p.key === prov)?.data ?? PROVINCES[0].data
}

/** 逐小时详情面板固定展示这个机位（现在详情已按行展开，仅保留兼容） */
export const DETAIL_SPOT = '海口西海岸观海台'
