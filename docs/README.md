# 开发文档索引（给接手的 AI / 开发者）

> 这个仓库的文档按「入口 → 现行查阅 → 历史存档」组织；**所有交接类资料统一放在 `docs/handoff/`**。
> **按下面顺序读，不要通读全部**——`docs/` 加起来有 1.3 万行，通读会浪费时间还抓不住重点。

---

## 0. 文档放置约定（新增/移动文档前先看）

| 类型 | 位置 |
|---|---|
| 主交接日志（唯一活文档） | `docs/handoff/交接文档.md` |
| 阶段记录（阶段一~八） | `docs/handoff/stages/` |
| 专项调研（平流雾 / 卫星云顶 / 数据源核实） | `docs/handoff/topics/` |
| 历史归档（2026-10 早期材料） | `docs/handoff/archive/` |
| 交接文档插图 | `docs/handoff/assets/` |
| 分析记录（探索中、未落地） | `docs/analysis/`（**不进 handoff**，也不改正文） |

1. **交接 / 阶段性文档一律放 `docs/handoff/`**，**禁止在仓库根目录新建交接类文档**。
2. 新增阶段记录放 `stages/`、专项调研放 `topics/`，并在本索引第 1 层登记（文档 + 规模 + 什么时候读），否则下一个 AI 找不到它。
3. `handoff/stages/`、`topics/` 里的文档是**当时的事实记录**：历史数字过时是正常的，**不要改正文**——要纠正现状，去更新 `docs/handoff/交接文档.md` 对应章节。
4. 任何"过时/被推翻"的旧文档，移到 `handoff/archive/` 并在第 2 层登记，不要留在原处。
5. 仓库根目录只保留 `AGENTS.md`、`README.md`、`使用说明.md` 三份入口文档。

---

## 第 0 层：必读入口（约 20 分钟）

| 文档 | 规模 | 内容 | 什么时候读 |
|---|---|---|---|
| **[`AGENTS.md`](../AGENTS.md)** | ~240 行 | 开工前必做 3 件事、3 条硬约束、改完必跑清单、数据源现状、Windows 环境坑 | **每次开工前扫一遍** |
| **[`docs/handoff/交接文档.md`](handoff/交接文档.md)** | ~4000 行 | 第 0.1 目录导航（按主题查）+ 第 0.2 踩坑速查表（按坑类型查）；第 1–9 章＝开发手册；第 10–39 章＝流水账错题本 | **改到某模块前，查对应章节**，别通读 |
| **[`ALGORITHM-COLLAB.md`](ALGORITHM-COLLAB.md)** | ~230 行 | **算法协作改进协议**：14 个算法地图（文件/函数/可调参数/依据）、5 条红线、验证矩阵、多 AI 并发规则、可认领任务、改动记录模板 | **要改任何算法前必读** |
| **[`research/README.md`](../research/README.md)** | ~150 行 | **参考文献库**：13 条权威文献（含"用在哪"）、数据源规范、**D 级实测反推值**、A/B/C/D 可信度分级 | 想知道「这个参数有没有依据」时 |
| **`docs/README.md`（本文件）** | — | 文档地图 | 想知道「还有什么文档、该不该读」时 |

> **看交接文档的正确姿势**：先看 0.1 目录导航找章节号 → 只看那一章。
> 想改代码但不确定有没有坑 → 看 0.2 踩坑速查表。
> **想改算法** → 先看 `ALGORITHM-COLLAB.md` 的红线和验证矩阵，再去 `research/README.md` 查依据等级。

> 📌 交接文档已从根目录迁到 **`docs/handoff/交接文档.md`**（2026-11-08），章节编号**未变**，
> 代码/台账里写的「交接文档 §X」仍然有效。

---

## 第 1 层：现行有效（按主题查）

### A. 大气剖面 / 光线几何（`/cross` 页面，独立子系统）

