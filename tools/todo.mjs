/**
 * ============================================================
 *   待办台账（单一事实来源）
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   交接文档有 1400 多行，写着「等数据到位再决定」的事项一旦沉到某一节里，
 *   下次就记不起来了。这里把**所有挂起的决定**集中成一份机器可读的清单，
 *   每条都写清楚「为什么要等」「等到什么算到位」「到时候怎么做」。
 *
 * 怎么用：
 *   node tools/todo.mjs              # 列出还没到期的
 *   node tools/todo.mjs --all        # 连还没触发条件的也列出来
 *   node tools/todo.mjs --due        # 只看「现在就该处理」的（会读 data/obs 判断）
 *
 * 谁在读它：
 *   · 交接文档 26.3 / 26.5 会引用这里的 id
 *   · tools/accuracy-trend.mjs 到条件满足时会点名
 *   · 人：搜 "挂起决定" 或看这个文件
 *
 * 加一条的办法：在 ITEMS 里加一个对象，把 trigger/why/how 三段都写满。
 * 只写 TODO 不算——必须有「怎么判断条件到了」的可执行描述。
 * ============================================================
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()


/**
 * @typedef {Object} TodoItem
 * @property {string} id                 稳定 id，文档里引用它
 * @property {string} title
 * @property {'pending'|'open'} state    pending = 等条件；open = 现在就能做但没做
 * @property {{ text: string, metric: string|null }} trigger  触发条件（metric 为机器判定名）
 * @property {string} why                为什么当时没做
 * @property {string[]} how              到时候怎么做，按顺序
 * @property {string} [doc]              文档里的位置
 * @property {string[]} [files]          相关代码
 */

/** @type {TodoItem[]} */

export const ITEMS = [
  /* ---------- 等数据 ---------- */
  {
    id: 'profile-data-source',
    title: '云种剖面要不要改用多模式平均（现状：剖面看 ECMWF 单模式，计分看三家平均）',
    state: 'pending',
    trigger: {
      text: 'A 级样本 ≥30 天，或 A 级报 ::warning::（误报率≥25% 且样本≥10），或 A 级误报集中在「高云多但没烧」',
      metric: 'aFalseAlarmWarning'
    },
    why:
      '换了等于换数据源。哪套更准正是 A 级校验要回答的问题，没样本就改是「没有证据的改动」——和第 18 章否定 GPT fAod 同一个理由。',
    how: [
      '先量不改：用 data/obs 的快照统计分歧大的城市里，实况更接近哪一套（快照存了 high/mid/low 与逐层原始值）',
      '再写候选实现：参考 candidates/continuous.ts 的做法，独立模块 + tools/compare-candidates.mjs 逐机位对照',
      '只认 A 级结论；B 级（45km 就近代表）只能看趋势，不能拿来定数据源',
      '动之前跑 test-boundaries / test-physics，并记下 diff-scores 的平均变化；超过 ±1 分要先解释清楚',
    ],
    doc: '交接文档 26.5',
    files: ['src/lib/forecast/api.ts', 'src/lib/forecast/clouds.ts']
  },
  {
    id: 'pchip-continuous',
    title: 'candidates/continuous.ts（PCHIP 连续化）接入生产',
    state: 'pending',
    trigger: {
      text: 'A 级样本 ≥30 天（需要干净的对照基准才能做 A/B）',
      metric: 'aSamples30d'
    },
    why: '没有标签就没有「更准」可言，只能做 A/B。A 级样本不够时，改完无法判断变好还是变坏。',
    how: [
      '跑 node tools/compare-candidates.mjs 看排序变化率',
      '与基线并列展示一段时间，确认没有系统性偏移',
      '再由人决定是否替换 scoring.ts 里的 fAod / fWet',
    ],
    doc: '交接文档 26.3',
    files: ['src/lib/forecast/candidates/continuous.ts']
  },
  {
    id: 'satellite-ctt',
    title: '卫星云顶温度（CTT）作为独立数据源',
    state: 'pending',
    trigger: {
      text: 'A 级显示「预报低、实际烧」为主（即漏报），才值得为它花那份功夫',
      metric: null
    },
    why:
      '四个源都试过：NSMC 要登录申请、RainViewer 红外只覆盖欧非、AWS Himawari-9 能下但卡在 JMA 私有二进制格式，34 省每天跑会爆 Action 配额。',
    how: [
      '先确认触发条件确实是「漏报为主」而不是「误报为主」',
      '若能拿到 L2 云顶温度产品，优先做「高云是否真的存在」这一件事，不要一上来就重算分数',
    ],
    doc: '交接文档 22.4',
    files: []
  },
  {
    id: 'metar-west-hainan',
    title: '海南西岸没有可作为真值的观测（儋州/昌江/东方/乐东 离机场 70–100 km）',
    state: 'open',
    trigger: {
      text: '没有自动触发条件——要么接受现状，要么有人愿意在实地放观测点',
      metric: null
    },
    why: '地形决定，补机位补不了。A 级样本永远只覆盖机场周边，而最好的拍霞机位在远处。',
    how: [
      '现状做法：A 级结论用于「机场周边验证偏差方向」，再按地理位置推广到全岛',
      '不要为了凑样本把 B 级（45km 就近代表）当 A 级用',
    ],
    doc: '交接文档 25.6',
    files: []
  },

  /* ---------- 现在就能做，只是没排上 ---------- */
  {
    id: 'feedback-backend',
    title: '反馈表单 POST / → 405（缺后端）',
    state: 'open',
    trigger: { text: '需要用户决定用 Workers KV / D1 / Supabase 哪一个', metric: null },
    why: '三选一是产品决策，不是技术问题。',
    how: ['选定后：加一个 /api/feedback 的 Worker 路由，写入 KV 或 D1', '前端 FeedbackModal 的提交地址改成该路由'],
    doc: '交接文档 26.3',
    files: ['src/components/forecast/FeedbackModal.vue']
  },
  {
    id: 'audit-p1-p2',
    title: '审计遗留：P1-3 结构化 qualityStatus / P1-2 拆事件分与出片机会 / P2-1 云属降级为「不明」/ P2-3 接 canvasFactor',
    state: 'pending',
    trigger: {
      text: '等 A 级样本指出具体问题再动，不要凭猜测改',
      metric: 'aSamples30d'
    },
    why: '这几项都会改变用户看到的分数结构，没有实测依据就动手是猜测。',
    how: ['先看 A 级误报明细集中在哪个维度，只做能对上问题的那一项'],
    doc: '交接文档 26.3',
    files: ['src/lib/forecast/scoring.ts', 'src/lib/forecast/interpret.ts']
  },
  {
    id: 'phenomena-count',
    title: '天象词库显示「60 条」但实际 58 条；且有 2 组重复条目（彩虹/双彩虹、荚状云/荚状云·山帽云）',
    state: 'open',
    trigger: { text: '现在就能修，只需决定「补到 60 还是改成 58」以及「重复的合不合并」', metric: null },
    why: '是内容决策，需要人来定口径。',
    how: [
      '二选一：补 2 条新词条凑到 60，或把 ForecastPage 里的硬编码改成 PHENOMENA.length',
      '重复条目：合并 alias 后从 PHENOMENA 删除多余项，避免同一片天命中两条题材卡',
    ],
    doc: '交接文档 26.3',
    files: ['src/data/forecast/phenomena.ts', 'src/pages/ForecastPage.vue']
  },
]

