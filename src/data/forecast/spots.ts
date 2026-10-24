import raw from './spots.json'
import type { ProvKey, Spot } from '@/lib/forecast/types'

/* ============================================================
   机位库（唯一事实来源）
   ------------------------------------------------------------
   数据写在 spots.json 里，因为 tools/build-cache.mjs 也直接读这份 JSON。

   字段：
     n    机位名（也用作分享链接里的 s 参数）
     lat  纬度      lon 经度（近似到公里级即可，气象格点本身 6–28 km）
     face 主要朝向   area 城市/分区    prov 省份 key
   ============================================================ */

export const SPOTS: Spot[] = raw as Spot[]

export interface Province {
  key: ProvKey
  name: string
  /** 英文名：页头小标题用（Sunset Forecast · Guangdong） */
  en: string
  /** 大区，用于下拉分组 */
  region: string
  /** 数据文件（相对站点根） */
  data: string
}

function p(key: string, name: string, en: string, region: string): Province {
  return { key, name, en, region, data: 'data/forecast/' + key + '.json' }
}

/** 省份列表：加省份时这里加一项，同时补 spots.json 与 build-cache.mjs */
export const PROVINCES: readonly Province[] = [
  /* 华南 */
  p('hn', '海南', 'Hainan', '华南'),
  p('gd', '广东', 'Guangdong', '华南'),
  p('gx', '广西', 'Guangxi', '华南'),
  /* 华东 */
  p('sh', '上海', 'Shanghai', '华东'),
  p('js', '江苏', 'Jiangsu', '华东'),
  p('zj', '浙江', 'Zhejiang', '华东'),
  p('ah', '安徽', 'Anhui', '华东'),
  p('fj', '福建', 'Fujian', '华东'),
  p('jx', '江西', 'Jiangxi', '华东'),
  p('sd', '山东', 'Shandong', '华东'),
  /* 华北 */
  p('bj', '北京', 'Beijing', '华北'),
  p('tj', '天津', 'Tianjin', '华北'),
  p('he', '河北', 'Hebei', '华北'),
  p('sx', '山西', 'Shanxi', '华北'),
  p('nm', '内蒙古', 'Inner Mongolia', '华北'),
  /* 华中 */
  p('ha', '河南', 'Henan', '华中'),
  p('hb', '湖北', 'Hubei', '华中'),
  p('hu', '湖南', 'Hunan', '华中'),
  /* 西南 */
  p('cq', '重庆', 'Chongqing', '西南'),
  p('sc', '四川', 'Sichuan', '西南'),
  p('gz', '贵州', 'Guizhou', '西南'),
  p('yn', '云南', 'Yunnan', '西南'),
  p('xz', '西藏', 'Tibet', '西南'),
  /* 西北 */
  p('sn', '陕西', 'Shaanxi', '西北'),
  p('gs', '甘肃', 'Gansu', '西北'),
  p('qh', '青海', 'Qinghai', '西北'),
  p('nx', '宁夏', 'Ningxia', '西北'),
  p('xj', '新疆', 'Xinjiang', '西北'),
  /* 东北 */
  p('ln', '辽宁', 'Liaoning', '东北'),
  p('jl', '吉林', 'Jilin', '东北'),
  p('hl', '黑龙江', 'Heilongjiang', '东北'),
  /* 港澳台 */
  p('hk', '香港', 'Hong Kong', '港澳台'),
  p('mo', '澳门', 'Macau', '港澳台'),
  p('tw', '台湾', 'Taiwan', '港澳台')
]

/** 只保留真的有数据的省份（按 spots.json 自动过滤，避免下拉里出现空省份） */
export const ACTIVE_PROVINCES: readonly Province[] = PROVINCES.filter((p) =>
  SPOTS.some((s) => s.prov === p.key)
)

/** 大区顺序（下拉里的分组） */
export const REGIONS: readonly string[] = ['华南', '华东', '华北', '华中', '西南', '西北', '东北', '港澳台']

export function provincesOfRegion(region: string): Province[] {
  return ACTIVE_PROVINCES.filter((p) => p.region === region)
}

/** 某省的分区（城市）：从机位表里自动去重，顺序按出现先后 */
export function areasFor(prov: ProvKey | string): readonly string[] {
  const list: string[] = []
  for (const s of SPOTS) {
    if (s.prov !== prov) continue
    if (!list.includes(s.area)) list.push(s.area)
  }
  return ['全部', ...list]
}

/** 兼容旧导入：海南的分区 */
export const AREAS = areasFor('hn')

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