| 文档 | 规模 | 什么时候读 |
|---|---|---|
| [`handoff/stages/阶段四-大气剖面技术方案.md`](handoff/stages/阶段四-大气剖面技术方案.md) | 600 行 | 想理解剖面图**为什么这么设计**（最长的一份设计推演） |
| [`handoff/stages/阶段五-02大气剖面-GFS数据管线与验证.md`](handoff/stages/阶段五-02大气剖面-GFS数据管线与验证.md) | 298 行 | 要动 GFS 数据管线 / 阈值标定 / 已知限制 |
| [`handoff/stages/阶段七-00-cross重构审计与方案.md`](handoff/stages/阶段七-00-cross重构审计与方案.md) | 240 行 | 要改剖面页 UI / 渲染层之前 |
| [`handoff/stages/阶段七-01-太阳几何与照明引擎-实现报告.md`](handoff/stages/阶段七-01-太阳几何与照明引擎-实现报告.md) | 202 行 | 要动太阳位置 / 照明边界 / 地形遮挡（含 52 项单测说明） |
| [`handoff/stages/阶段七-05-RH潜在云区图层.md`](handoff/stages/阶段七-05-RH潜在云区图层.md) | 54 行 | 要动「潜在云区」图层（**它不是云，是湿度诊断**） |
| [`handoff/stages/阶段八-02-降水区域表达.md`](handoff/stages/阶段八-02-降水区域表达.md) | 62 行 | 要动降水圆点（PRATE→mm/h，缺测=空心） |
| [`handoff/stages/阶段八-03-全国224机位管线.md`](handoff/stages/阶段八-03-全国224机位管线.md) | 118 行 | 要重建全国机位剖面（分带下载、日落方位、容错） |
| [`handoff/stages/阶段八-04-全国地形与气溶胶.md`](handoff/stages/阶段八-04-全国地形与气溶胶.md) | 78 行 | 要补 DEM 地形 / AOD（免费额度、分批续跑） |
| [`handoff/stages/阶段八-05-剖面页怎么看说明书.md`](handoff/stages/阶段八-05-剖面页怎么看说明书.md) | 108 行 | 要改剖面页那个「怎么看这张图」说明面板 |
| [`handoff/stages/阶段六-00参考资料原文整理与可行性审查.md`](handoff/stages/阶段六-00参考资料原文整理与可行性审查.md) | 275 行 | 要做光线几何 / 最佳时间预测前的资料底稿 |
| [`handoff/stages/阶段六-01光线几何引擎-技术设计.md`](handoff/stages/阶段六-01光线几何引擎-技术设计.md) | 265 行 | 光线几何引擎的技术设计 |
| [`handoff/stages/阶段六-02大气光学实验室-技术设计.md`](handoff/stages/阶段六-02大气光学实验室-技术设计.md) | 175 行 | 要做冰晕 / 大气光学模拟（含一个必须避开的采样坑） |
| [`handoff/stages/阶段六-03litgeo-verify-验证报告.md`](handoff/stages/阶段六-03litgeo-verify-验证报告.md) | 350 行 | 想确认「光线几何公式可不可信」/ TCDC 阈值专项 |

### B. 数据源与专项调研

| 文档 | 规模 | 什么时候读 |
|---|---|---|
| [`handoff/stages/阶段三-免费气象数据源调研.md`](handoff/stages/阶段三-免费气象数据源调研.md) | 348 行 | **要接新气象数据源之前必读**：五个源全部实测过，含「谁是唯一免费给三维云水/云冰的源」 |
| [`handoff/topics/数据源核实-OpenMeteo实测.md`](handoff/topics/数据源核实-OpenMeteo实测.md) | 97 行 | 想确认 Open-Meteo 各字段到底有没有值（由 `tools/probe-openmeteo-vars.mjs` 生成） |
| [`handoff/topics/平流雾调研-海南.md`](handoff/topics/平流雾调研-海南.md) | 306 行 | 要动雾功能（五条判据、为什么硬门槛不参与百分比、SST 来源） |
| [`handoff/topics/卫星云顶温度-可行性探查.md`](handoff/topics/卫星云顶温度-可行性探查.md) | 91 行 | 追溯「卫星云顶温度」这个方向的早期可行性结论（**旧结论已被阶段七-03 更新**，见下） |

