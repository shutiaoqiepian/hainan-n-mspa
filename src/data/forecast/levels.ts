import type { AodBand, GradeRange, Kind, KindKey, Level } from '@/lib/forecast/types'

export const KINDS: Record<KindKey, Kind> = {
  sunrise: { key: 'sunrise', word: '日出', name: '朝霞' },
  sunset: { key: 'sunset', word: '日落', name: '晚霞' }
}

/* 分数上限。2026-11-06 从 96 提到 100：
   原来留 4 分余量是怕「满分」太满，但代价是页面写着「/96」，
   用户拿到的分数永远对不上 100 分制。改成 100 后：
     · 96 分以上要求 raw 系数 ≈0.98 以上，仍然极难拿到（实测真实缓存 0 条）
     · 等级阈值一个没动，所以「只改了上限」不会让任何一条预报升档 */
export const SCORE_MAX = 100

/* 六档命名（2026-11-06 改）：
   原来最高档叫「火烧云」—— 那是**现象名**，不是档位名，会和「今天有没有火烧云」
   混在一起说不清。按用户要求改成「世纪大烧」（追霞圈口语里的顶格叫法），
   六档＝不烧 / 微烧 / 小烧 / 中烧 / 大烧 / 世纪大烧。
   ★ 阈值一个没动：这只是把「火烧云 92+」改名叫「世纪大烧 92+」，
     没有移动任何一条分界线。 */
export const LEVELS: Level[] = [
  { min: 92, name: '世纪大烧', color: '#ff6a3d' },
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

/* 六档的「显示区间」（供图例使用）：名字 + 颜色 + 分数段。
   从 LEVELS 派生 —— 等级表本身仍只写 LEVELS 一份，这里只是把「第 i 档上界
   是第 i-1 档下界减 1」这条规则算出来，不抄阈值。 */
export interface LevelBand {
  name: string
  color: string
  range: string
}

export function levelBands(): LevelBand[] {
  return LEVELS.map((l, i) => {
    const hi = i === 0 ? SCORE_MAX : LEVELS[i - 1].min - 1
    return { name: l.name, color: l.color, range: l.min + '–' + hi }
  })
}

/* ---------- 区间形容词 ----------
   问题：分数是 0–100 里的一个确定数，但 66 分和 67 分在等级上分属中烧/小烧两侧。
   只报一个档次，会给人「预报很确定」的错觉；追霞圈的口语本来就是区间
   （「小烧到中烧」），这里用同一套阈值把它算出来。

   ★ 半径为什么取 5：
     六档里最窄的一段是「大烧 82 → 世纪大烧 92」，只隔 10 分。
     半径取它的一半（5），区间两侧各探到分界为止，**不靠兜底也不会碰到两条分界线**；
     取 6 或更大就会在 86–87 分附近一次跨到两档，得靠下面那句兜底截回来。
     半径 5 时实测约 2.7% 的预报会写成区间（tools/grade-dist.mjs）。
   ★ 这个 5 是**约定的**，不是观测标定出来的：它表达的是「分数压在线上的时候
     别把话说死」，不代表「真实结果有百分之多少落在区间内」。 */
export const RANGE_DELTA = 5

export function gradeRangeOf(score: number, delta: number = RANGE_DELTA): GradeRange {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(SCORE_MAX, Math.round(score))) : 0
  const low = levelOf(s - delta)
  let high = levelOf(s + delta)
  /* 兜底：以后要是把半径调大、或把阈值改窄，区间也不许一次跨两档 */
  const li = LEVELS.indexOf(low)
  if (li - LEVELS.indexOf(high) > 1) high = LEVELS[li - 1]
  const isRange = low.name !== high.name
  return {
    low,
    high,
    isRange,
    text: isRange ? low.name + '到' + high.name : low.name,
    boundary: isRange ? high.min : 0,
    why: isRange
      ? '分数 ' + s + ' 分，离「' + low.name + ' / ' + high.name +
        '」的分界（' + high.min + ' 分）只有 ' + Math.abs(s - high.min) +
        ' 分，在 ±' + delta + ' 分之内 —— 所以档位说成区间，不说死一个名字'
      : ''
  }
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
