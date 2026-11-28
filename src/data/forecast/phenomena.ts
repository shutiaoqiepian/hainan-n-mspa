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

import type { CloudLayer, KindKey, PhenoRarity, Phototip, TimeScope } from '@/lib/forecast/types'

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
  /**
   * 机位朝向与**反日点**（太阳方位 +180°）的匹配度，0.55–1，1 = 正对反日点。
   * 反云隙光、反日弧这类现象的几何前提是「真的背对太阳」，
   * 而 faceOff 只表示「偏离太阳 37° 以上」—— 37° 离 180° 差得很远，
   * 用它判反云隙光会把侧逆光的机位也算成能拍到反日点的光条。
   */
  antiFace: number
  layers: CloudLayer[]
  t2m: number | null
}

export interface Phenomenon {
  key: string
  name: string
  /** 别名 / 黑话 */
  alias: string
  group: PhenoGroup
  /** 时段域。不写就按下面的 SCOPES 表查，再查不到按 any —— 老词条一行都不用改 */
  scope?: TimeScope
  /** 出现时间（人话）。不写就按 HOURS 表查，再查不到按 scope 给粗标签 */
  hours?: string
  /** 出现的条件，人话（词典里展示） */
  when: string
  /** 怎么拍 */
  shoot: string
  /** 主要流传平台 */
  platform: string
  /** 本地（海南）出现概率 */
  local?: PhenoRarity
  /** 0 = 不匹配，1 = 有机会，2 = 很有戏 */
  match: (c: PhenoContext) => number
}

