/**
 * 成员名录
 * group: "core" = 小组成员；"community" = 交流群成员
 * titles: 身份头衔，比如 ["风光", "星野"]
 * 作品按 photos.ts 的 a 字段自动匹配：photos.ts 里写 a: "張源湖"，这里就会显示
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
  { id: 'zhangyuanhu', name: '張源湖', group: 'core', titles: [] },
  { id: 'kelei', name: '柯雷', group: 'core', titles: [] },
  { id: 'shixucaigouya', name: '是徐菜狗鸭', group: 'core', titles: [] },
  { id: 'erictian', name: 'ERIC TIAN', group: 'core', titles: [] },
  { id: 'senlin', name: '森林 Cyber-traveller', group: 'core', titles: [] },
  { id: 'xiaochen', name: '蕭晨 WaterGhost', group: 'core', titles: [] },
  { id: 'leihai', name: '酹海', group: 'core', titles: [] },
  { id: 'echoism', name: 'ECHOISM', group: 'core', titles: [] },
  { id: 'mak', name: 'mak', group: 'core', titles: [] },
  { id: 'baoxue', name: '暴雪踏墨行', group: 'core', titles: [] },
  { id: 'dynamiczzr', name: 'DynamicZZR', group: 'core', titles: [] },
  { id: 'raven', name: 'Raven', group: 'core', titles: [] },
  { id: 'y1', name: 'y-1', group: 'core', titles: [] },
  { id: 'yms', name: 'yms', group: 'core', titles: [] }
]