### C. 验证与样本采集

| 文档 | 规模 | 什么时候读 |
|---|---|---|
| [`handoff/stages/阶段七-03-卫星云顶高度-可行性落地.md`](handoff/stages/阶段七-03-卫星云顶高度-可行性落地.md) | 106 行 | 要用卫星验证云层结构（NASA GIBS 链路 + 官方调色板 + 诚实边界） |
| [`handoff/stages/阶段七-04-验证数据每日采集.md`](handoff/stages/阶段七-04-验证数据每日采集.md) | 119 行 | 想知道每天在攒哪些验证样本、30 天后能回答什么 |

### D. 预测算法修正

| 文档 | 规模 | 什么时候读 |
|---|---|---|
| [`handoff/stages/阶段八-01-预测效果修正-口径与影子分数.md`](handoff/stages/阶段八-01-预测效果修正-口径与影子分数.md) | 98 行 | 想提高准确度但**不敢动 `scoreOf()`** 时（三条铁律在里面） |

### E. 全站审查

| 文档 | 规模 | 什么时候读 |
|---|---|---|
| [`handoff/stages/阶段一-全站现状审查-2026-11-01.md`](handoff/stages/阶段一-全站现状审查-2026-11-01.md) | 275 行 | **要改全站 UI/UX 前**：360/1920 视口实测、装饰保留清单、12 条不许删的功能 |
| [`handoff/stages/阶段五-01现状复核差异报告.md`](handoff/stages/阶段五-01现状复核差异报告.md) | 164 行 | 想知道历史报告与当前代码的差异 |

### F. 分析记录（`docs/analysis/`）—— ⚠️ **探索中，未落地**

> 这些是**正在探路**的分析，**不是已实现的功能**。读它们能避免重复调研，
> 但**不要**把里面的设想当成现状，也**不要**据此改 `scoring.ts`——
> 必须先经主人拍板 + 走 `ALGORITHM-COLLAB.md` 的 7 步流程。
> 拍板后：立项的移到第 1 层；否掉的移到第 2 层 `handoff/archive/`。
> 这 6 篇由 WorkBuddy 撰写与维护，**留在 `docs/analysis/` 不动**。

| 文档 | 规模 | 是什么 |
|---|---|---|
| [`analysis/sky-glow-literature.md`](analysis/sky-glow-literature.md) | 150 行 | 「天空霞 / clear-sky glow」的文献调研与科学性论证 |
| [`analysis/clear-sky-glow.md`](analysis/clear-sky-glow.md) | 150 行 | 晴天散射晚霞被"误杀"的物理调研 |
| [`analysis/threshold-revision.md`](analysis/threshold-revision.md) | 130 行 | 六档阈值重切分析（"不烧区间太大"） |
| [`analysis/thin-cloud-v2-plan.md`](analysis/thin-cloud-v2-plan.md) | 125 行 | 少云被斩杀 · 根因诊断与 v2 优化方案 |
| [`analysis/iridescent-cloud-plan.md`](analysis/iridescent-cloud-plan.md) | 165 行 | 七彩祥云（虹彩云）预测：现状 + 文献 + 整合方案 |
| [`analysis/sky-glow-learning-notes.md`](analysis/sky-glow-learning-notes.md) | 98 行 | 天空霞方向 · 学习验收与依据对照表 |

> 相关：`tools/_tmp-exp-scan.mjs` 的结论已作为**反向证据**写进
> `ALGORITHM-COLLAB.md` §1.1（"为什么 1.8 次方不能动"），那一项不需要再看分析文档。

### G. 状态说明（**只注明，不改历史正文**）

