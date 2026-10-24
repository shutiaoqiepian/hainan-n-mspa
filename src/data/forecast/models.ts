import type { ModelInfo } from '@/lib/forecast/types'

/* ---------- 模式表 ---------- */
export const MODELS: ModelInfo[] = [
  { id: 'ecmwf_ifs025', name: 'ECMWF', tag: '欧洲中心' },
  { id: 'icon_seamless', name: 'ICON', tag: '德国气象局' },
  { id: 'gfs_seamless', name: 'GFS', tag: '美国 NOAA' },
  { id: 'cma_grapes_global', name: 'CMA', tag: '中国气象局' },
  { id: 'jma_seamless', name: 'JMA', tag: '日本气象厅' },
  { id: 'gem_seamless', name: 'GEM', tag: '加拿大' },
  { id: 'metno_seamless', name: 'METNO', tag: '挪威' },
  { id: 'bom_access_global', name: 'ACCESS', tag: '澳大利亚' }
]

/* 多模式默认用这三家：分辨率与更新频率比较均衡，再多就会拖慢手机 */
export const MULTI_MODELS = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless']

/* 参考模式：不参与计分（它们的云量精确度不如上面三家），
   但性能允许时一起请求，用来看「各家怎么看」——分歧大就说明这次不能当真。 */
export const REF_MODELS = [
  'cma_grapes_global', 'jma_seamless', 'gem_seamless', 'metno_seamless', 'bom_access_global'
]

/** 一次取数要请求的模式：默认 3 主 + 5 参考 */
export const ALL_MODELS = MULTI_MODELS.concat(REF_MODELS)
