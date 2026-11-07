# 算法协作改进协议（多 AI / 多人共用）

> **目标：让多个 AI 能同时改进算法，而不互相踩、不破坏历史可比性。**
>
> 这个仓库的核心资产是**评分算法**，它已经被多轮迭代校准过。
> 随便改一个常数，可能让全站几百条预报的档位翻转，也可能让历史快照再也算不回去。
> 所以改动必须**有依据、有测量、有记录、可回滚**。

---

## 一、五条红线（违反即回滚，不要试探）

| # | 红线 | 具体含义 | 为什么 |
|---|---|---|---|
| 1 | **不改 `scoreOf()` 的公式形状** | 不许动 `h × lowF × midF × aodF × wetF` 的乘法结构，不许动 `pow(raw, 1.8)`。**只能在外部加可选开关**（往 `ScoreOpts` 加字段） | 历史快照（`data/obs/forecast-*.json`）必须能用同一套代码复算 |
| 2 | **宁可漏报，不可误报** | 任何让全站分数**系统性上浮**的改动，必须满足：平均上浮 **< 1 分** 且 **降低 0 条** | 曾因此否掉「峰值窗口当主分数」（+2.37 均值、30 机位翻转）和 GPT 版 `fAod`（−3.60） |
| 3 | **只增不减** | 中云抬升这类「补漏报」的改动，数学上必须 `h' ≥ h` 恒成立 | 否则会把本该高的分压低，等于用新 bug 换旧 bug |
| 4 | **不传 opts 必须与 `scoreOf` 逐位一致** | `scoreOfAt(m)` 无参数调用 === `scoreOf(m)` | 老数据要能复算；`shadow.ts` 必须用同一口径做基线，否则重演「拿裸分当基线」的坑 |
| 5 | **不许把经验值说成准确率** | C/D 级依据（见 `research/README.md` 第四节）在界面上只能写「当前取值」「已计入评分」，**不能写「准确率」「概率」「实测验证」** | 项目没有观测标定，写"概率"是造假 |

---

## 二、算法地图（改哪个文件 = 改哪个算法）

> **依赖依据**：指向 `research/README.md` 的文献编号 / 第四节 D 级表。
> **红线**列写「★」的，改动前必须在本文件登记并告知主人。

### 2.1 评分核心（最敏感）

| 算法 | 文件 | 行数 | 对外函数 | 可调参数 | 依据 | 红线 |
|---|---|---|---|---|---|---|
| **霞光评分** | `src/lib/forecast/scoring.ts` | 546 | `scoreOf(m)`、`scoreOfAt(m, opts)` | 无法直接调；只能通过 `ScoreOpts` 注入信号 | 文献 #1（TCC 0.47 → 1.8 次方）、#2（高云 0 不硬归零）、#3（AOD） | ★★★ 结构不可改 |
| 高云画布 `fHigh` | 同上 | — | 内部 | 8/55/78 三档平台 | 文献 #2 | ★★ 改档位会影响全站 |
| 低云遮挡 `fLow` | 同上 | — | 内部 | — | 实测 | ★★ |
| AOD `fAod` | 同上 | — | 内部 | 0.1/0.2/0.3/0.5/0.8 对照 | 文献 #3/#4 | ★★ |
| 云隙光 `crepuscularOf` | 同上 | — | 内部 | 云量 40–60% 最优 | 文献 #10 | ★ |
| 光柱 `pillarOf` | 同上 | — | 内部 | −6°~+20° 窗口 | 文献 #9 | ★ |

### 2.2 云与画布（可改，但要测影响面）

| 算法 | 文件 | 行数 | 对外函数 | 可调参数 | 依据 | 备注 |
|---|---|---|---|---|---|---|
| 云种剖面 | `clouds.ts` | 405 | `cloudProfile()`、`canvasFactor()` | 云量 ≥30%、RH ≥80% 判有云 | 文献 #5（WMO 高度分界） | ⚠️ **变量清单有两份**：`api.ts` 的 `PROFILE_VARS` 与 `build-cache.mjs` 的 `PROFILE_VARS`，加变量两边一起改 |
| **中云画布** | `midcloud.ts` | 270 | `midOpacityOf()`、`midCanvasPlan()` | `MID_CANVAS.alpha=0.6`、`minCover=25`、`fullCover=55`；RH 阈值 92/85/76/66 | ❌ D 级（无标定） | 改任一常数**必须**跑 `ab-midcloud.mjs` |
| **云底照亮窗口** | `baselit.ts` | 140 | `earthShadowAngleDeg()`、`baseLitWindow()`、`litWindowFactor()` | 窗口置信度下限 0.65 | A 级（球面几何，确定值） | 窗口长度是几何算出的**确定值**，不是概率 |
| 云属分类 | `xsec/cloudgenus.ts` | 231 | `genusLabel()`、`genusOfLevel()` | — | 文献 #5/#11（WMO） | 剖面用，不参与评分 |