| 文档 | 状态说明 |
|---|---|
| `handoff/stages/阶段六-01`、`阶段六-02` | 技术设计稿（当时**未写代码**）；是否仍按原路线推进、是否已被 `阶段七-01` 部分实现覆盖，**无法从文档确认，待人工确认** |
| `handoff/stages/阶段八-04` | 文中「45 / 224」是 2026-11-01 的进度快照；当前 `data/cross/national-context.json` 的 `spots` 已 **224 / 224** |
| `handoff/topics/卫星云顶温度-可行性探查` | 旧结论「代价太高、先不做」已被 `阶段七-03` 显式更新为「可行、用途收窄」；本文保留作追溯 |
| `docs/阶段七-02` | **只有一张截图**（`docs/阶段七-02-悬停提示-修复验证.png`），没有对应 Markdown；`tools/obs/compare-models.mjs` 里对「docs/阶段七-02」的引用无法确认目标 |

---

## 第 2 层：历史存档（`docs/handoff/archive/`）—— **不要当现状读**

> 这 7 份是 **2026-10-23 ~ 10-25 的早期材料**，本意是「把算法贴给 GPT 做代码审查」。
> 此后算法已重写多轮（中云画布 §38、六档改名 + 满分 100 §39 等），
> **里面的公式、阈值、代码片段全部过时，读它们会被误导**。
> 只在「追溯当初为什么这么决定」时才看。

| 归档文档 | 是什么 |
|---|---|
| `handoff/archive/给GPT-火烧云算法.md` | 早期给 GPT 的算法说明 |
| `handoff/archive/火烧云算法-独立提取版.md` | 早期把算法从代码里抽出来的独立版 |
| `handoff/archive/火烧云预测算法_AI可读优化规范.md` | 早期「怎么让 AI 读懂这段算法」的规范 |
| `handoff/archive/海南北纬18度火烧云预测算法_AI审查任务书.md` | 早期给 AI 的审查任务书 |
| `handoff/archive/审计报告-交付物1-现状审计.md` | 2026-10 的现状审计 |
| `handoff/archive/GPT优化建议-评审意见.md` | 早期 GPT 的评审意见 |
| `handoff/archive/候选实现对照-我的vsGPT.md` | 早期「我的实现 vs GPT 实现」对照 |

---

## 其他资源

| 位置 | 是什么 |
|---|---|
| **[`research/README.md`](../research/README.md)** | ★ **参考文献库总索引**：13 条权威文献 + 数据源规范 + D 级实测反推值 + A/B/C/D 可信度分级。**改算法前先查这里** |
| `research/jargon.md`（243 行）/ `research/jargon.json` | 摄影圈天象黑话调研（102 条，含 67 条可验证来源），站内 68 条是它的精选子集 |
| `research/rays.md`（200 行） | 云隙光 / 光柱的联网调研（窗口、阈值出处） |
| `research/scoring-thresholds.md`（68 行） | 评分各系数的阈值来源笔记，**调参前必读** |
| [`使用说明.md`](../使用说明.md)（380 行） | 面向**非开发者**：加图、发布、排错、反馈通道现状 |
| [`README.md`](../README.md)（~180 行） | 对外技术概览、发布流程、加作品/机位步骤 |
| `src/components/forecast/References.vue` | 页面上展示的 13 条正式文献（用户可见）。**改它必须同步改 `research/README.md` 第一节** |

---

## 生成物（不要手动改，也不要提交）

| 文件 | 怎么来的 |
|---|---|
| `docs/给GPT-源码包-可粘贴.md`（2314 行） | 由 `node tools/bundle-for-review.mjs` 生成，用于把源码贴给外部模型审查。已在 `.gitignore` |
| `dist/`、根目录 `*.html`、`assets/` | 构建产物，见 `handoff/交接文档.md` 第 5 章 |

---

> 2026-11-08：交接文档体系迁移到 `docs/handoff/`（`交接文档.md` → `handoff/`，阶段记录 → `handoff/stages/`，
> 专项调研 → `handoff/topics/`，历史材料 → `handoff/archive/`，插图 → `handoff/assets/`）。本索引已同步。
