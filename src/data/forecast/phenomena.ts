/* ============================================================
   摄影圈天象词库 + 匹配规则
   ------------------------------------------------------------
   追霞圈（小红书 / 抖音 / 微信群）说天气，用的不是气象术语，
   而是「大烧 / 小烧 / 耶稣光 / 鱼鳞云 / 排骨云」这类黑话。
   这一份把两边对上：每个词条都带一个 match()，条件满足时
   就会出现在机位详情里，告诉用户「现在这个天能拍什么」。

   词条来源（均可在 References 里点到）：
     · 追霞者常用的「小烧 / 中烧 / 大烧」分级 —— 荆楚网《小烧？中烧？
       大烧？追霞者网上分享火烧云情报》
     · 云属与云种命名 —— WMO《国际云图》(International Cloud Atlas)
     · 晕、幻日、环天顶弧等冰晶光学现象 —— 维基百科「晕」条目
     · 火烧云/AOD 判据 —— SunsetBot 教程
     · 平台口语（天空调色盘、云被烧穿等）来自小红书/抖音追霞话题
   注意：词条里的「条件」是按我们的数据能判断的近似，不是严格气象判据。
   ============================================================ */

import type { CloudLayer, KindKey, Phototip } from '@/lib/forecast/types'

export type PhenoGroup = '霞' | '光束' | '冰晶光学' | '云' | '大气' | '平台口语'

export interface PhenoContext {
  kind: KindKey
  score: number
  high: number
  mid: number
  low: number
  aod: number
  pop: number
  rh: number | null
  vis: number | null
  cape: number | null
  sunEl: number | null
  crep: number
  pillar: number
  clarity: number
  rainbow: number
  cloudBaseLow: number | null
  spread: number
  faceOff: boolean
  layers: CloudLayer[]
  t2m: number | null
}

export interface Phenomenon {
  key: string
  name: string
  /** 别名 / 黑话 */
  alias: string
  group: PhenoGroup
  /** 出现的条件，人话（词典里展示） */
  when: string
  /** 怎么拍 */
  shoot: string
  /** 主要流传平台 */
  platform: string
  /** 本地（海南）出现概率 */
  local?: '每天' | '常见' | '少见' | '罕见' | '几乎不可能'
  /** 0 = 不匹配，1 = 有机会，2 = 很有戏 */
  match: (c: PhenoContext) => number
}

function has(layers: CloudLayer[], code: string, minCover = 25): boolean {
  return layers.some((l) => l.code === code && l.cover >= minCover)
}
function highGenus(c: PhenoContext): string {
  const hi = c.layers.filter((l) => l.height >= 6000 && l.code !== '--')
  return hi.length ? hi[hi.length - 1].genus : ''
}

