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
    id: 'tcdc-multiseason',
    title: 'GFS 云阈值只在 1 天、冰云样本上标定过，暖云/混合相与季节适用性未知',
    state: 'pending',
    trigger: {
      text: '累积 ≥30 天剖面缓存，或需要把云判据用于评分/统计时',
      metric: null
    },
    why:
      '阶段六-03 专项审查实测：所有"有云点"都在 −20°C 以下的冰云，暖云/混合相样本为 0；' +
      '同轮 PPV 0.58–0.69、跨轮 0.39–0.42；有效独立样本仅约 439–878。' +
      '现在这套阈值只能用于"画图区分有没有云"，不能当物理阈值或统计依据。',
    how: [
      '用 tools/xsec/review_tcdc.py 的多轮次/分相审查跑满一个季节（至少 30 天、4 个起报/天）',
      '液态/冰晶分开标定：暖云用 CLWMR、冰云用 ICMR，各自给自己的阈值与 PPV',
      '若有 CDS 账号，再与 ERA5 的 clwc/ciwc 做量级对照（台账 xsec-era5-validate）',
      '结论回写 docs/阶段六-03 §7 与 docs/阶段五-02 §3，达到"可引用"标准前继续保持经验性表述',
    ],
    doc: 'docs/阶段六-03litgeo-verify-验证报告.md §7',
    files: ['tools/xsec/review_tcdc.py']
  },
  {
    id: 'litgeo-engine',
    title: '火烧云光线几何引擎（独立解释层，不参与评分）',
    state: 'pending',
    trigger: {
      text: '阶段六-03 验证报告已提交（2026-11-01），**等主人确认后**才开工',
      metric: null
    },
    why:
      '任务书要求把「几何照明、光路消光、云体分布、最终观感」分开处理，不能混成一个分数。' +
      '现有评分不回答"什么时候烧、在天空哪儿烧、为什么翻车"，这正是几何引擎要补的。',
    how: [
      '按 docs/阶段六-01 的模块划分实现纯函数（earth/sunlight/timing/aerosol/viewing）',
      '把 docs/阶段六-03 的 51 项检查改写成正式单测（node --test 或现有 test-*.mjs 风格）',
      '全部纯函数 + 单测；不 import scoring、不写 forecast state',
      '先只做 /cross 的只读叠加图层（V1），再评估独立 0–500 km 光照图（V2）',
      '输出必须带 confidence/flags，页面明示哪些是估算',
    ],
    doc: 'docs/阶段六-01光线几何引擎-技术设计.md',
    files: []
  },
  {
    id: 'optics-lab',
    title: '大气光学实验室（22°晕/幻日/偕日弧模拟，与评分和预报隔离）',
    state: 'pending',
    trigger: {
      text: '等 litgeo-engine 落地后再启动；需先确认冰晶谱数据集许可',
      metric: null
    },
    why:
      '任务书第四节要求独立的大气光学模拟模块。资料已读完（10 篇），' +
      '关键结论：取向采样必须做球面面积元修正（旧模拟器全错），衍射要用艾里斑→高斯 σ=θ0/2.867。',
    how: [
      '先做纯几何（crystal/trace）：用 22° 晕 21.8°/21.6° 与偕日弧 120° 圆锥做单测',
      '再做取向（orientation）：复现"浮板随机冲击"实验验证 |θ| 分布不为 0 处峰值',
      '衍射层用原文 5 组核半径（5.65µm→1.677° … 21.59µm→0.439°）做单测',
      '渲染/前端最后做，且页面上固定写明模型假设与局限',
    ],
    doc: 'docs/阶段六-02大气光学实验室-技术设计.md',
    files: []
  },
  {
    id: 'cross-224-national',
    title: '/cross 全国 224 机位尚未铺开（现在只有 8 个试点）',
    state: 'open',
    trigger: {
      text: '阶段七-01 的 DEM/AOD 流程可复用（按机位 id 组织）；仍需先补 224 个机位海拔，并分批跑高程请求',
      metric: null
    },
    why:
      '任务书范围修正要求最终覆盖全国 224 机位。实测：224 机位全部没有海拔字段；' +
      '每机位 20 sections 全量约 9.3 MB，4 次/天会让仓库增长失控。' +
      '必须先做统一 tile 分组下载 + 海拔补齐 + 体量/频率实测，再全量。',
    how: [
      '用 Open-Meteo elevation（Copernicus DEM GLO-30）批量补 224 个机位海拔并标注来源精度；补不到的标记 null 并拒绝出图',
      'build_cross.py 改造成任意机位列表 + 1° tile 分组下载（同 tile 共用一次取数）',
      '全国首版按「每机位 3 时次 × 1 方位（当天日落方位）」生成 ≈1.4 MB；试点 8 机位保留 4×5',
      '先跑 14 个分区验证机位（海岸/山地/高原/盆地/岛屿/高纬），通过后再全量',
      '实测 CI 时间与 git 日增长，再决定 1 次/天还是 2 次/天',
    ],
    doc: 'docs/阶段七-00-cross重构审计与方案.md §7',
    files: ['tools/xsec/build_cross.py']
  },
  {
    id: 'cross-sun-geometry-card',
    title: '/cross 的太阳几何卡（已做）+ 摄影价值卡（未做）',
    state: 'done',
    trigger: {
      text: '2026-11-01 完成：src/lib/xsec/light.ts + 太阳与照明几何卡 + 太阳时间滑杆',
      metric: null
    },
    why:
      '已完成：受光判据、阴影边界、地面日落线位置/速度、地形视线与遮挡、AOD 透过率、' +
      '逐云带受光起止时间（52 项单测）。仍未做：把「几何受光 + 云量/厚度 + AOD」' +
      '合成一句可读的摄影价值结论（归因卡）。',
    how: [
      '已完成：src/lib/xsec/light.ts 纯函数 + docs/阶段七-01 的公式与假设表',
      '已完成：tools/xsec/test-light.mjs（52 项），接进 /cross 的「太阳与照明几何」卡',
      '待做：摄影价值卡（只说条件与归因，不产生分数、不写回 forecast）',
    ],
    doc: 'docs/阶段七-01-太阳几何与照明引擎-实现报告.md',
    files: ['src/lib/xsec/light.ts', 'tools/xsec/test-light.mjs']
  },
  {
    id: 'cross-far-field-sunpath',
    title: '/cross 只有 50 km 剖面，夕阳照明边界大多在视野外',
    state: 'open',
    trigger: {
      text: '阶段七-01 已把边界位置/速度做成数字，但边界很少落进 0–50 km 图内',
      metric: null
    },
    why:
      '照明边界常在数十到数百 km 外：以海口 2026-11-01 为例，日落后 4 分钟时地面日落线在 210 km，' +
      '0 km 处阴影上缘 3.3 km；50 km 剖面里只露出一小段。要让边界在图上"动起来"，' +
      '必须扩大采样几何或增加远场光路带。',
    how: [
      '方案 A：build_cross.py 增补 9 个采样点覆盖 0–320 km（GFS 约 11 个真实格点，反而信息更多）',
      '方案 B：主图下方加 0–400 km 的「光路带」条带（纯几何，不需要新气象数据），标注云场只到 50 km',
      '两者都要重跑 verify_cross.py 并检查缓存体积（9 采样点约 +75%）',
    ],
    doc: 'docs/阶段七-01 §5、docs/阶段七-00 §9',
    files: ['tools/xsec/build_cross.py', 'src/components/xsec/CrossSectionChart.vue']
  },
  {
    id: 'xsec-era5-validate',
    title: '大气剖面的云阈值只用 GFS 自己的云分数标定过，还没跟 ERA5 历史量级对照',
    state: 'pending',
    trigger: {
      text: '拿到 CDS 账号，或累积 ≥30 天 GFS 剖面缓存',
      metric: null
    },
    why:
      '现在的阈值（1e-6 / 1e-5 / 1e-4 kg/kg）是用 GFS 原生云分数 TCDC 标定的，' +
      '属于「模式内部自洽」——能保证画出来的云和模式自己的云方案一致，' +
      '但不能证明 GFS 的云水量级本身接近真实。任务书 §4.5 要求正式上线前与 ERA5 同类变量做历史量级对照。',
    how: [
      '在 CDS 注册（免费），取 ERA5 pressure-levels 的 clwc/ciwc/cf，海南窗口 + 近 3 年 11 月',
      '只比较「分位数与量级」，不要直接拟合阈值：两套模式的水物质定义与分辨率都不同',
      '若量级差异 > 一个量级，先查单位（kg/kg vs g/kg）与层定义，再考虑调整 displayBands',
      '结论写进 docs/阶段五-02 的 §3，并把 quality.json 的 thresholds 换成新依据',
    ],
    doc: 'docs/阶段五-02大气剖面-GFS数据管线与验证.md §3、§11',
    files: ['tools/xsec/build_cross.py', 'data/cross/quality.json']
  },
  {
    id: 'xsec-expand-spots',
    title: '大气剖面目前只做 8 个代表机位，要不要扩到全部 224 个',
    state: 'open',
    trigger: {
      text: '看实际使用与 CI 预算再决定（当前单轮 341 KB / 15 s，扩到 28 个海南机位约 1.2 MB）',
      metric: null
    },
    why:
      '任务书 §7.3 明确要求先做 8 个代表机位，跑通端到端再评估。' +
      '现在数据管线已验证，扩量的唯一风险是仓库体积与 CI 时间，属于产品决策不是技术障碍。',
    how: [
      '先扩到海南 28 个机位（同省数据复用一次下载，下载量不变，只多写文件）',
      '跑 tools/measure-cache-git.mjs 的同款思路量剖面缓存的每日增长，确认可接受再继续',
      '跨省扩量要先解决「一次只下载一个 2.5° 窗口」的成本问题，别把全国铺开',
    ],
    doc: 'docs/阶段五-02大气剖面-GFS数据管线与验证.md §9、§11',
    files: ['tools/xsec/build_cross.py']
  },
  {
    id: 'a-level-coverage',
    title: 'A 级样本「数量够了但不用上用场」：110 个样本里只有 1 个分数 ≥48',
    state: 'open',
    trigger: {
      text: '每周复查一次：A 级可判定 ≥30 且其中 ≥48 分的样本 ≥20 个，才够判断误报率',
      metric: null
    },
    why:
      '2026-10-25~10-31 攒了 110 个 A 级样本，误报率 0%，但中位数 0 分、只有 1 个 ≥48 分 —— ' +
      '绝大多数是「算法报 0、实况也确实阴天」，这种对是白给的。' +
      '同期全国真正 ≥48 分的机位-天有 22 个，其中只有 7 个在机场观测点 45km 内，' +
      '最好的拍霞机位（儋州/昌江/东方）离机场 70–100km，A 级根本覆盖不到。',
    how: [
      '不要用 110 这个数字下结论，要看「≥48 分的样本数」',
      'node tools/check-accuracy.mjs --only-a 里筛 score>=48 的条目手动数',
      '如果真的长期凑不够：才考虑 B 级加权，或接受「A 级只能验证偏乐观方向」',
    ],
    doc: '交接文档 26.7',
    files: ['tools/check-accuracy.mjs']
  },
  {
    id: 'data-gap-watch',
    title: '数据链路每天的缺口（2026-10-28 丢了一天 A 级样本，7 天后才发现；10-31 又丢一次）',
    state: 'open',
    trigger: {
      text: '已修三层：快照强制校验「目标日期==北京时间今天」、零点没写出来就 exit 1、每日缺口自检',
      metric: null
    },
    why:
      '两次事故，同一个病根：静默失败。' +
      '① 10-28：缓存停在 UTC 10-27 19:42，算出的目标日期是 10-28、文件名也是 10-28，' +
      '用的却是前一天晚上的数据 —— 快照「看起来有」但是错的。' +
      '② 10-31：GitHub Actions 那天把北京 09:05 和 15:05 两次缓存任务给漏跑了，' +
      '缓存到 20:00 已过期 17 小时 → 回退实时请求 → 离线桩下算不出行 → 快照 0 个文件，' +
      '但脚本当时 exit 0，整条链路看起来是绿的。' +
      '这也是缓存频率从 4 次/天提到 8 次/天的真正理由：Actions 的 cron 是尽力而为，会漏。',
    how: [
      '已加 tools/check-gaps.mjs，每天在 Action 里跑，缺口会写进 run summary',
      '已让 snapshot-forecast.mjs 在「一个省都没写出来」时 exit 1 + ::error::',
      '补跑支持 --date YYYY-MM-DD，但会拒绝用在日落之后生成的缓存（那是事后数据）',
      '若仍出现缺口：node tools/check-gaps.mjs 看是哪一类，再查那次 Action 日志',
      '历史缺口不可补：10-28、10-31 都已永久丢失，别用 14 小时提前量的缓存硬凑',
    ],
    doc: '交接文档 16.2 / 26.7',
    files: ['tools/check-gaps.mjs', 'tools/snapshot-forecast.mjs', '.github/workflows/metar-obs.yml']
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

  /* ★ 最后一句是留给「下一个 AI 会话」的：
     新对话不会自动继承记忆，所以让这条命令自己把该问的话说出来。 */
  console.log('')
  console.log('===== 如果你是另一个对话里的 AI，请先问一句 =====')
  console.log(`  仓库里有 ${ITEMS.length} 条「等数据到位再决定」的挂起事项，其中 ${dueCount} 条已到期。`)
  console.log('  请先问主人：')
  console.log(`    「有 ${ITEMS.length} 条挂起事项（${dueCount} 条已到期），现在要处理哪条，还是先做别的？」`)
  console.log('  别在没问过的情况下动手改预报相关的代码。')
  console.log('  依据：AGENTS.md 与交接文档 26.6。')
}

if (process.argv[1]?.endsWith('todo.mjs')) {
  main().catch((e) => { console.error('失败：', e); process.exit(1) })
}