### 2.3 其他指标（相对独立）

| 算法 | 文件 | 行数 | 对外函数 | 依据 | 备注 |
|---|---|---|---|---|---|
| **雾潜势** | `fog.ts` | 276 | `computeFog()` | C 级（海南气象台机制）+ 文献 §6.2 | 硬门槛「冷面条件」不满足时**必须显示"不满足"，不能显示百分比** |
| 海温 SST | `sst.ts` | 102 | `loadSst()`、`sstAt()` | B 级（Open-Meteo Marine） | 只有海面点有值，内陆 null |
| 太阳位置 | `sun.ts` | 63 | `sunPosition()`、`sunElevation()`、`faceMatch()` | A 级（NOAA solcalc） | 与 `xsec/sun.ts` 是两套（⚠️ 别再抄第三份） |
| **影子分数** | `shadow.ts` | 204 | `continuityFactor()`、`terrainFactor()`、`precipFactor()`、`scoreShadow()` | 实验性 | **只评估用，绝不显示在页面**；必须 `shadow ≤ base` |
| 文案解读 | `interpret.ts` | 361 | `interpret()`、`interpretOneLine()`、`conflictsOf()` | 规则拼接 | 改阈值必须同步改文案；跑 `test/text-lint.mjs` |
| **等级与区间** | `src/data/forecast/levels.ts` | 107 | `LEVELS`、`gradeRangeOf()`、`SCORE_MAX=100`、`RANGE_DELTA=5` | ⚠️ 约定值 | **等级表只准写这一份**，禁止在 tools/ 里抄数组 |
| 光照几何 | `src/lib/xsec/light.ts` | 275 | `boundaryHeightKm()`、`litAt()`、`terminatorKm()`、`airmass()` | A 级（球面几何 + Beer-Lambert） | 剖面用，不参与评分 |

---

## 三、依赖关系（改 A 会不会波及 B）

```
scoreOfAt  ← api.ts 逐小时调用（决定页面所有分数）
    ↑
shadow.ts 用 scoreOfAt 做基线（口径必须完全一致，否则影子分数失真）
    ↑
midcloud.ts 产出 midLift → api.ts 传给 scoreOfAt → shadow 也必须带同一 midLift

levels.ts  ← 全站显示层（DecisionHero / SpotTable / SpotRow / 名片 / 分享文案 / 回填弹窗）
           改分界线 = 全站档位可能翻转，历史可比性受影响
```

**结论**：
- 改 `scoring.ts` / `midcloud.ts` / `levels.ts` → 必须跑**影响面测量**，不能只看单测。
- 改 `shadow.ts` → 不影响线上，但必须保证 `shadow ≤ base`（`test-shadow.mjs` 用 980 点网格扫）。

---

## 四、标准流程（7 步，缺一步就别提交）

```
1. 查依据   → research/README.md（这个参数是 A 级还是 D 级？）
2. 查台账   → node tools/todo.mjs --all（这条是不是"故意等"的？）
3. 认领     → 在台账里标记 / 在提交信息里写 id，防止两个 AI 同时改同一处
4. 存基线   → node tools/grade-dist.mjs --save=/tmp/base.json（改之前）
5. 改代码
6. 跑矩阵   → 见第五节
7. 记录     → 见第八节模板
```

> **第 2 步特别重要**：台账里有 12 条是「⏳ 等待」——那是**故意等数据**，不是忘了做。
> 不查就动手，大概率是在推翻一个刻意的选择。

---

## 五、验证矩阵（改什么，跑什么，通过标准）

| 改动类型 | 必跑命令 | 通过标准 |
|---|---|---|
| **任何**代码改动 | `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`<br>`npm run build` | 0 错误、构建成功 |
| 评分核心 / 等级阈值 / 上限 | `node tools/test-boundaries.mjs`（53）<br>`node tools/test-physics.mjs`（23）<br>`node tools/grade-dist.mjs --base=/tmp/base.json` | 全过；平均分变化 < ±1，等级翻转必须能解释 |
| 中云画布 `MID_CANVAS` | `node tools/test-midcloud.mjs`（47）<br>`node tools/ab-midcloud.mjs` | 全过；**平均上浮 < 1 分** 且 **降低 0 条** |
| 云底照亮窗口 `baselit.ts` | `node tools/test-baselit.mjs`（40） | 全过；算不出时必须 `null`，不许给假时刻 |
| 影子分数 `shadow.ts` | `node tools/test-shadow.mjs`（14） | 全过；**`shadow ≤ base` 在 980 点网格上恒成立** |
| 文案 / 解读 | `node tools/test/text-lint.mjs` | 8004 组合全过（禁用词、概率口径） |
| 预报机位 / 缓存格式 | `node tools/test-cache-format.mjs`<br>`node tools/verify-cache-diff.mjs` | 格式自洽、读写逐字节一致 |
| 大气剖面 | `python tools/xsec/verify_cross.py`<br>`node tools/xsec/test-light.mjs`（52）<br>`node tools/test-rain.mjs`（19） | 全过 |
| 剖面页说明面板 | `node tools/test-guide.mjs`（71） | 全过 |
| **任何 UI 改动** | `npm run build`<br>桌面 1440 / 手机 360 各看一遍<br>`document.documentElement.scrollWidth - clientWidth === 0` | 无横向溢出、与旧站零回归 |