function has(layers: CloudLayer[], code: string, minCover = 25): boolean {
  return layers.some((l) => l.code === code && l.cover >= minCover)
}
function highGenus(c: PhenoContext): string {
  const hi = c.layers.filter((l) => l.height >= 6000 && l.code !== '--')
  if (hi.length) return hi[hi.length - 1].genus
  /* 退路：剖面里没有高云层时，用高云量（cloud_cover_high）代理。
     实测海南 3 天 42 小时：300 hPa 云量恒为 0、200 hPa 仅 4 小时 ≥30%，
     而 cloud_cover_high 同一时段明显更高。只认 layers 的结果就是
     白天五条冰晶判据整年几乎不命中，「其它时段」永远是空的。
     退路只判「有高云」，不细分属名 —— 所以下面各条的属名判断都接受「卷云」。 */
  if ((c.high ?? 0) >= 30) return '卷云'
  return ''
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
  {
    key: 'symmetric',
    name: '对称霞',
    alias: '两边烧 / 全场烧 / 满烧 / 360 度烧',
    group: '霞',
    when: '高云薄而广、铺满整片天，太阳两侧乃至背后都在变色，转到哪个方向都有戏',
    shoot: '这是唯一值得换广角拍全景、甚至接片的局面；先在原地拍完，再绕着转，别一开始就乱跑',
    platform: '追霞群 / 小红书',
    local: '少见',
    /* 判据：高云饱满且低云几乎不挡（挡一边就不对称了），
       再加通透度兜底 —— 灰霾天也会有"整片亮"，但那是脏不是烧。 */
    match: (c) => (c.high >= 70 && c.low <= 20 && c.clarity >= 55 ? 2 : 0)
  },
  {
    key: 'noshow',
    name: '烧空（放空）',
    alias: '翻车 / 白来 / 空跑 / 天没烧',
    group: '平台口语',
    when: '云量够了但云太厚、太阳被挡在地平线下就停了，或者 AOD 太高把颜色全吃掉',
    shoot: '确认没戏就收，别硬等。反过来看这是唯一适合转拍长曝、剪影或城市灯的时机',
    platform: '追霞群',
    local: '常见',
    /* 判据：分数低 + 有过云（不是全晴）+ 太阳已沉（不是大白天）。
       全晴天不该叫"放空"—— 那是压根没报过。 */
    match: (c) => {
      const el = c.sunEl ?? 9
      const cloudy = c.high + c.mid + c.low >= 35
      return c.score <= 28 && cloudy && el <= -1 ? 1 : 0
    }
  },
  {
    key: 'sunriseglow',
    name: '朝霞（日出霞）',
    alias: '早霞 / 朝烧 / 早上那场',
    group: '霞',
    when: '日出前一片高云被照亮；因为夜里空气沉静、低云往往比傍晚少，朝霞比晚霞更干净',
    shoot: '日出霞来得比晚霞快，提前 50 分钟到位；天亮前先拍蓝调，再等第一片云发红',
    platform: '追霞群 / 小红书',
    local: '常见',
    /* 刻意和落日词条分开：朝霞没有"回光返照"的余韵，
       而是太阳浮出地平线前那 20 分钟最艳。 */
    match: (c) => {
      const el = c.sunEl ?? 9
      return c.kind === 'sunrise' && el <= 2 && el >= -8 && c.high >= 30 && c.low <= 45 ? 2 : 0
    }
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
    /* 反日点几何：机位朝向必须接近「太阳方位 +180°」。
       旧判据用 faceOff（= 偏离太阳超过约 37°），那只说明「不是顺光」，
       离背对还差 140°，于是几乎所有倒向机位都会误报。
       antiFace ≥ 0.72 ≈ 与反日点夹角 68° 以内，和「光条在反日点附近汇聚」
       的实际可见范围对得上。 */
    match: (c) => (c.antiFace >= 0.72 && c.crep >= 28 ? 1 : 0)
  },
  {
    key: 'stage',
    name: '舞台光',
    alias: '聚光灯 / 一束光打在海上',
    group: '光束',
    when: '低云有缝、中高云成片，光柱像聚光灯一样落在地面、水面或山体上',
    shoot: '等光斑落到你想要的地景上再按，光斑移动很快，连拍更保险',
    platform: '抖音 / 小红书',
    local: '少见',
    /* 光斑要落在地面/水面上，太阳必须还在地平线以上。
       crep 在日落后仍会留分数（它本来就是给暮光设计的），不加这条会在
       天已经黑透时提示「舞台光」。-1° 是太阳上缘刚没入地平线的位置。 */
    match: (c) => (c.crep >= 55 && c.low <= 35 && (c.sunEl ?? -9) > -1 ? 2 : 0)
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
    /* 阈值与 pillarLabel 对齐：pillarOf 的实际上限是 60（100×0.6），
       旧判据写 ≥70 是永远达不到的「很有戏」，日柱因此从未作为预测出现过。 */
    match: (c) => (c.pillar >= 55 ? 2 : c.pillar >= 35 ? 1 : 0)
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
      return (highGenus(c) === '卷层云' || highGenus(c) === '卷云') && c.high >= 40 && el >= 5 && el <= 30 ? 1 : 0
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
  {
    key: 'iridescence',
    name: '七彩祥云（虹彩云）',
    alias: '虹彩云 / 彩虹云 / 彩云 / 七彩羽毛',
    group: '冰晶光学',
    when: '面朝太阳、太阳不高（高度角 10–40° 为主、黄昏仍可见），天上有薄而均匀的高积云或卷积云，云中 1–50 微米的小水滴/冰晶把阳光衍射成七彩',
    shoot: '紧贴太阳周边找（视线与太阳夹角小于 30°），长焦切局部、压暗半档让彩色条纹跳出来；千万别直视太阳，用屏幕取景',
    platform: '小红书 / 抖音 / 微博',
    local: '罕见',
    /* 判据阈值依据科学文献（不是拍脑袋）：
       · 机制＝衍射（非彩虹的折射+反射）；微粒 1–50μm 且尺寸均匀，
         世界气象组织口径 1–10μm 最易衍射（星洲网引 NASA/WMO）
       · 云型＝薄高积云 Ac / 卷积云 Cc 为主（温州鹿城、江苏头条、澎湃一致）；
         卷云 Ci 也可但罕见（Sassen 2003, Appl. Opt. 42:486 卷云虹彩案例）
       · 太阳高度角＝主流 10–40°（温州、江苏）；广州头条「<45°」为上限；
         澎湃「黄昏时分虹彩荚状云仍辉映余霞」→ 下限放宽到 -4°（日落刚过）
       · 面朝太阳＝前向散射，视线与太阳 <30°（广州头条）；
         faceOff=false 即 face≥0.85 ≈ 夹角 32°，正好对应
       · 天气＝晴、无雨、空气通透（江苏头条「晴空万里、空气质量极佳」）；
         但广州头条指出虹彩云常是雷雨前兆（出现当下还没下雨），故 pop 只卡到 45
       · 加分＝高空薄云更绚烂（澎湃「万米之上色彩更绚丽」→ height≥4500，
         这也隐含冷云/冰晶，比直接卡云温更可靠，因 t 可能缺测） */
    match: (c) => {
      /* 必须面朝太阳 —— 衍射是前向散射，背对太阳看不到虹彩 */
      if (c.faceOff) return 0
      const el = c.sunEl
      if (el == null || el < -4 || el > 45) return 0
      /* 薄而均匀的高积云/卷积云 */
      const thin = c.layers.filter(
        (l) => (l.code === 'Ac' || l.code === 'Cc') && l.cover >= 15 && l.cover <= 60
      )
      if (!thin.length) return 0
      /* 晴、无雨、通透 */
      if (c.pop > 45) return 0
      if (c.aod > 0.4) return 0
      /* 高空薄云（≈冷云/冰晶）→ 更绚烂，升「很有戏」 */
      return thin.some((l) => l.height >= 4500) ? 2 : 1
    }
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
    /* 文案原来写「多在强冷空气过境前出现，预示天气要大变」——这是华北/江淮的
       经验说法，低纬并不成立（海南的波状层积云多出现在信风逆温层顶）。
       而且判据里既没有风场也没有季节，撑不起「冷空气」这个结论。
       改成只讲成因，不承诺预报意义。 */
    when: '低空云条排成波浪状，多出现在逆温层顶或冷暖平流交界处；云条走向与高空风向接近平行',
    shoot: '广角拍它的层叠，压低曝光让云条的立体感更强',
    platform: '小红书 / 抖音',
    local: '少见',
    /* 只判云型与降水概率。缺 850/700 hPa 风场，判不了「是否冷空气过境」，
       所以词条里也不再声称能预示天气大变。 */
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
  {
    key: 'lowdeck',
    name: '低云压顶',
    alias: '天花板云 / 锅盖云 / 闷罐天',
    group: '云',
    when: '低云底低于 600 米且云量很大，天空像盖了锅盖，纵深全无',
    shoot: '不要广角拍天空，改拍近景、局部、地面反射；这种天纵深为零，硬收全景只能得到一片灰',
    platform: '摄影教程 / 小红书',
    local: '常见',
    /* 这条用的是 ctx 里一直空着的 cloudBaseLow。
       低云底是判断"能不能拍全景"最直接的量：600 米以下的平幕天空没有远近层次。 */
    match: (c) => {
      const cb = c.cloudBaseLow
      return cb != null && cb < 600 && c.low >= 55 ? 1 : 0
    }
  },
  {
    key: 'splitflow',
    name: '模式打架',
    alias: '各家不一致 / 预报分歧 / 五五开',
    group: '大气',
    when: 'GFS、ECMWF、ICON 等各模式对同一时刻的评分差异很大（标准差 ≥ 12 分），说明这天本身摇摆',
    shoot: '这不是天象而是风险提示：分歧大时别为它专门跑一趟，就近拍；分歧小的日子预报才可信',
    platform: '追霞群',
    local: '常见',
    /* spread = 各模式分数的标准差，一直算好却没用上。
       把它翻成用户能用的判断：分数是同一个，但可信度完全不同。 */
    match: (c) => (c.spread >= 12 && c.score >= 40 ? 1 : 0)
  },

  /* ---------------- 大气 ---------------- */
  {
    key: 'venusbelt',
    name: '地影与维纳斯带',
    alias: '维纳斯带 / 金星带 / 地球的影子',
    group: '大气',
    when: '日出日落时背对太阳，地平线上一条蓝灰色的阴影带，上方是粉色',
    shoot: '转身 180° 拍，粉色带（维纳斯带）就在地影上沿；手机也能拍到',
    platform: 'B站 / 摄影教程',
    local: '常见',
    match: (c) => {
      /* 地影是地球本身挡住阳光投在大气里的暗带，**太阳必须已经落到地平线下**
         才会形成。旧判据上限写 +2°（太阳还在地平线上），那时候地影尚未成形、
         粉带也被直射光冲淡，物理上讲不通。改到 -0.5° 以下，-8° 以下天光就压过它了。 */
      const el = c.sunEl ?? 9
      return c.low <= 25 && el >= -8 && el <= -0.5 ? 1 : 0
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
    shoot: '人像逆光、水面（海/湖）拉丝都合适；没有水就靠地面反光或逆光剪影，记得用遮光罩防眩光',
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
      /* 下限收到 -8°（民用暮光结束）而不是 -12°：-12° 已是航海暮光末尾，
         天基本黑了，只剩最后一点深蓝，和「日落后 15–35 分钟」的文案也不符。
         -4°～-8° 正好对应日落后约 15–35 分钟。 */
      return el <= -4 && el >= -8 ? 1 : 0
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
    when: '火烧云 + 平静水面（海、湖、港池甚至湿路面），倒影的饱和度往往比天空更高',
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
    when: '太阳快贴近地平线、水面有微浪，水面上拉出一条金色反光带（海边、湖面、宽阔河面都行）',
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
    when: '太阳被云挡出一道光缝，光柱斜插向地面',
    shoot: '点测光在高光上再 +1/3 档，让光束蓬松一点，别压成一根硬线',
    platform: '抖音 / 小红书',
    local: '常见',
    match: (c) => (c.crep >= 40 ? 1 : 0)
  },
  {
    key: 'glory',
    name: '宝光（佛光）',
    alias: '佛光 / 光环 / 峨眉宝光',
    /* 宝光是**水滴**的背向散射 + 衍射（和彩虹同族），不是冰晶折射。
       旧版归到「冰晶光学」是分类错误，会让用户以为它跟晕是同一种成因。 */
    group: '大气',
    when: '背对太阳、前方有云雾，自己的影子会落在彩色光环中央',
    shoot: '背影 + 光环同时入镜；山上或飞机上最容易遇到',
    platform: 'B站 / 摄影教程',
    local: '几乎不可能',
    match: () => 0
  },
  {
    key: 'moonhalo',
    /* 原先这条叫「月晕 / 幻月」、别名里还挂着「月华」，把三种成因不同的现象
       塞进了一条：22° 月晕和幻月是**冰晶折射**，月华是**水滴衍射**（半径只有几度）。
       拆开之后这条只管冰晶族的两个，月华另立一条。 */
    name: '月晕 / 幻月',
    alias: '月亮套圈 / 幻月 / 22° 月晕',
    group: '冰晶光学',
    when: '夜间高空有薄卷层云，月亮周围出现 22° 光晕；晕圈左右两侧的亮点是幻月',
    shoot: '上三脚架长曝；月晕很暗，ISO 放到 1600 也不嫌高',
    platform: 'B站 / 天文爱好者',
    local: '少见',
    /* 22° 月晕与日晕同源（卷层云冰晶折射），判据也照日晕那一套。
       ⚠️ 没有月相数据，「月亮在不在天上」判不了 —— 只判云与降水。 */
    match: (c) => {
      const g = highGenus(c)
      return (g === '卷层云' || g === '卷云') && c.high >= 30 && c.pop <= 20 ? 1 : 0
    }
  },
  {
    key: 'mooncorona',
    name: '月华',
    alias: '华 / 月冠 / 月亮彩环',
    /* 与宝光、虹彩云同族：都是**水滴（或小冰晶）衍射**，不是冰晶折射。
       所以归「大气」，不归「冰晶光学」。 */
    group: '大气',
    when: '月亮周围出现一圈几度大的彩色环，内蓝外红，薄高积云或卷积云时最常见',
    shoot: '长焦对月，欠曝 1–2 档颜色才出得来；环很小，别用广角',
    platform: 'B站 / 天文爱好者',
    local: '少见',
    /* 华看的是「薄中云」而不是「卷层云」：半径只有几度，云滴要小而均匀。
       layers 里没有 Ac/Cc 时退回中云量判断（与 highGenus 的退路同一思路）。
       ⚠️ 同样缺月相数据，判不了月亮在不在。 */
    match: (c) => {
      const thin = c.layers.some((l) => (l.code === 'Ac' || l.code === 'Cc') && l.cover >= 20 && l.cover <= 70)
      if (thin) return c.pop <= 25 ? 1 : 0
      return c.mid >= 30 && c.mid <= 70 && c.pop <= 25 ? 1 : 0
    }
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
      return el >= 15 && el <= 32 && (highGenus(c) === '卷层云' || highGenus(c) === '卷云') ? 1 : 0
    }
  },
  {
    key: 'halo46',
    name: '46° 晕（大晕）',
    alias: '大晕 / 外圈晕 / 双晕',
    group: '冰晶光学',
    when: '卷层云里冰晶很薄很规整时，22° 晕外面还会再套一圈 46° 晕，颜色比内圈淡',
    shoot: '46° 晕直径接近 92°，14mm 都未必装得下；优先拍它和 22° 晕同框的局部',
    platform: '气象爱好者',
    local: '罕见',
    /* 46° 晕比 22° 晕苛刻得多：冰晶必须是规整的六棱柱且取向纯净，
       所以条件叠得更紧（云更薄、云量更窄）。
       ⚠️ 旧版还有一条 `el >= 20`，没有物理依据：46° 晕的角半径是固定的，
       太阳高度只决定「能看到哪一段弧」，不决定它能不能出现。
       去掉之后，低太阳角时也能正确提示（那时看到的是上方弧段）。 */
    match: (c) => {
      const g = highGenus(c)
      return (g === '卷层云' || g === '卷云') && c.high >= 50 && c.high <= 80 ? 1 : 0
    }
  },
  {
    key: 'parhelic',
    name: '幻日环',
    alias: '白光横带 / 水平光带',
    group: '冰晶光学',
    when: '太阳高度很低时，冰晶把光反射成一条与地平线平行的白带，穿过太阳横贯天空',
    shoot: '低太阳角 + 水平横构图，把白带当地平线以上的"第二条线"用',
    platform: '气象爱好者 / 摄影教程',
    local: '少见',
    match: (c) => {
      const el = c.sunEl ?? 99
      return (highGenus(c) === '卷层云' || highGenus(c) === '卷云') && c.high >= 35 && el >= -2 && el <= 20 ? 1 : 0
    }
  },
  {
    key: 'circumhorizon',
    name: '环地平弧',
    alias: '火焰彩虹 / 火彩虹 / 彩虹云',
    group: '冰晶光学',
    when: '太阳高于 58°、卷云里是片状冰晶，地平线上方会出现一条极亮的水平彩带',
    shoot: '南方低纬度夏天正午前后才可能；色彩是全天空象里最艳的，记得压曝光',
    platform: '小红书 / 气象爱好者',
    local: '几乎不可能',
    /* 海南纬度 18–20°，太阳高度最高约 88°，理论上够；
       但需要 58° 以上 + 特定的片状冰晶，实操中极罕见，所以给"有机会"不打满分。 */
    match: (c) => {
      const el = c.sunEl ?? 0
      return el >= 58 && highGenus(c) === '卷云' && c.high >= 20 ? 1 : 0
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
    /* 雨层云是中低云：云底 0.5–2 km、云顶可到 6 km，只判 700 hPa 一层（≈3 km）
       会漏掉「云底已经压到地面附近」的典型雨层云，也会把单纯的高层云误判成它。
       改成「中云层判到 Ns」或「低云几乎铺满 + 近饱和 + 正在降水」两条取一。 */
    match: (c) => (has(c.layers, 'Ns', 50) || (c.low >= 70 && (c.rh ?? 0) >= 90 && c.pop >= 60) ? 1 : 0)
  },
  {
    /* key 原本写作 `velum`，但 velum 是「幞状云」（积云顶上那层薄纱），
       和这条讲的东西不是一回事；雨幡的规范名是 virga。
       改 key 前查过全仓：只有本文件引用，无外部链接依赖。 */
    key: 'virga',
    name: '雨幡',
    alias: '幡状云 / 云下雨帘 / 雨丝',
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
    /* 滚轴云是锋面/雷暴出流的产物，单看「低云多 + 降水概率高」等于每个
       阴雨天都报一次。缺 10 m 阵风与风切变数据，用 CAPE 当对流环境的代理：
       没有不稳定能量就不可能滚起来。宁可漏报（红线：宁漏不误）。
       真要做准，需要阵风锋的 METAR 风向突变或雷达细线回波，目前数据里没有。 */
    match: (c) => (c.low >= 50 && c.pop >= 60 && (c.cape ?? 0) >= 1000 ? 1 : 0)
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
    /* 银河要的是「云少 + 不降水 + 通透」。⚠️ 同样没有月相与光害数据，
       「无月夜」判不了，只判云与降水；文案里的「无月夜」是观测要求，不是预测结论。 */
    match: (c) => {
      const cloud = (c.high ?? 0) + (c.mid ?? 0)
      return (c.low ?? 99) <= 25 && cloud <= 40 && c.pop <= 20 && (c.vis ?? 0) >= 15 ? 1 : 0
    }
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
    /* 星轨比银河更怕薄云（长曝会把薄云拉成灰幕），阈值更严一档 */
    match: (c) => ((c.low ?? 99) <= 20 && ((c.high ?? 0) + (c.mid ?? 0)) <= 30 && c.pop <= 15 ? 1 : 0)
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
    /* 「本地常见」这个评级不成立：低纬 6000 m 以上常年 -20℃ 上下，
       真正的冰晶云（要够冷 + 够厚）一年里没几天。降为「少见」。 */
    local: '少见',
    match: (c) => {
      /* ⚠️ 旧判据写 t ≤ -25℃。6000 m 标准大气约 -24℃，低纬实际常在 -20℃ 左右，
         这一条等于把整个低纬挡在门外；冰晶在 -15℃ 以下就已占优，
         取 -20℃ 作为「以冰晶为主」的保守门槛。
         另外剖面里 300/200 hPa 云量常年为 0，高云层被判成无云，
         所以补一条用 c.high（高云量）的退路。 */
      const ice = c.layers.some((l) => l.height >= 6000 && l.t != null && l.t <= -20 && l.cover >= 30)
      if (ice) return c.score >= 62 ? 2 : 0
      const cold = c.layers.some((l) => l.height >= 6000 && l.t != null && l.t <= -20)
      return (c.high ?? 0) >= 35 && cold && c.score >= 62 ? 2 : 0
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
    when: '太阳低角度时，云在地面、水面或山体上投下清晰的暗影',
    shoot: '高处俯拍，让云影和亮带（水面反光、雪地、大片平地）形成强对比',
    platform: '摄影教程',
    local: '常见',
    /* 云影的方向由太阳定，太阳落到地平线以下就没有「影」了 */
    match: (c) => (c.crep >= 35 && c.low <= 35 && (c.sunEl ?? -9) > -1 ? 1 : 0)
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
    /* 云缝里下来的直射光，同样要求太阳在地平线以上 */
    match: (c) => (c.crep >= 60 && c.low >= 35 && (c.sunEl ?? -9) > -1 ? 1 : 0)
  },
  {
    key: 'lightdust',
    name: '晨雾 / 薄霭',
    alias: '地雾 / 平流轻雾 / 光雾',
    group: '大气',
    when: '夜里辐射降温把近地面压到露点附近，清晨出现一层贴地的薄雾，逆光会被照亮成金色',
    shoot: '这是全天最好拍的一小时：逆光让雾发亮、顺光只剩灰。提前查是否有雾，别到了才发现',
    platform: '摄影教程 / 小红书',
    local: '常见',
    /* 用 RH + 低能见度 + 无降水三个量判断：
       雾必须高湿、低能见度，但又不是在下雨（下雨该叫雨天，不是雾天）。 */
    match: (c) => {
      const rh = c.rh
      const vis = c.vis
      return rh != null && rh >= 93 && vis != null && vis <= 5 && c.pop <= 25 ? 1 : 0
    }
  },
  {
    key: 'silhouette',
    name: '逆光剪影',
    alias: '黑片 / 剪影 / 对着太阳拍',
    group: '平台口语',
    when: '太阳低、光比极大，前景只剩轮廓；追霞圈拍人像和椰树最常用的手法',
    shoot: '按天空曝光，前景任它黑；要轮廓干净就找形状明确的东西（树、人、栏杆），别指望保留细节',
    platform: '小红书 / 抖音',
    local: '每天',
    /* 判据：太阳低（光比大）+ 有云当背景（纯亮蓝天的剪影没有层次）+ 通透度不差。
       刻意只给 1 级：剪影几乎每天都能拍，是"顺手可拍"而不是"专门去等"，
       给 2 级会把真正需要等的火烧云挤下去。 */
    match: (c) => {
      const el = c.sunEl ?? 99
      return el >= -2 && el <= 12 && c.high + c.mid >= 20 && c.clarity >= 50 ? 1 : 0
    }
  }
]

export const PHENO_GROUPS: PhenoGroup[] = ['霞', '光束', '冰晶光学', '云', '大气', '平台口语']

/* ---------------- 时段域归属（2026-11-28） ----------------
   匹配器原来只在「日出/日落那一刻」评估全部词条，于是：
     · 白天冰晶（环地平弧要太阳 58°）与夜间天象（银河）结构上永远判不出来；
     · 判据不含太阳高度的云形态（鱼鳞云、低云压顶）照样命中，
       又因为只取前 5 条，把只有此刻才成立的低角度词条挤掉。
   这里给每条词条标一个时段域，匹配器据此分组 —— 词条一条没删、判据一行没改。

   标注依据分三类：
     ① 判据里已经含 sunEl 的（彩虹 / 日柱 / 幻日 / 环天顶弧 / 七彩祥云 …）→ 不标，按 any，
        它自己就管得住太阳高度，标了反而会在边界上误分组；
     ② 判据只有云量 / 评分 / crep，但文案明确是低太阳角的（火烧云 / 云隙光 / 蓝调）→ lowSun；
     ③ 只在对侧或其它时段成立的（朝霞写死 sunrise、银河只在夜里）→ dawn / night。
   未列出的 key 一律按 any 处理。 */
const SCOPES: Record<string, TimeScope> = {
  /* 仅日出侧 3 条：match 里本身写死 kind === 'sunrise'，日落预报里本就命中不了 */
  sunriseglow: 'dawn', cloudsea: 'dawn', lightdust: 'dawn',

  /* 需要太阳高度更高 5 条：日落时刻 el≈0，结构上判不出来 */
  circumzenithal: 'day', halo46: 'day', circumhorizon: 'day', sundog: 'day', halo: 'day',

  /* 夜间 7 条：日落时刻评估等于空转 */
  milkyway: 'night', startrail: 'night', moonbow: 'night',
  moonhalo: 'night', mooncorona: 'night', noctilucent: 'night', aurora: 'night',

  /* 暮曙光窗口 27 条：判据不含 sunEl，但语义只在低太阳角成立 */
  burn: 'lowSun', smallburn: 'lowSun', burnthrough: 'lowSun', pinkdusk: 'lowSun',
  orange: 'lowSun', dustburn: 'lowSun', afterglow: 'lowSun', symmetric: 'lowSun',
  palette: 'lowSun', noshow: 'lowSun', crepuscular: 'lowSun', anticrepuscular: 'lowSun',
  stage: 'lowSun', knife: 'lowSun', venusbelt: 'lowSun', goldenhour: 'lowSun',
  bluehour: 'lowSun', greenslash: 'lowSun', skyspejo: 'lowSun', reflect: 'lowSun',
  rosegold: 'lowSun', glitter: 'lowSun', sunbeam: 'lowSun', firenice: 'lowSun',
  cloudshadow: 'lowSun', skylight: 'lowSun', silhouette: 'lowSun'
}

/** 词条所属时段域，没标注的按 any（= 改造前的老行为） */
export function scopeOf(p: Phenomenon): TimeScope {
  return p.scope ?? SCOPES[p.key] ?? 'any'
}

/* 出现时间（人话）。和 SCOPES 分工：
     SCOPES 决定这条词归到哪一组（此刻 / 白天 / 今晚），
     HOURS  告诉用户一天里具体几点去看。
   白天词条的钟点按海口（北纬约 20°）太阳高度—时角关系给的经验值；
   冬季太阳高度偏低的情况，由词条自身的 el 判据拦住，这里不写死季节。
   没列出的按 scope 给粗标签（日落前后 / 白天 / 夜间），所以一条都不会缺。 */
const HOURS: Record<string, string> = {
  /* 仅日出侧 3 条 */
  sunriseglow: '日出前 30–50 分钟',
  cloudsea: '日出前 20 分钟–日出后 1 小时',
  lightdust: '日出前后 1 小时',

  /* 白天高太阳 5 条：这是原来在日落页永远看不到的那批。
     ⚠️ 写法刻意是「太阳高度 X° 时（海口约 …）」而不是直接写钟点：
     判据用的是太阳高度，钟点随纬度与季节变。漠河夏季 5°–30° 出现在早晚、
     冬季几乎不出现；三亚全年都在正午前后。写死「9–11 时」等于把海南口径
     当成全国口径发出去。 */
  circumhorizon: '太阳高于 58° 时（海口 4–8 月正午前后）',
  halo46: '太阳高于 0° 时（海口约 9–15 时；高纬冬季明显缩短）',
  circumzenithal: '太阳高度 15°–32° 时（海口约 9–11、14–16 时）',
  sundog: '太阳高度 5°–30° 时（海口约 9–11、14–16 时）',
  halo: '太阳高度 10° 以上时（海口约 9–16 时）',

  /* 夜间 7 条 */
  milkyway: '20 时后–次日 2 时（无月夜）',
  startrail: '21 时后整夜',
  moonbow: '满月夜的阵雨后',
  moonhalo: '夜间有薄卷层云时',
  mooncorona: '夜间有薄高积云时',
  noctilucent: '日落后 1–2 小时（本地基本不可见）',
  aurora: '强地磁暴的夜间（本地不可见）',

  /* 暮光里窗口很窄、值得单独标钟点的几条 */
  burn: '日落前 20 分钟–日落后 5 分钟',
  afterglow: '日落后 10–15 分钟',
  firenice: '日落前 10 分钟–日落后 10 分钟',
  greenslash: '日落入海的一瞬',
  bluehour: '日落后 15–35 分钟',
  goldenhour: '日出后 / 日落前 30–40 分钟',
  venusbelt: '日出前 / 日落后 10–20 分钟',
  noshow: '日落后 10 分钟仍无起色即可收机'
}

/** 该词条的出现时间；没有具体钟点的按时段域给粗标签 */
export function hoursOf(p: Phenomenon): string {
  const h = p.hours ?? HOURS[p.key]
  if (h) return h
  const s = scopeOf(p)
  if (s === 'lowSun') return '日落前后'
  if (s === 'dawn') return '日出前后'
  if (s === 'day') return '白天'
  if (s === 'night') return '夜间'
  return '全天'
}

/** 该词条在此刻成立吗。lowSun 与 dawn 同属「太阳很低」，互相兼容 —— 
    日出场景下火烧云、云隙光照样能拍，不能因为标了 lowSun 就不显示。 */
function scopeOk(s: TimeScope, now: TimeScope): boolean {
  if (s === 'any') return true
  if (s === 'lowSun') return now === 'lowSun' || now === 'dawn'
  return s === now
}

/** 稀缺度：越难得的词条越该排在前面。
    「每天」都能拍的东西（剪影、玫瑰金）不该挤掉「少见 / 罕见」的（对称霞、46° 晕）——
    否则用户看到的永远是那几条平平无奇的，词库扩充了也白扩。 */
const RARITY: Record<string, number> = {
  '几乎不可能': 5, '罕见': 4, '少见': 3, '常见': 2, '每天': 1
}

/** 缺省评级：词条没写 local 时按「常见」算（不改动任何一条已有的评级） */
export function rarityOf(p: Phenomenon): PhenoRarity {
  return p.local ?? '常见'
}

/** 排序：**当前时段优先** > 很有戏 > 霞优先 > 越少见 > 词库顺序。
    第一级是 2026-11-28 新增的时段域，解决「白天/夜间词条挤掉此刻词条」。 */
function rank(c: PhenoContext, now: TimeScope) {
  return PHENOMENA
    .map((p, i) => ({ p, v: p.match(c), i, r: RARITY[p.local ?? '常见'] ?? 2, s: scopeOf(p) }))
    .filter((x) => x.v > 0)
    /* 每一级都必须给出完整的序 ——
       写成 `a.p.group === '霞' ? -1 : 1` 这种两值比较器没有传递性：
       两个非霞词条互相比较时，a 比 b 和 b 比 a 都返回 1，
       结果取决于引擎实现、可能把该显示的词条随机挤掉。
       所以这里每一级都用「相减」表达，最后一定有 a.i - b.i 兜底。 */
    .sort((a, b) =>
      (scopeOk(a.s, now) ? 0 : 1) - (scopeOk(b.s, now) ? 0 : 1) || /* 0. 当前时段优先 */
      b.v - a.v ||                       /* 1. 很有戏 > 有机会 */
      (a.p.group === '霞' ? 0 : 1) - (b.p.group === '霞' ? 0 : 1) || /* 2. 霞优先 */
      b.r - a.r ||                       /* 3. 越少见越靠前 */
      a.i - b.i                          /* 4. 稳定兜底 */
    )
}

function toTip(p: Phenomenon, s: TimeScope): Phototip {
  return {
    key: p.key,
    name: p.name,
    alias: p.alias,
    rarity: rarityOf(p),
    why: p.when,
    shoot: p.shoot,
    scope: s,
    window: hoursOf(p)
  }
}

/** 这个时刻最值得拍的天象（只含当前时段成立的，取前 5 条）
    now 由调用方按场景给：日出 → 'dawn'，日落 → 'lowSun'。 */
export function matchPhenomena(c: PhenoContext, now: TimeScope = 'lowSun'): Phototip[] {
  return rank(c, now)
    .filter((x) => scopeOk(x.s, now))
    .slice(0, 5)
    .map((x) => toTip(x.p, x.s))
}

/** 指定时段（day / night）当天有机会的天象，给「其它时段」那一行用。
    ⚠️ 调用方必须传入**该时段代表时刻**的上下文：白天冰晶词条要求太阳高度
       15–32°，拿日落时刻（el≈0）去判会全数落空；夜间词条同理。

    2026-11-28 之前这里只过一次粗门（高云≥25 / 低云≥35）、不跑判据，
    于是天气再变也永远输出同样两条（白天「环天顶弧 + 日晕」、夜间「银河 + 月晕」），
    幻日、46° 晕、环地平弧、夜光云、极光一辈子排不上。
    现在直接过判据，命中才提示 —— 宁可这条提示空着，也不空许诺。 */
export function matchOtherTimes(c: PhenoContext, slot: TimeScope = 'day'): Phototip[] {
  if (slot !== 'day' && slot !== 'night') return []
  const picked = PHENOMENA
    .filter((p) => scopeOf(p) === slot)
    .map((p) => ({ p, v: p.match(c), r: RARITY[p.local ?? '常见'] ?? 2 }))
    .filter((x) => x.v > 0)
    /* 命中强度优先，同强度按「越常见越靠前」—— 这是「今天去看什么」的提示，
       不是稀缺度排行榜，把「几乎不可能」的极光排在幻日前面对用户没用。 */
    .sort((a, b) => b.v - a.v || a.r - b.r || (a.p.key < b.p.key ? -1 : 1))
    .slice(0, 2)
  return picked.map((x) => toTip(x.p, slot))
}
