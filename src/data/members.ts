/**
 * 成员名录
 * group: "core" = 小组成员；"community" = 交流群成员
 * titles: 身份头衔，比如 ["风光", "星野"]
 * 作品按 photos.ts 的 a 字段自动匹配：photos.ts 里写 a: "张源潮"，这里就会显示
 *
 * 姓名与头衔以公众号原文为准（2026-11-28 核对）：
 * 《未来，我们于此刻用影像开启》https://mp.weixin.qq.com/s?__biz=MzYyNDA3OTAxNw==&mid=2247483992
 * 原文写「张源潮」「髅海（余承贤）」「萧晨WaterGhost」「Dynamic·ZZR」「Y-1」，
 * 与此前站内的「張源湖」「酹海」「蕭晨 WaterGhost」「DynamicZZR」「y-1」不符，已按原文改。
 * 原文对 6 位写了完整履历，这里压缩成短标签（卡片标签位窄，整句会占满整行）。
 */

export type MemberGroup = 'core' | 'community'

export interface Member {
  id: string
  name: string
  group: MemberGroup
  titles: string[]
}

export const MEMBER_GROUPS: Record<MemberGroup, string> = {
  core: '小组成员',
  community: '交流群成员'
}

export const MEMBERS: readonly Member[] = [
  { id: 'shutiaoqiepian', name: '薯条切片', group: 'core', titles: ['首领'] },
  { id: 'zhangyuanhu', name: '张源潮', group: 'core', titles: [] },
  {
    id: 'kelei',
    name: '柯雷',
    group: 'core',
    titles: ['海南省摄协会员', '海南高校摄影联盟主理人', '视觉中国 2023 Best10']
  },
  {
    id: 'shixucaigouya',
    name: '是徐菜狗鸭',
    group: 'core',
    titles: ['中国国家地理供稿人', '图虫百大摄影师', '2024 IPA 建筑类银奖']
  },
  {
    id: 'erictian',
    name: 'ERIC TIAN',
    group: 'core',
    titles: ['中国爬楼联盟成员', '500px 北京风光联盟首领', '佳能合作摄影师']
  },
  {
    id: 'senlin',
    name: '森林 Cyber-traveller',
    group: 'core',
    titles: ['12000z62 主理人', '寰宇追光部落首领']
  },
  { id: 'xiaochen', name: '萧晨WaterGhost', group: 'core', titles: ['重庆·雾核 FOCUS 首领'] },
  {
    id: 'leihai',
    name: '髅海',
    group: 'core',
    titles: ['中国爬楼联盟核心成员', '上海爬楼联盟成员']
  },
  { id: 'echoism', name: 'ECHOISM', group: 'core', titles: [] },
  { id: 'mak', name: 'mak', group: 'core', titles: [] },
  { id: 'baoxue', name: '暴雪踏墨行', group: 'core', titles: ['审核员'] },
  { id: 'duo', name: 'DUO', group: 'core', titles: ['审核员'] },
  { id: 'dynamiczzr', name: 'Dynamic·ZZR', group: 'core', titles: [] },
  { id: 'raven', name: 'Raven', group: 'core', titles: [] },
  { id: 'y1', name: 'Y-1', group: 'core', titles: [] },
  { id: 'yms', name: 'yms', group: 'core', titles: [] }
]