/* ---------- 机器判定：读 data/obs 看条件到了没 ---------- */

async function readJson(file) {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function daysBetween(a, b) {
  const t1 = Date.parse(a)
  const t2 = Date.parse(b)
  if (!isFinite(t1) || !isFinite(t2)) return 0
  return Math.abs(t2 - t1) / 86400000
}

/** 返回 { due: boolean, detail: string } */
async function evaluate(item) {
  if (!item.trigger.metric) return { due: null, detail: '只能人工判断' }

  const latest = await readJson(path.join(ROOT, 'data', 'obs', 'accuracy-latest.json'))
  const A = latest?.grades?.A
  const days = Array.isArray(latest?.days) ? latest.days : []

  if (item.trigger.metric === 'aSamples30d') {
    const n = days.length
    return {
      due: n >= 30,
      detail: n ? `A 级覆盖 ${n} 天（${days[0]} ~ ${days[days.length - 1]}），目标 30 天` : '还没有 A 级样本'
    }
  }

  if (item.trigger.metric === 'aFalseAlarmWarning') {
    const judged = A?.judged ?? 0
    const rate = A?.falseAlarmRate
    const hit = judged >= 10 && typeof rate === 'number' && rate >= 25
    return {
      due: hit,
      detail: judged
        ? `A 级可判定 ${judged} 个、误报率 ${rate}%（触发线：样本 ≥10 且 ≥25%）`
        : '还没有 A 级可判定样本'
    }
  }

  return { due: null, detail: '未知判定方式' }
}

/* ---------- CLI ---------- */

async function main() {
  const args = process.argv.slice(2)
  const showAll = args.includes('--all')
  const onlyDue = args.includes('--due')

  console.log('===== 挂起决定 / 待办台账 =====\n')

  let dueCount = 0
  for (const item of ITEMS) {
    const ev = await evaluate(item)
    const isDue = ev.due === true
    if (isDue) dueCount++

    if (onlyDue && !isDue) continue
    if (!showAll && !onlyDue && item.state === 'pending' && !isDue) continue

    const flag = isDue ? '🔔 到期' : item.state === 'open' ? '○ 可做' : '⏳ 等待'
    console.log(`${flag}  [${item.id}] ${item.title}`)
    console.log(`        触发：${item.trigger.text}`)
    console.log(`        判定：${ev.detail}${ev.due === null ? '（无自动判定）' : ev.due ? ' → ✅ 条件已到' : ''}`)
    if (isDue || showAll) {
      console.log(`        原因：${item.why}`)
      console.log('        步骤：')
      for (const h of item.how) console.log('          · ' + h)
      if (item.doc) console.log(`        详见：${item.doc}`)
      if (item.files?.length) console.log(`        代码：${item.files.join('、')}`)
    }
    console.log('')
  }

  if (!showAll && !onlyDue) {
    console.log('（只列到期项。加 --all 看全部，加 --due 只看到期项）')
  }
  console.log(`到期 ${dueCount} 项 / 共 ${ITEMS.length} 项`)
}

if (process.argv[1]?.endsWith('todo.mjs')) {
  main().catch((e) => { console.error('失败：', e); process.exit(1) })
}