export const PHENOMENA: Phenomenon[] = [
  /* ---------------- 霞 ---------------- */
  {
    key: 'burn',
    name: '火烧云（大烧）',
    alias: '天空着火 / 火烧天 / 世纪大烧',
    group: '霞',
    when: '高云 40–80%、低云很少、AOD 低于 0.3，太阳能从云底下方照上来',
    shoot: '提前 40 分钟到场，广角收全景；火烧最艳的窗口通常只有 5–8 分钟，别等太阳完全落下去才按快门',
    platform: '小红书 / 抖音 / 微信群',
    local: '常见',
    match: (c) => (c.score >= 88 ? 2 : c.score >= 78 ? 1 : 0)
  },
  {
    key: 'smallburn',
    name: '小烧 / 中烧',
    alias: '微烧 / 有霞 / 一点红',
    group: '霞',
    when: '高云量中等或低云略多，分数 48–82，颜色只在一角',
    shoot: '别开大广角硬凑，用中长焦切局部，颜色反而更浓',
    platform: '小红书',
    local: '常见',
    match: (c) => (c.score >= 48 && c.score < 78 ? 1 : 0)
  },
  {
    key: 'burnthrough',
    name: '云被烧穿',
    alias: '天空烧开一个洞 / 火烧穿',
    group: '霞',
    when: '高云 20–70% 但不算满，太阳落到云缝里，只有局部被点亮',
    shoot: '对准最亮的缝，点测光压暗 1/3 档，让边缘的橙红跳出来',
    platform: '抖音 / 小红书',
    local: '常见',
    match: (c) =>
      c.high >= 20 && c.high <= 70 && c.low <= 30 && c.score >= 60 && (c.sunEl ?? -9) >= -6 ? 2 : 0
  },
  {
    key: 'goldedge',
    name: '金边云',
    alias: '银边 / 勾边云',
    group: '霞',
    when: '有块状积云或高积云，太阳高度 3°–25°，光从云后透出',
    shoot: '对着云缝点测光，宁可保留一点点高光死白，边缘的金线才够亮',
    platform: '小红书',
    local: '常见',
    match: (c) => {
      const el = c.sunEl ?? -9
      const blocky = c.mid >= 25 || has(c.layers, 'Cu', 20) || has(c.layers, 'Sc', 30)
      return blocky && el >= 1 && el <= 25 ? 2 : 0
    }
  },
  {
    key: 'pinkdusk',
    name: '粉紫霞',
    alias: '粉色晚霞 / 紫气东来 / 粉紫渐变',
    group: '霞',
    when: '高空薄卷云被照亮、AOD 低于 0.2，蓝紫波段没被吃掉',
    shoot: '白平衡别设太暖，6500K 左右才留得住粉色；后期别拉饱和过度',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => {
      const thinHigh = c.layers.some((l) => l.height >= 6000 && l.lit && l.cover >= 25 && l.cover <= 80)
      return thinHigh && c.aod < 0.22 && c.score >= 55 ? 2 : 0
    }
  },
  {
    key: 'orange',
    name: '橘子汽水天',
    alias: '橘子海 / 橘子味晚霞 / 奶橙色',
    group: '霞',
    when: 'AOD 0.2–0.4 的中等通透天，颜色偏暖、不发灰',
    shoot: '降低对比、抬一点阴影，保留奶橙的柔和感；人物剪影放画面下三分之一',
    platform: '小红书',
    local: '常见',
    match: (c) => (c.aod >= 0.2 && c.aod <= 0.42 && c.score >= 48 ? 2 : 0)
  },
  {
    key: 'dustburn',
    name: '污烧（灰橙）',
    alias: '脏烧 / 糊烧 / 灰烧 / 末日感',
    group: '霞',
    when: 'AOD 高于 0.4，颜色被霾吃掉一层，饱和度上不去',
    shoot: '反而适合压暗整体走电影感，降低饱和、抬黑位，别指望通透',
    platform: '抖音',
    local: '少见',
    match: (c) => (c.aod > 0.42 && c.score >= 45 ? 1 : 0)
  },
  {
    key: 'afterglow',
    name: '回光返照',
    alias: '日落后二次爆发 / 余晖',
    group: '霞',
    when: '太阳刚落到地平线下 0–8°，高云仍被从下方照亮，颜色会二次变艳',
    shoot: '太阳没入后别急着收机，再等 10–15 分钟，这段时间常是全场最好看的一刻',
    platform: '追霞群 / 小红书',
    local: '常见',
    match: (c) => {
      const el = c.sunEl ?? 9
      return c.kind === 'sunset' && el <= 0 && el >= -8 && c.high >= 30 ? 2 : 0
    }
  },
  {
    key: 'palette',
    name: '天空调色盘',
    alias: '上帝打翻的调色盘 / 天空调色板',
    group: '平台口语',
    when: '冷暖过渡完整：地平线橙、中空粉、头顶蓝，需要高云分层且低云少',
    shoot: '竖构图多留天空，渐变才铺得开；用包围曝光保住高光里的橙',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => (c.score >= 62 && c.low <= 28 && c.clarity >= 60 ? 2 : 0)
  },

  /* ---------------- 光束 ---------------- */
  {
    key: 'crepuscular',
    name: '云隙光 / 丁达尔光',
    alias: '耶稣光 / 曙条 / 曙暮光条 / 天光',
    group: '光束',
    when: '太阳低于 10°、云层有缝（云量 40–60% 最容易）、低云不挡住地平线',
    shoot: '对着太阳方向拍，收小光圈到 f/8–f/11 让光条边缘更利；点测天空高光，地面留剪影',
    platform: '小红书 / B站 / 抖音',
    local: '常见',
    match: (c) => (c.crep >= 70 ? 2 : c.crep >= 45 ? 1 : 0)
  },
  {
    key: 'anticrepuscular',
    name: '反云隙光',
    alias: '对跖光 / 背后的光条',
    group: '光束',
    when: '背对太阳、太阳已很低，光条在反日点附近汇聚',
    shoot: '转身 180° 找背阴面，光条会在地平线附近汇聚成一点，用长焦压缩更明显',
    platform: 'B站 / 气象爱好者',
    local: '少见',
    match: (c) => (c.faceOff && c.crep >= 28 ? 1 : 0)
  },
  {
    key: 'stage',
    name: '舞台光',
    alias: '聚光灯 / 一束光打在海上',
    group: '光束',
    when: '低云有缝、中高云成片，光柱像聚光灯一样落在海面或礁石上',
    shoot: '等光斑落到你想要的地景上再按，光斑移动很快，连拍更保险',
    platform: '抖音 / 小红书',
    local: '少见',
    match: (c) => (c.crep >= 55 && c.low <= 35 ? 2 : 0)
  },
  {
    key: 'pillar',
    name: '太阳光柱（日柱）',
    alias: '光柱 / 日柱 / 光之柱',
    group: '冰晶光学',
    when: '太阳高度 -8°~+5°，高空有薄卷云且 500 hPa 温度低于 -18℃（冰晶云）',
    shoot: '光柱很细，用 70–200mm 中长焦切；曝光按天空测，让柱子不过曝才看得清',
    platform: 'B站 / 气象摄影',
    local: '少见',
    match: (c) => (c.pillar >= 70 ? 2 : c.pillar >= 45 ? 1 : 0)
  },
  {
    key: 'knife',
    name: '刀光',
    alias: '割裂的光 / 神光',
    group: '平台口语',
    when: '强对比的云隙光，光条边缘锐利、像刀切开天空',
    shoot: '压低曝光 1 档，把天空压暗，光条自然就成了“刀”',
    platform: '抖音',
    local: '少见',
    match: (c) => (c.crep >= 68 && c.clarity >= 55 ? 1 : 0)
  },

  /* ---------------- 冰晶光学 ---------------- */
  {
    key: 'halo',
    name: '日晕（22° 晕）',
    alias: '晕 / 太阳套圈',
    group: '冰晶光学',
    when: '高空有薄的卷层云（云量 30–80%、湿度 40–75%），太阳高于 10° 时抬头可见',
    shoot: '22° 晕要 14mm 以下超广角才装得下整圈，记得收小光圈并保护好眼睛',
    platform: '小红书 / 气象爱好者',
    local: '少见',
    match: (c) => {
      const g = highGenus(c)
      return (g === '卷层云' || g === '卷云') && c.high >= 30 && c.high <= 85 ? 1 : 0
    }
  },
  {
    key: 'sundog',
    name: '幻日',
    alias: '两个太阳 / 假太阳',
    group: '冰晶光学',
    when: '卷层云里有片状冰晶、太阳高度 5°–30°，太阳左右各出现一个亮点',
    shoot: '连同真正的太阳一起构图，广角横构图最容易交代全',
    platform: '气象爱好者 / B站',
    local: '罕见',
    match: (c) => {
      const el = c.sunEl ?? 0
      return highGenus(c) === '卷层云' && c.high >= 40 && el >= 5 && el <= 30 ? 1 : 0
    }
  },
  {
    key: 'cirrusblue',
    name: '卷云织天',
    alias: '丝缕云 / 羽毛云 / 扫帚云',
    group: '云',
    when: '高空卷云零散分布，天空干净，云被染成淡粉或淡金',
    shoot: '长焦拍局部纹理，后期轻微去雾，丝缕感更清楚',
    platform: '小红书',
    local: '常见',
    match: (c) => (has(c.layers, 'Ci', 20) && c.clarity >= 65 ? 1 : 0)
  },
  {
    key: 'diamonddust',
    name: '钻石尘',
    alias: '冰晶雾 / 冰雾',
    group: '冰晶光学',
    when: '气温低于 -10℃，近地面出现悬浮冰晶，逆光会闪成一片碎钻',
    shoot: '逆光 + 大光圈，让冰晶在背景光里闪；海南基本看不到',
    platform: 'B站 / 摄影教程',
    local: '几乎不可能',
    match: (c) => (c.t2m != null && c.t2m < -10 ? 1 : 0)
  },

  /* ---------------- 云 ---------------- */
  {
    key: 'fishscale',
    name: '鱼鳞云',
    alias: '鱼鳞片云 / 瓦块云 / 羊群云',
    group: '云',
    when: '透光高积云成行成波排在中空，云块薄、轮廓分明、缝里有蓝天；民谚「天上鱼鳞云，地上雨淋淋」',
    shoot: '对称构图最出效果，用广角顺着云的排列方向拉透视',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => {
      const ac = c.layers.some((l) => (l.code === 'Ac' || l.code === 'Cc') && l.cover >= 40)
      return ac && c.mid >= 40 && c.mid <= 80 ? 2 : 0
    }
  },
  {
    key: 'ribs',
    name: '排骨云',
    alias: '波状层积云 / 排骨天 / 地震云（误称）',
    group: '云',
    when: '低空粗大云条排成波浪状，多在强冷空气过境前出现，预示天气要大变',
    shoot: '广角拍它的层叠，压低曝光让云条的立体感更强',
    platform: '小红书 / 抖音',
    local: '少见',
    match: (c) => (c.layers.some((l) => l.code === 'Sc' && l.cover >= 45) && c.pop >= 40 ? 1 : 0)
  },
  {
    key: 'fluctus',
    name: '迭浪云（KH 波）',
    alias: '开尔文-亥姆霍兹云 / 波浪云 / 碎浪云 / Fluctus',
    group: '云',
    when: '两层不同速度的气流交界处失稳，云顶卷成整齐的碎浪或倒钩；WMO 2017 正式定名 Fluctus',
    shoot: '长焦抓碎浪的细节，出现时间很短，看到就马上拍',
    platform: 'B站 / 气象爱好者',
    local: '罕见',
    match: () => 0
  },
  {
    key: 'cottongloud',
    name: '棉花糖云',
    alias: '棉花云 / 卡通云',
    group: '云',
    when: '白天有淡积云，一朵朵立着、边缘清晰，日落时被描成金边',
    shoot: '低机位仰拍，让云占满画面上半，地面只留一条剪影',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => (has(c.layers, 'Cu', 25) && (c.cape ?? 0) < 1500 ? 1 : 0)
  },
  {
    key: 'lenticular',
    name: '荚状云（UFO 云）',
    alias: '飞碟云 / 豆荚云',
    group: '云',
    when: '稳定气流越过山脉形成，五指山一带偶见；层叠如飞碟',
    shoot: '长焦压缩，和山脊一起构图；这类云移动慢，可以慢慢等光',
    platform: '小红书 / B站',
    local: '少见',
    match: () => 0
  },
  {
    key: 'pileus',
    name: '幞状云',
    alias: '云帽子 / 戴帽云',
    group: '云',
    when: '强对流积云顶部顶起一层薄云，像给云戴了顶帽子',
    shoot: '长焦抓一瞬间，出现时间常常只有几分钟',
    platform: '气象爱好者',
    local: '少见',
    match: (c) => (has(c.layers, 'Cb', 40) && (c.cape ?? 0) >= 1200 ? 1 : 0)
  },
  {
    key: 'mammatus',
    name: '乳状云',
    alias: '乳房云 / 泡泡云',
    group: '云',
    when: '强对流过后，云底出现下垂的袋状结构，通常意味着雷雨刚过',
    shoot: '仰拍大广角，把整片云底纹理收进来；这时光比小，适合手持',
    platform: '抖音 / B站',
    local: '少见',
    match: (c) => ((c.cape ?? 0) >= 1500 && c.mid >= 55 && c.pop >= 50 ? 1 : 0)
  },
  {
    key: 'asperatus',
    name: '糙面云',
    alias: '波浪云 / 海啸云 / 末日云',
    group: '云',
    when: '层积云底面被剪切出波浪状起伏，常伴锋面过境',
    shoot: '广角抬头拍，故意压暗两档，波浪的立体感更强',
    platform: '抖音 / 小红书',
    local: '少见',
    match: (c) => (c.low >= 60 && c.mid >= 40 && c.pop >= 40 ? 1 : 0)
  },

  /* ---------------- 大气 ---------------- */
  {
    key: 'venusbelt',
    name: '地影与金星带',
    alias: '金星带 / 地球的影子',
    group: '大气',
    when: '日出日落时背对太阳，地平线上一条蓝灰色的阴影带，上方是粉色',
    shoot: '转身 180° 拍，粉色带（金星带）就在地影上沿；手机也能拍到',
    platform: 'B站 / 摄影教程',
    local: '常见',
    match: (c) => {
      const el = c.sunEl ?? 9
      return c.low <= 25 && el >= -6 && el <= 2 ? 1 : 0
    }
  },
  {
    key: 'rainbow',
    name: '彩虹',
    alias: '双彩虹 / 霓',
    group: '大气',
    when: '太阳高度 3°–42° 且附近有阵性降水、太阳还能照进来',
    shoot: '彩虹总在太阳正对面，先找背光方向；偏振镜能明显加深彩虹',
    platform: '小红书 / 抖音',
    local: '少见',
    match: (c) => (c.rainbow >= 60 ? 2 : c.rainbow >= 35 ? 1 : 0)
  },
  {
    key: 'cloudsea',
    name: '云海 / 平流雾',
    alias: '云瀑 / 雾海',
    group: '大气',
    when: '清晨低层湿度接近饱和、低云铺满、山顶在云上（五指山最典型）',
    shoot: '日出前 20 分钟到山顶，等第一缕光把云顶染成金色',
    platform: '小红书 / 抖音',
    local: '少见',
    match: (c) =>
      c.kind === 'sunrise' && c.low >= 45 && (c.rh ?? 0) >= 88 ? 2 : 0
  },
  {
    key: 'goldenhour',
    name: '黄金时刻',
    alias: '金光时刻 / 摄影黄金时段',
    group: '大气',
    when: '日出后与日落前约 30–40 分钟，色温低、光比柔和',
    shoot: '人像逆光、海面拉丝都合适；记得用遮光罩防眩光',
    platform: '全平台通用',
    local: '每天',
    match: (c) => {
      const el = c.sunEl ?? -9
      return el >= -1 && el <= 8 ? 1 : 0
    }
  },
  {
    key: 'bluehour',
    name: '蓝调时刻',
    alias: '蓝调 / 蓝色时刻 / 冷调天',
    group: '大气',
    when: '日落后 15–35 分钟，天空呈深蓝，与城市灯光形成冷暖对比',
    shoot: '上三脚架，曝光 2–10 秒；白平衡往冷里推一点，蓝色更纯',
    platform: '全平台通用',
    local: '每天',
    match: (c) => {
      const el = c.sunEl ?? 9
      return el <= -4 && el >= -12 ? 1 : 0
    }
  },
  {
    key: 'greenslash',
    name: '绿闪',
    alias: '绿光 / 翡翠闪光',
    group: '大气',
    when: '地平线极干净、大气分层明显时，太阳没入瞬间可能出现一瞬绿光',
    shoot: '长焦连拍，太阳刚落下的 1–2 秒；纯靠运气，别当主要目标',
    platform: 'B站 / 天文爱好者',
    local: '几乎不可能',
    match: (c) => (c.low <= 8 && (c.vis ?? 0) >= 25 && Math.abs(c.sunEl ?? 9) <= 1 ? 1 : 0)
  },
  {
    key: 'skyspejo',
    name: '天空之镜',
    alias: '倒影 / 镜面沙滩',
    group: '平台口语',
    when: '退潮后的湿沙滩 + 低风速 + 火烧云，倒影最完整',
    shoot: '贴地到 10cm 高度拍，倒影和真云各占一半，对称构图',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => (c.score >= 55 && c.low <= 25 ? 1 : 0)
  },
  {
    key: 'reflect',
    name: '火烧云倒影',
    alias: '海面烧起来了 / 倒影火烧',
    group: '霞',
    when: '火烧云 + 平静海面或湿沙滩，倒影的饱和度往往比天空更高',
    shoot: '贴着水面找倒影，倒影里没有云层遮挡，颜色常比天上更纯',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => (c.score >= 60 && c.low <= 30 ? 2 : 0)
  },
  {
    key: 'rosegold',
    name: '玫瑰金时刻',
    alias: '香槟金 / 玫瑰色天光',
    group: '霞',
    when: '太阳高度 0–8°、薄高云、AOD 0.1–0.25，天空呈玫瑰金渐变',
    shoot: '白平衡固定日光，别让手机自动乱拉；后期只微调色温',
    platform: '小红书',
    local: '常见',
    match: (c) => {
      const el = c.sunEl ?? -9
      return el >= -2 && el <= 8 && c.aod >= 0.1 && c.aod <= 0.28 && c.high >= 25 ? 2 : 0
    }
  },
  {
    key: 'glitter',
    name: '金色光路',
    alias: '太阳的倒影 / 金光大道 / 波光',
    group: '霞',
    when: '太阳快贴近海面、海面有微浪，海面上拉出一条金色反光带',
    shoot: '长焦压缩光路，或广角让人物剪影站在光路尽头',
    platform: '小红书 / 抖音',
    local: '常见',
    match: (c) => {
      const el = c.sunEl ?? 9
      return el >= -1 && el <= 6 && c.low <= 25 ? 1 : 0
    }
  },
  {
    key: 'sunbeam',
    name: '太阳光束',
    alias: '光芒 / 光剑 / 直射光',
    group: '光束',
    when: '太阳被云挡出一道光缝，光柱斜插向地面或海面',
    shoot: '点测光在高光上再 +1/3 档，让光束蓬松一点，别压成一根硬线',
    platform: '抖音 / 小红书',
    local: '常见',
    match: (c) => (c.crep >= 40 ? 1 : 0)
  },
  {
    key: 'glory',
    name: '宝光（佛光）',
    alias: '佛光 / 光环 / 峨眉宝光',
    group: '冰晶光学',
    when: '背对太阳、前方有云雾，自己的影子会落在彩色光环中央',
    shoot: '背影 + 光环同时入镜；山上或飞机上最容易遇到',
    platform: 'B站 / 摄影教程',
    local: '几乎不可能',
    match: () => 0
  },
  {
    key: 'moonhalo',
    name: '月晕 / 幻月',
    alias: '月亮套圈 / 月华',
    group: '冰晶光学',
    when: '夜间高空有薄卷层云，月亮周围出现 22° 光晕',
    shoot: '上三脚架长曝；月晕很暗，ISO 放到 1600 也不嫌高',
    platform: 'B站 / 天文爱好者',
    local: '少见',
    match: () => 0
  },
  {
    key: 'circumzenithal',
    name: '环天顶弧',
    alias: '倒挂彩虹 / 天空的微笑',
    group: '冰晶光学',
    when: '太阳高度 15°–32°、高空有薄卷云，天顶方向出现一段倒挂的彩虹弧',
    shoot: '抬头看天顶，用广角把它和建筑/树梢一起框进去',
    platform: '气象爱好者 / B站',
    local: '少见',
    match: (c) => {
      const el = c.sunEl ?? 0
      return el >= 15 && el <= 32 && highGenus(c) === '卷层云' ? 1 : 0
    }
  },
  {
    key: 'cirrostratus',
    name: '卷层云帷幕',
    alias: '薄幕云 / 纱状云',
    group: '云',
    when: '一整片半透明的薄幕，能看见太阳轮廓，常见日晕',
    shoot: '长曝拉丝，或用减光镜把幕布的层次拍出来',
    platform: 'B站 / 气象爱好者',
    local: '少见',
    match: (c) => (has(c.layers, 'Cs', 40) ? 1 : 0)
  },
  {
    key: 'altostratus',
    name: '高层云',
    alias: '透光高层云 / 灰幕',
    group: '云',
    when: '一层均匀的灰白幕布，太阳像隔了毛玻璃',
    shoot: '适合拍极简和高对比剪影，别指望有颜色',
    platform: '摄影教程',
    local: '常见',
    match: (c) => (has(c.layers, 'As', 40) ? 1 : 0)
  },
  {
    key: 'nimbostratus',
    name: '雨层云',
    alias: '雨幕云 / 阴雨天的厚云',
    group: '云',
    when: '低厚均匀的降水云，全天灰暗，基本没有霞',
    shoot: '这种天改拍雨雾和湿地纹理，别死等太阳',
    platform: '摄影教程',
    local: '常见',
    match: (c) => (has(c.layers, 'Ns', 50) ? 1 : 0)
  },
  {
    key: 'velum',
    name: '幡状云',
    alias: '雨幡 / 云下雨帘',
    group: '云',
    when: '降水还没落到地面就在半空蒸发，云底挂下一条条雨丝',
    shoot: '长焦对着云底拍雨丝，逆光时最明显',
    platform: '气象爱好者',
    local: '少见',
    match: (c) => (c.mid >= 40 && c.pop >= 30 && c.pop <= 60 ? 1 : 0)
  },
  {
    key: 'rollcloud',
    name: '滚轴云',
    alias: '管状云 / 卷轴云',
    group: '云',
    when: '锋面前沿的强上升气流卷成长管状云，常伴大风',
    shoot: '广角横构图交代它的长度，注意保护相机别被风沙打',
    platform: '抖音 / B站',
    local: '少见',
    match: (c) => (c.low >= 50 && c.pop >= 50 ? 1 : 0)
  },
  {
    key: 'noctilucent',
    name: '夜光云',
    alias: '极区中间层云 / 发光的云',
    group: '云',
    when: '日落后 1–2 小时、高纬度夏季，中间层出现银蓝色发光云',
    shoot: '长曝 + 高 ISO，海南纬度太低，基本看不到',
    platform: '天文爱好者',
    local: '几乎不可能',
    match: () => 0
  },
  {
    key: 'aurora',
    name: '极光',
    alias: '北极光 / 欧若拉',
    group: '大气',
    when: '强地磁暴期间高纬地区夜间出现，海南纬度理论上不可见',
    shoot: '大光圈广角 + 15–20 秒曝光；本地无可能，纯收录',
    platform: 'B站 / 天文爱好者',
    local: '几乎不可能',
    match: () => 0
  },
  {
    key: 'milkyway',
    name: '银河',
    alias: '银心 / 星空',
    group: '大气',
    when: '无月夜、光害低、天气晴朗；海南西岸与中部山区条件较好',
    shoot: '20–30 秒曝光、f/2.8、ISO 3200，后期堆栈降噪',
    platform: '小红书 / B站',
    local: '少见',
    match: () => 0
  },
  {
    key: 'startrail',
    name: '星轨',
    alias: '星轨长曝 / 星空之眼',
    group: '大气',
    when: '北天极方向长曝 40 分钟以上，或堆栈 200 张以上',
    shoot: '对北天极、间隔 30 秒连拍 200 张堆栈，别用单张长曝免得热噪',
    platform: 'B站 / 摄影教程',
    local: '少见',
    match: () => 0
  },
  {
    key: 'doublerainbow',
    name: '双彩虹',
    alias: '霓 / 副虹',
    group: '大气',
    when: '主虹外侧再出现一道更淡的副虹，颜色顺序相反',
    shoot: '偏振镜会让副虹更明显；广角把整道主虹收全',
    platform: '小红书',
    local: '少见',
    match: (c) => (c.rainbow >= 70 ? 1 : 0)
  },
  {
    key: 'moonbow',
    name: '月虹',
    alias: '夜间彩虹 / 月光虹',
    group: '大气',
    when: '满月 + 阵雨，月光穿过雨幕形成极淡的白色虹',
    shoot: '长曝 15–30 秒才能拍出来，肉眼常常只看到一道白弧',
    platform: 'B站 / 天文爱好者',
    local: '几乎不可能',
    match: () => 0
  },
  {
    key: 'fogbow',
    name: '雾虹',
    alias: '白色彩虹 / 雾中环',
    group: '大气',
    when: '浓雾里背对太阳，出现一圈近乎白色的光弧',
    shoot: '雾天逆光，注意镜头起雾，提前擦净并挂偏振',
    platform: '摄影教程',
    local: '少见',
    match: (c) => ((c.rh ?? 0) >= 95 && (c.vis ?? 99) <= 2 ? 1 : 0)
  },
  {
    key: 'marble',
    name: '荚状云 · 山帽云',
    alias: 'UFO 云 / 戴帽云 / 豆荚云',
    group: '云',
    when: '稳定的山地气流被地形抬升，在五指山、黎母山一带偶见',
    shoot: '长焦压缩云与山的关系，等一阵风让云形状更立体',
    platform: '小红书 / B站',
    local: '少见',
    match: () => 0
  },
  {
    key: 'mushroom',
    name: '蘑菇云',
    alias: '积雨云顶 / 蘑菇头',
    group: '云',
    when: '强对流发展到成熟阶段，云顶冲高后被对流层顶压成伞状',
    shoot: '距离保持安全，长焦拍云顶；雷电天气优先考虑安全',
    platform: '抖音',
    local: '少见',
    match: (c) => ((c.cape ?? 0) >= 2000 && c.pop >= 60 ? 1 : 0)
  },
  {
    key: 'firenice',
    name: '火烧冰',
    alias: '冰晶被点亮 / 高空冰云晚霞',
    group: '云',
    when: '高空冰晶云被夕阳从下方照亮，整片云呈现饱和橙红',
    shoot: '这种云的红色最纯，广角直接铺满天空就够',
    platform: '追霞群',
    local: '常见',
    match: (c) => {
      const ice = c.layers.some((l) => l.height >= 6000 && l.t != null && l.t <= -25 && l.cover >= 30)
      return ice && c.score >= 62 ? 2 : 0
    }
  },
  {
    key: 'crystal',
    name: '水晶天',
    alias: '玻璃天 / 通透天 / 蓝得发黑',
    group: '大气',
    when: 'AOD 低于 0.1，气溶胶比瑞利散射本身还少，天空深蓝、远山清晰如玻璃',
    shoot: '这种天蓝色最纯，适合拍极简和大场景；后期别再拉饱和，会失真',
    platform: '追霞圈 / SunsetBot 用户',
    local: '少见',
    match: (c) => (c.clarity >= 85 ? 2 : c.clarity >= 70 ? 1 : 0)
  },
  {
    key: 'cloudshadow',
    name: '云影',
    alias: '云的影子 / 光柱影子',
    group: '大气',
    when: '太阳低角度时，云在地面或海面投下清晰的暗影',
    shoot: '高处俯拍，云影和海面的亮带形成强对比',
    platform: '摄影教程',
    local: '常见',
    match: (c) => (c.crep >= 35 && c.low <= 35 ? 1 : 0)
  },
  {
    key: 'skylight',
    name: '天光',
    alias: '天开眼 / 一束天光',
    group: '光束',
    when: '厚云中间忽然裂开一条缝，光像从天上倒下来',
    shoot: '广角逆光 + 收两档曝光，把光缝压成利落的一束',
    platform: '抖音 / 小红书',
    local: '少见',
    match: (c) => (c.crep >= 60 && c.low >= 35 ? 1 : 0)
  }
]

export const PHENO_GROUPS: PhenoGroup[] = ['霞', '光束', '冰晶光学', '云', '大气', '平台口语']

/** 这个时刻最值得拍的题材（按“很有戏”优先，取前 5 条） */
export function matchPhenomena(c: PhenoContext): Phototip[] {
  const hits = PHENOMENA
    .map((p) => ({ p, v: p.match(c) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || (a.p.group === '霞' ? -1 : 1))

  const out: Phototip[] = []
  for (const h of hits) {
    out.push({
      key: h.p.key,
      name: h.p.name,
      alias: h.p.alias,
      why: h.p.when,
      shoot: h.p.shoot
    })
    if (out.length >= 5) break
  }
  return out
}
