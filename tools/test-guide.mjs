/**
 * 「怎么看这张图」说明完整性测试。
 *
 * 目的：说明面板是给摄影爱好者的，最怕按钮改了名字、解释没跟上，
 * 变成解释了不存在的按钮。这里做静态对照：
 *   1. guide.ts 里每一项字段都齐全、不空、不重复；
 *   2. 页面工具条里出现的每个分组名，说明里都有；反过来说明里不留幽灵分组；
 *   3. 视图/数据源/高度轴/高度档位这些写死在模板里的按钮，逐个对上；
 *   4. 免责口径不能被文案冲掉：禁止出现「概率」「实测」「精确」这类会误导的词。
 *
 * 纯静态读取源码文本，不跑浏览器、不需要构建产物。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const guideSrc = readFileSync(resolve(root, 'src/lib/xsec/guide.ts'), 'utf8')
const pageSrc = readFileSync(resolve(root, 'src/pages/CrossSectionPage.vue'), 'utf8')
const cssSrc = readFileSync(resolve(root, 'src/styles/pages/cross.css'), 'utf8')

let pass = 0
const fails = []
function check(name, ok, detail) {
  if (ok) {
    pass++
  } else {
    fails.push(detail ? `${name} — ${detail}` : name)
  }
}

/* 1. 字段完整性：在 guide.ts 文本里抠出每个 name/what/use ----------------- */
const names = [...guideSrc.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1])
const whats = [...guideSrc.matchAll(/what:\s*\n?\s*'([^']*)'/g)].map((m) => m[1])
const uses = [...guideSrc.matchAll(/use:\s*\n?\s*'([^']*)'/g)].map((m) => m[1])

check('有说明条目', names.length > 0, `找到 ${names.length} 条`)
check('每一条都有 what', whats.length === names.length, `name ${names.length} / what ${whats.length}`)
check('每一条都有 use', uses.length === names.length, `name ${names.length} / use ${uses.length}`)
check('没有空 what', whats.every((s) => s.trim().length > 4), '存在过短的 what')
check('没有空 use', uses.every((s) => s.trim().length > 4), '存在过短的 use')

/* 2. 分组对照：页面工具条里的 .xsec-group-label 文案 ------------------------- */
/** 「全国机位」是分区标题（.xsec-national-head 里复用同一个 class），不是工具条分组，跳过 */
const NON_TOOLBAR_GROUPS = ['全国机位']
const groupLabels = [...pageSrc.matchAll(/<span class="xsec-group-label">([^<]+)<\/span>/g)]
  .map((m) => m[1].trim())
  .filter((g) => !NON_TOOLBAR_GROUPS.includes(g))
check('页面有工具条分组', groupLabels.length >= 8, `找到 ${groupLabels.length} 个分组`)

const guideTitles = [...guideSrc.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1])
for (const g of groupLabels) {
  check(`分组「${g}」有说明`, guideTitles.includes(g), '说明面板里找不到这个分组')
}

/* 3. 写死在模板里的按钮逐个对上 ------------------------------------------ */
const mustCover = [
  // 数据源
  'GFS 模式云水',
  'Open-Meteo 估算',
  // 视图
  '综合',
  '云水',
  '云冰',
  '总云量',
  // 高度轴
  '海拔',
  '离地',
  // 图层
  '湿度等值线',
  '温度等值线',
  '风矢量',
  '垂直速度',
  '降水',
  // 其他
  '全屏'
]
for (const label of mustCover) {
  const inPage = pageSrc.includes(label)
  const inGuide = names.some((n) => n.includes(label)) || guideSrc.includes(label)
  check(`按钮「${label}」在页面里存在`, inPage, '模板里找不到该按钮，说明可能已过期')
  check(`按钮「${label}」有解释`, inGuide, '说明里没覆盖')
}

/* 高度档位：0–8 / 0–16 / 0–22 km 与时刻按钮共用一个名字说明 --------------- */
check('高度档位有解释', /0–8 km[^\n]*0–16 km[^\n]*0–22 km/.test(guideSrc), '说明里缺少高度档位')
check('方位档位有解释', /240°[^\n]*255°[^\n]*265°[^\n]*280°[^\n]*295°/.test(guideSrc), '说明里缺少方位档位')
check('太阳时间滑杆有解释', guideSrc.includes('日落后 / 前 N 分'), '说明里缺少太阳时间')
check('潜在云区有解释', guideSrc.includes('潜在云区 RH≥90%'), '说明里缺少潜在云区')

/* 4. 口径红线：说明文案里不许出现会误导摄影师的词 ------------------------- */
const banned = [
  { re: /降水概率/, why: '降水数据是降水率，不是概率' },
  { re: /卫星实测|雷达实测/, why: '云场是模式预报，不是实测（只能出现在否定句里）' }
]
for (const b of banned) {
  // 允许出现在「不是…」的否定语境里；这里只禁止正面断言
  const hits = [...guideSrc.matchAll(new RegExp(b.re.source, 'g'))]
  const bad = hits.filter((h) => {
    const ctx = guideSrc.slice(Math.max(0, h.index - 20), h.index)
    return !/(不是|并非|而非|不能)/.test(ctx)
  })
  check(`口径红线：${b.why}`, bad.length === 0, `发现 ${bad.length} 处正面断言`)
}

/* 5. 必须在场的免责说明 --------------------------------------------------- */
for (const kw of ['不是雷达和卫星看到的真实云', '不是降水概率', '只算光几何']) {
  check(`保留关键提醒「${kw.slice(0, 12)}…」`, guideSrc.includes(kw), '这条提醒被删掉了')
}

/* 6. 样式：新增的类都有定义 ---------------------------------------------- */
for (const cls of [
  '.xsec-guide', '.xsec-guide-toggle', '.xsec-guide-body',
  '.xsec-guide-quick', '.xsec-guide-title', '.xsec-guide-dl',
  '.xsec-guide-use', '.xsec-guide-caution', '.xsec-guide-meta'
]) {
  check(`样式 ${cls} 已定义`, cssSrc.includes(cls), 'cross.css 里找不到')
}

/* 7. 页面确实引用了说明数据 ---------------------------------------------- */
check('页面引入 guide', pageSrc.includes("from '@/lib/xsec/guide'"), '没 import')
for (const sym of ['TOOLBAR_GUIDE', 'CHART_GUIDE', 'QUICK_STEPS']) {
  check(`页面渲染了 ${sym}`, new RegExp(`v-for="[^"]*${sym}"`).test(pageSrc), '模板里没用到')
}
check('说明面板默认收起', /const showGuide = ref\(false\)/.test(pageSrc), '默认应是收起')
check('说明面板可展开/收起', pageSrc.includes('showGuide = !showGuide'), '缺少切换逻辑')

/* 输出 ------------------------------------------------------------------- */
if (fails.length) {
  console.error(`\n✗ 说明完整性：${pass} 通过，${fails.length} 失败`)
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`✓ 说明完整性：${pass}/${pass} 全部通过`)