**算法改动额外必做**：`node tools/diff-scores.mjs` 逐机位对比，
**平均变化超过 ±1 分必须解释清楚再提交**。

---

## 六、多 AI 并发协作规则（防冲突，血泪教训）

> 2026-11-07 真实发生：两个 AI 同时在同一个仓库工作，A 已经改了 7 个 `src/` 文件尚未提交，
> B 若随手 `git add -A`，就会把 A 的半成品一起提交。**下面是避免这件事的规则。**

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **开工前先 `git status`** | 看有没有别人未提交的改动。有 → 不要碰那些文件，也不要用 `git add -A` |
| 2 | **只用 `git add <具体文件>`**，禁止 `git add -A` / `git add .` | 防止把别人的半成品、临时脚本、`.workbuddy/` 之类一起提交 |
| 3 | **认领再动手** | 同一时刻一个文件只归一个 AI。认领写在台账或提交信息里 |
| 4 | **不 force push** | 远端有 CI bot 自动提交（`chore: update forecast cache`），**每次 push 前先 fetch** |
| 5 | **rebase 前确认工作区** | 有别人的未提交改动时，用 `git pull --rebase --autostash`，rebase 后立刻 `git status` 验证别人的改动还在 |
| 6 | **不改别人的未提交文件** | 即使看到 bug，也先报告，不要直接改 |
| 7 | **提交信息必须写清**：依据 + 影响面 + 回滚方式 | 见第八节 |
| 8 | **临时脚本放 `tools/_tmp-*.mjs` 或不入库** | 别在 `tools/` 里留一次性扫描脚本（会被下一个 AI 当成正式工具） |

---

## 七、当前可认领的改进任务（摘自 `tools/todo.mjs`）

> 完整台账：`node tools/todo.mjs --all`。这里只列**现在就能动手**的（○），
> 「⏳ 等待」的**不要做**——它们在等数据。

| id | 任务 | 难度 | 依赖 | 产出 |
|---|---|---|---|---|
| `midcloud-calibrate` | 中云 α 与 RH 阈值标定 | 中 | 需先加回填标签 | 改 `MID_CANVAS` + 重跑 `ab-midcloud` |
| `fog-feedback-label` | 回填表加「今天有没有起雾」 | 低 | 无（只是没人做） | 改 `FeedbackModal` + `feedback.ts` |
| `phenomena-count` | 词库显示 60 实际 58 + 2 组重复 | 低 | 无 | 改 `phenomena.ts` |
| `grade-ladder-visible` | 六档在页面上没有入口 | 低 | **需先问主人**（会占首屏高度） | 加紧凑图例 |
| `satellite-ctt` | 卫星云顶高度已打通，等样本 | 中 | 快照攒够 | `tools/obs/compare-cth.mjs` |
| `feedback-backend` | 回填表单 POST 405 | 中 | **需主人选方案**（腾讯问卷 / D1） | 改 `feedback.ts` |
| `data-gap-watch` | 数据缺口每日自检 | 低 | 无 | 已修三层，需复查 |
| `a-level-coverage` | A 级样本数够但高分样本少 | 低 | 每周复查 | 无需改代码 |
| `metar-west-hainan` | 海南西岸无真值观测 | 高 | 需实地放设备 | 无法用代码解决 |

---

## 八、改动记录模板（每次改算法必须留）

提交信息或交接文档里补一段，格式：

```
改了什么：<文件:函数/常数> 从 X → Y
依据：<research/README.md 的文献编号 / D 级表 / 实测数字>
影响面：全站平均 <±N 分，等级翻转 N 条（用 grade-dist/diff-scores 实测）
验证：<跑了哪些测试，结果>
回滚：git revert <commit> 即可；无数据迁移
不确定的地方：<诚实写出来>
```

> 参考范例：交接文档 §38.6（α 为什么是 0.6，附 α 敏感性扫描表）、
> §39.2（满分 96→100，附「896 条里只动了 1 条」的实测）。

---

## 九、新 AI 接手时的 5 分钟自检

```bash
git status                          # 有没有别人未提交的改动？
node tools/todo.mjs --all           # 有哪些故意在等的？哪些能认领？
node tools/accuracy-trend.mjs       # 算法现在准不准
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit   # 环境是否健康
npm run build                       # 能不能构建
```

四项都过，再开始改算法。
