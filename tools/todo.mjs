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
  /* ---------- 六档与区间写法（§39） ---------- */
  {
    id: 'grade-ladder-visible',
    title: '六档（不烧…世纪大烧）在页面上没有入口：用户看不到分数线，也看不到最高档长什么样',
    state: 'open',
    trigger: {
      text: '随时可做，但会占首屏高度 —— 2026-11-05 刚因为「上半部分信息太密」删掉过一条六档色尺，加回前先问用户',
      metric: null
    },
    why:
      '2026-11-06 把最高档改名为「世纪大烧」（§39），但 Legend.vue 目前没有任何地方引用，' +
      '决策卡里的六档色尺也在 2026-11-05 减负时删掉了。结果是：用户只能在排行表里看到' +
      '「微烧 / 小烧 / 中烧 / 大烧」这几个名字，既不知道分数线，也从来没人见过「世纪大烧」。' +
      '而且今日缓存 896 条里最高 52 分、9 天历史快照 1961 条里最高 91 分 —— 后三档在真实数据里几乎进不去。',
    how: [
      '方案 A（最省）：在「怎么算的」折叠面板里加一行六档表，不占首屏',
      '方案 B：排行表表头「等级」加一个悬停图例（桌面 hover / 手机点击展开）',
      '方案 C：什么都不加，只在「世纪大烧」真的出现时才显眼 —— 前提是接受用户看不见分档',
      '不论选哪个，Legend.vue 已经改成从 LEVELS 自动生成，直接复用即可'
    ],
    doc: '交接文档 39.6',
    files: ['src/components/forecast/Legend.vue', 'src/components/forecast/DecisionHero.vue', 'docs/handoff/交接文档.md']
  },
  {
    id: 'century-tier-threshold',
    title: '「世纪大烧」的分数线定在 92 分（沿用旧「火烧云」），改上限到 100 后是否该提到 95',
    state: 'pending',
    trigger: {
      text: '等真实数据里出现 ≥92 分的最终分（9 天 1961 条快照里最高 91 分，还差 1 分）',
      metric: null
    },
    why:
      '满分从 96 提到 100 之后，92–100 这段有 9 分宽，但「世纪大烧」的门槛仍沿用旧档的 92 分。' +
      '这次刻意**没有**动车线，因为移动分界线会让历史档位不可比（§39.1）。' +
      '如果以后觉得「92 就算世纪大烧太松」，可以提到 95，代价是 92–94 那一段降级成大烧 —— ' +
      '属于「更保守」的方向，但会改历史可比性，得等有真实高分样本后再决定。',
    how: [
      '先看真实数据里最终分能不能到 92 以上（tools/grade-dist.mjs 能看到当前分布）',
      '真要改：改 LEVELS[0].min，然后重跑 node tools/grade-dist.mjs --base=<改前存的那份> 看等级翻转几条',
      '同时要重跑 node tools/test-boundaries.mjs（六档映射与区间半径的用例会一起变）'
    ],
    doc: '交接文档 39.2 / 39.6',
    files: ['src/data/forecast/levels.ts', 'tools/grade-dist.mjs', 'tools/test-boundaries.mjs']
  },
  /* ---------- 中云画布（§38） ---------- */
  {
    id: 'midcloud-calibrate',
    title: '中云画布的折扣 α（0.6）与湿度阈值（92/85/76/66）只是经验值，没有观测标定过',
    state: 'open',
    trigger: {
      text: '现在就能开始攒标签（回填表加一项即可）；攒到 30–50 个「中云大烧 / 中云没烧」的配对样本后回头重标',
      metric: null
    },
    why:
      '2026-11-06 上线的中云补画布（§38）解决了「高云 0% 时整条分数归零、中云再多也救不回来」的漏报，' +
      '但它的三个参数都是推理出来的，没有一个来自观测：' +
      '① α=0.6（中云折算成画布的折扣，由 tools/ab-midcloud.mjs 在「全站平均上浮 < 1 分」的硬约束下反推）；' +
      '② 700/600/500 hPa 湿度阈值 92/85/76/66 拿来做「透光 / 蔽光」的代理（气象上是标准替代做法，但没有本地验证）；' +
      '③ 云底照亮窗口只折算成置信度，没有真正参与「那一刻有没有光」的判断。' +
      '没有观测数据之前，这三条只能是「保守估计」，不能说成准确率。',
    how: [
      '回填表（FeedbackModal / feedback.ts）加一项：这次中云有没有烧（大烧 / 小烧 / 只是灰的 / 没有中云）',
      '同时存下当时的 midLift、云种标签、湿度、窗口分钟数（现在每天都会算，只是没存进快照）',
      '攒够 30–50 个样本后：按云种分桶看「有 lift 但实际没烧」的比例，先调 α 再调湿度阈值',
      '每调一次必须重跑 node tools/ab-midcloud.mjs，确认「平均上浮 < 1 分、只增不减」两条仍成立',
      '⚠️ 在标定完成前，界面上的措辞只能说「透光 n%，已计入评分」，不能说「准确率」'
    ],
    doc: '交接文档 38.9',
    files: [
      'src/lib/forecast/midcloud.ts', 'src/lib/forecast/baselit.ts',
      'tools/ab-midcloud.mjs', 'src/components/forecast/FeedbackModal.vue'
    ]
  },
  {
    id: 'midcloud-window-to-hourly',
    title: '云底照亮窗口（4–11 分钟）比模式时间分辨率（1 小时）细得多，现在只当置信度用',
    state: 'pending',
    trigger: {
      text: '等出现「窗口很窄、模式说能烧、实际没烧」的成串误报，或有 15 分钟级数据源时',
      metric: null
    },
    why:
      '现在对每个时次只算一个逐小时分数，而「云底被从下方照亮」这件事本身只持续 4–11 分钟' +
      '（3 km 处 θ=1.76°，太阳下沉约 0.25°/分）。所以窗口没法真正去卡每个小时 —— ' +
      '窗口内三小时没有一小时落在其中。现在只能把它折算成置信度（窗口越窄补得越少），' +
      '方向是保守的，但没有把「时刻」变成真正的判据。',
    how: [
      '先看回填数据里有没有「分数说得过去、实际白跑」集中在窄窗口时段',
      '若有：把逐小时分数插值到事件时刻（含云量的时间插值），再判窗口内的受光程度',
      '注意这会让全站分数整体位移，必须按硬约束 2 先出 A 级证据再动',
      '或在 /cross 剖面页做「光照边界扫过云层」的只读动画（那边已有 sunInPlane / terminatorKm）'
    ],
    doc: '交接文档 38.4 / 38.8',
    files: ['src/lib/forecast/baselit.ts', 'src/lib/xsec/light.ts']
  },

  /* ---------- 雾（§36） ---------- */
  {
    id: 'fog-feedback-label',
    title: '回填表加「今天有没有起雾」，这是通往「真·起雾概率」的唯一入口',
    state: 'open',
    trigger: {
      text: '现在就能做，不需要等数据（只是没人做）。做完后累计样本 1–2 个雾季（约 2027–2028）可标定',
      metric: null
    },
    why:
      '现在的雾百分比是「5 条判据满足几条」的除法，不是概率 —— 因为我们一个雾观测都没有。' +
      '要变成真概率，必须有「当时判断 vs 实际结果」的配对样本。' +
      '站点已经有「拍完回填」的表单，只要加一个「有没有起雾」的勾选，就能开始攒标签。' +
      '这是唯一不需要额外买数据、不需要装摄像头的路子（§36.11）。',
    how: [
      '在拍完回填表单里加一项：今天有没有遇到雾（没雾 / 薄雾 / 浓雾遮阳 / 浓雾能见度极低）',
      '回填数据里同时存下当时的 5 条判据结果（现在每天都会算，只是没存）',
      '攒够 30–50 个「有雾」样本后，用逻辑回归做第一次校准，出可靠性图',
      '⚠️ 校准前界面永远叫「环境符合度」，不能叫概率（text-lint 已经在管这条）'
    ],
    doc: '交接文档 36.11；调研报告 docs/handoff/topics/平流雾调研-海南.md §7',
    files: ['src/components/forecast/FeedbackModal.vue', 'src/lib/forecast/feedback.ts']
  },
  {
    id: 'fog-radiation-type',
    title: '辐射雾单独一套判据（现在的雾卡片只判了平流雾）',
    state: 'pending',
    trigger: {
      text: '等平流雾卡片跑一段时间、看用户反馈有没有「明明是晨雾却说冷面不满足」的困惑',
      metric: null
    },
    why:
      '现在的 5 条判据要求「露点 > 海温」，这是平流雾的必要条件。' +
      '但内陆/山区/河谷的晨雾是辐射雾，靠夜间辐射冷却，**根本不需要冷海面**，' +
      '所以现在内陆机位会一直显示「该点不是海面 / 冷面条件不适用」，对那种雾没有判断力。' +
      '机制不同，判据要另写（T−Td、弱风 <3 m/s、晴朗少云、夜间时长、逆温代理）。' +
      '先不写是因为怕两套判据同时出现把界面搞复杂，先看平流雾这条跑得怎么样。',
    how: [
      '先观察：内陆机位（五指山、白沙九架岭这类）用户有没有反馈「雾没提示出来」',
      '若要做：新增 radiationFog 判据函数，判据换成 弱风 + 近饱和 + 少云 + 清晨，不需要 SST',
      '两套判据按机位类型分流：沿海算平流雾，内陆算辐射雾，都算的话两条都显示但标清区别',
      '⚠️ 视觉上必须区分开 —— 摄影圈的「云海」（辐射雾/层积云）和「海雾」不是一回事（调研报告 §5.3）'
    ],
    doc: '调研报告 docs/handoff/topics/平流雾调研-海南.md §7 第 3 条；交接文档 36.11',
    files: ['src/lib/forecast/fog.ts', 'src/components/forecast/FogCard.vue']
  },

  /* ---------- 仓库体积（长期，§35） ---------- */
  {
    id: 'repo-size',
    title: 'Git 仓库体积按 1.61 MB/天增长，到 1 GB 约 21 个月，要分级做预案',
    state: 'pending',
    trigger: {
      text: 'GitHub 报告的仓库体积 > 300 MB（现在 49.5 MB），或克隆超过 60 秒',
      metric: 'repoSize'
    },
    why:
      '不是「现在就疼」的问题：49.5 MB 且只涨 1.61 MB/天，21 个月内不会撞 1 GB。' +
      '但 Git 删不掉历史（git rm 只再存一份「文件不存在」），真要缩必须重写全部哈希（§33.3），' +
      '所以必须提前降速，不能等到撞了才动。先做最便宜的 A 级措施即可。',
    how: [
      '先量：跑 npm run todo -- --all 看实际体积，或直接 curl api.github.com/repos/.../ 的 size 字段',
      'A 级（最省事，优先做）：预报缓存写入前逐省比对，只 git add 内容真变了的文件。实际每轮只有少数省份在变，预计省 60–80% 的预报写入',
      'B 级（体积 > 600 MB 再做）：data/forecast 与 data/cross 改成「只留最新一份」，先删旧再写新',
      'C 级（体积 > 900 MB）：数据迁到 Cloudflare R2，仓库只留源码；R2 免费额度 10 GB，几年内不产生费用',
      '⚠️ 不要用 git rm 来「清理体积」，没用；只有 git filter-repo 重写历史才真能缩，见 §33.3'
    ],
    doc: '交接文档 35（含实测锚点、压缩比 25 倍的原因、第 35.6 节体积观察记录表）',
    files: ['tools/todo.mjs', '.github/workflows/forecast-cache.yml', '.github/workflows/xsec-cache.yml']
  },

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
    title: '卫星云顶高度（CTT/CTH）独立数据源 —— 已打通免注册链路',
    state: 'open',
    trigger: {
      text: '2026-11-01：NASA GIBS 瓦片链路已跑通（1 KB/点，免注册）；下一步等每日剖面快照攒够样本',
      metric: null
    },
    why:
      '原结论「代价太高」是因为只看过 AWS Himawari L1b（20+ GB/天、JMA 私有格式）。' +
      '改用 NASA GIBS 的 MODIS 云顶高度瓦片 + 官方调色板后，一个机位一天只要 1 张几 KB 的 PNG，' +
      'tools/obs/sample-cth.mjs 已实测 8 机位 × 3 天，高度档结论自洽。' +
      '仍缺的一环：GFS 剖面没有历史快照，无法和卫星逐日比对。',
    how: [
      '已完成：tools/obs/sample-cth.mjs（GIBS 瓦片→有云占比+4 档高度）+ compare-cth.mjs + probe-sources.mjs',
      '已完成：docs/handoff/stages/阶段七-03-卫星云顶高度-可行性落地.md（数据链路、实测、诚实边界）',
      '已完成：每天存剖面摘要（tools/obs/snapshot-xsec.mjs，CI 已接）与卫星取样（每日存档、幂等去重）',
      '已完成：跨模式对照 tools/obs/compare-models.mjs（首批实测：850/700 hPa 云量差 21–23%，300 hPa RH 差 15%）',
      '待做：攒到 30 天样本后做「模式高估/低估高云」的定量分析（见 tools/todo.mjs 的 xsec-cth-30day）',
      'CDS/ERA5 原始压力层仍需账号，作为第三重交叉验证',
    ],
    doc: 'docs/handoff/stages/阶段七-03-卫星云顶高度-可行性落地.md',
    files: ['tools/obs/sample-cth.mjs', 'tools/obs/compare-cth.mjs', 'tools/obs/probe-sources.mjs']
  },
  {
    id: 'xsec-cth-30day',
    title: '剖面摘要 × 卫星云顶高度 × METAR 的三方定量分析（等 30 天样本）',
    state: 'waiting',
    trigger: {
      text: 'data/obs/xsec-snapshot/ 攒到 ≥30 天，且 data/obs/cth-*.json 每个机位 ≥20 天',
      metric: null
    },
    why:
      '阶段七-04 起每天自动存：剖面摘要（模式认为云在哪层）、卫星云顶高度档、METAR 实况。' +
      '这三者凑够 30 天后才能回答「模式是不是系统性高估高云」「误报集中在哪种云况」，' +
      '现在样本只有 1 天，结论会过拟合。',
    how: [
      '写 tools/obs/analyze-30d.mjs：按天 join 三份数据，输出「模式云顶 vs 卫星高度档」的分档混淆矩阵',
      '看高估/低估是否与季节、天气型（晴空/中云/高云）相关，而不是只看总体均值',
      '结论只用于标注「这一层不可信」，不直接改 scoreOf()；要改评分必须单独立项 + A 级证据',
    ],
    doc: 'docs/handoff/stages/阶段七-04-验证数据每日采集.md §5',
    files: ['tools/obs/snapshot-xsec.mjs', 'tools/obs/sample-cth.mjs']
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
      '结论回写 docs/handoff/stages/阶段六-03litgeo-verify-验证报告.md §7 与 docs/handoff/stages/阶段五-02大气剖面-GFS数据管线与验证.md §3，达到"可引用"标准前继续保持经验性表述',
    ],
    doc: 'docs/handoff/stages/阶段六-03litgeo-verify-验证报告.md §7',
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
      '按 docs/handoff/stages/阶段六-01光线几何引擎-技术设计.md 的模块划分实现纯函数（earth/sunlight/timing/aerosol/viewing）',
      '把 docs/handoff/stages/阶段六-03litgeo-verify-验证报告.md 的 51 项检查改写成正式单测（node --test 或现有 test-*.mjs 风格）',
      '全部纯函数 + 单测；不 import scoring、不写 forecast state',
      '先只做 /cross 的只读叠加图层（V1），再评估独立 0–500 km 光照图（V2）',
      '输出必须带 confidence/flags，页面明示哪些是估算',
    ],
    doc: 'docs/handoff/stages/阶段六-01光线几何引擎-技术设计.md',
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
    doc: 'docs/handoff/stages/阶段六-02大气光学实验室-技术设计.md',
    files: []
  },
  {
    id: 'cross-224-national',
    title: '/cross 全国 224 机位已铺开（224/224 落盘，质量报告 0 不合格）',
    state: 'done',
    trigger: {
      text: '2026-11-01 完成：build_cross_national.py 生成 224 个机位（4.04 MB），quality_national.py 0 不合格',
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
    doc: 'docs/handoff/stages/阶段七-00-cross重构审计与方案.md §7',
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
      '已完成：src/lib/xsec/light.ts 纯函数 + docs/handoff/stages/阶段七-01-太阳几何与照明引擎-实现报告.md 的公式与假设表',
      '已完成：tools/xsec/test-light.mjs（52 项），接进 /cross 的「太阳与照明几何」卡',
      '待做：摄影价值卡（只说条件与归因，不产生分数、不写回 forecast）',
    ],
    doc: 'docs/handoff/stages/阶段七-01-太阳几何与照明引擎-实现报告.md',
    files: ['src/lib/xsec/light.ts', 'tools/xsec/test-light.mjs']
  },
  {
    id: 'cross-far-field-sunpath',
    title: '/cross 只有 50 km 剖面，夕阳照明边界大多在视野外',
    state: 'done',
    trigger: {
      text: '2026-11-01 已完成：SAMPLE_KM 扩到 0–320 km（9 个采样点），lengthKm=320，图下方另有 0–800 km 光路带',
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
    doc: 'docs/handoff/stages/阶段七-01-太阳几何与照明引擎-实现报告.md §5、docs/handoff/stages/阶段七-00-cross重构审计与方案.md §9',
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
      '结论写进 docs/handoff/stages/阶段五-02大气剖面-GFS数据管线与验证.md 的 §3，并把 quality.json 的 thresholds 换成新依据',
    ],
    doc: 'docs/handoff/stages/阶段五-02大气剖面-GFS数据管线与验证.md §3、§11',
    files: ['tools/xsec/build_cross.py', 'data/cross/quality.json']
  },
  {
    id: 'xsec-expand-spots',
    title: '大气剖面目前只做 8 个代表机位，要不要扩到全部 224 个',
    state: 'done',
    trigger: {
      text: '2026-11-01 已完成：224/224 落盘（34 个省目录）。2026-11-04 起 CI 每天 12:40 / 18:40 自动跑全国轮',
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
    doc: 'docs/handoff/stages/阶段五-02大气剖面-GFS数据管线与验证.md §9、§11',
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

  if (item.trigger.metric === 'repoSize') {
    return await evaluateRepoSize()
  }

  return { due: null, detail: '未知判定方式' }
}

/**
 * 查 GitHub 上的仓库体积。需要联网；离线时返回 due=null（不误报）。
 * 阈值见 ITEMS 里 repo-size 那条的 trigger.text。
 */
async function evaluateRepoSize() {
  const THRESHOLD_MB = 300
  try {
    const res = await fetch('https://api.github.com/repos/shutiaoqiepian/hainan-n-mspa', {
      headers: { 'User-Agent': 'mspa-todo' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return { due: null, detail: `查询失败 HTTP ${res.status}，需人工到 GitHub 仓库首页看` }
    const d = await res.json()
    const mb = Math.round((d.size / 1024) * 10) / 10
    return {
      due: mb >= THRESHOLD_MB,
      detail: `仓库 ${mb} MB（触发线 ${THRESHOLD_MB} MB，约 21 个月后到 1 GB）`
    }
  } catch {
    return { due: null, detail: '离线或超时，需人工判断（阈值 300 MB）' }
  }
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
    /* done = 已完成归档。默认（不带 --all）不列，免得「已完成」混在待办里误导人；
       --all 时以 ✅ 单独展示。*/
    if (!showAll && !onlyDue && item.state === 'done') continue
    if (!showAll && !onlyDue && item.state === 'pending' && !isDue) continue

    const flag =
      isDue ? '🔔 到期'
      : item.state === 'done' ? '✅ 已完成'
      : item.state === 'open' ? '○ 可做'
      : '⏳ 等待'
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
