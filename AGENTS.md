# AGENTS.md · 给接手这个仓库的 AI / 开发者

> 这份文件很短，**请先读完再动手改任何代码**。

### 文档地图（先知道该看哪份，别通读）

> **完整文档索引在 [`docs/README.md`](docs/README.md)** —— 想找"还有哪些文档、该不该读"，去那里。
> 下表只列最常用的 7 个。

| 文件 | 看什么 | 什么时候看 |
|---|---|---|
| **`AGENTS.md`**（本文件，~240 行） | 开工前必做、硬约束、改完必跑、数据源现状、环境坑 | **先读完，每次开工前扫一遍** |
| **`交接文档.md`**（~4000 行，**别通读**） | 第 0.1「目录导航」按主题查 + 第 0.2「踩坑速查表」按坑类型查；第 1–9 章＝开发手册，第 10–39 章＝流水账错题本 | 改到某模块前，用 0.1 定位章节再读 |
| **`docs/ALGORITHM-COLLAB.md`** | **算法协作改进协议**：14 个算法地图 + 5 条红线 + 验证矩阵 + 多 AI 并发规则 + 可认领任务 | **要改任何算法前必读** |
| **`research/README.md`** | **参考文献库**：13 条权威文献 + 数据源规范 + D 级实测反推值（A/B/C/D 可信度分级） | 想知道「这个参数有没有依据」时 |
| **`docs/README.md`** | 全部开发文档的三层索引：必读 / 按主题查 / 历史存档 | 不知道某份文档该不该读时 |
| **`README.md`** | 技术栈概览、发布流程、加作品/机位的步骤 | 需要了解对外口径时 |
| **`使用说明.md`** | 面向**非开发者**（加图、发布、排错、反馈通道现状） | 用户问「怎么用」时 |

> ⚠️ **`docs/archive/` 里的 7 份是 2026-10 早期的「给 GPT 审查算法」材料，公式和阈值全部过时，
> 不要当现状读**。算法此后已重写多轮（中云画布 §38、六档改名 + 满分 100 §39）。

> 项目在 2026-10-25 ~ 11-07 间高频演进（新增 cross 剖面、日出、雾、中云、云种改名等）。
> **旧文档里的「7 页」「25 个机位」「dist 已提交」都是过时说法**，以交接文档第 2 章（2026-11-07 实测重写）为准。

---

## 0. 开工前必做三件事

```bash
node tools/todo.mjs --all        # 有哪些「等数据到位再决定」的挂起事项
node tools/accuracy-trend.mjs    # 算法现在到底准不准（一句话结论）
node tools/check-gaps.mjs        # 这周有没有缺数据（只看 accuracy-trend 会被骗，见 26.9）
```

**如果你没有跑这三条就准备改预报相关的代码，请先停下来问我一句。**
这不是客套——仓库里有多条已经写死的产品决策和「暂时打了补丁、没换正解」的地方，
不知道它们就动手，大概率是在推翻一个故意的选择。

---

## 1. 这个项目是什么

18N-MSPA（北纬18度椰青摄联）官网 + 霞光预报工具。
Vue 3 + TypeScript + Vite 多页应用，部署在 Cloudflare Pages（构建命令 `npm run build`，输出 `dist/`；
**`dist/` 不进仓库**，本地构建一次即可，别把它加回 Git）。

> **构建产物纪律（2026-11-07 起，务必遵守）**
> 线上发布的是 `dist/`（线上实测确认）。所以：
> - 根目录 `*.html` 和 `assets/` **不进 Git**（已 `.gitignore`）。它们是构建中间产物，
>   由 `prebuild` 的 `tools/restore-shells.mjs` 从 `src/shells/` 生成。
> - **改页面 `<head>` / SEO / 标题 → 改 `src/shells/*.html`**，不要改根目录。
> - `tools/publish-root.ts` 已删除（它只做「把 dist 覆盖回根目录」，前提不成立）。
> - `npm run build` 之后 `git status` 是干净的，`git add -A` 安全。
> - 详见交接文档第 5 章。

三块业务：**摄影作品**、**摄影师社群**、**霞光预测**。
不要把它改造成通用企业官网或普通天气网站。

### 1.1 环境与工具链（Windows，接手先看，能省一整天排错）

| 项 | 现状 | 正确做法 |
|---|---|---|
| Node | 本机 v20.17.0（Vite 7 要求 20.19+，会打警告但能跑） | 别顺手升级 Node（可能连锁破坏）；警告可忽略 |
| `vue-tsc` | **不在 PATH 里** | 一律 `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` |
| WebSocket | Node 20 **没有**全局 WebSocket，也没装 `undici`/`ws` | 无头浏览器 CDP 用 `tools/obs/miniwsc.mjs`（手写客户端，已支持 64 位帧 + 分片） |
| Python | 没有 `python`/`python3` 命令（会命中 Windows Store 别名） | 用完整路径（如 DSH 运行时的 python.exe）；`python3 - <<EOF` heredoc 会踩 Store 别名坑 |
| 控制台编码 | Windows 控制台 GBK，Python 打印中文会乱码 | 跑 Python 脚本加 `PYTHONIOENCODING=utf-8` |
| PyYAML | 环境里**没有** | 校验 YAML 用 `node` 而不是 python |
| TS 测试脚本 | `.mjs` 测试脚本要 import 源码里的 `.ts` | 用 esbuild（在 node_modules 里）打包后再跑，别手写转译 |

---

## 2. 三条硬约束

> ⚠️ **2026-11-07 授权变更**：主人明确表示「**为了优化算法，修改是允许的**」。
> 因此第 1 条从「不许改公式」下调为「**可以改，但必须版本化 + 有证据**」。
> 完整条款见 [`docs/ALGORITHM-COLLAB.md`](docs/ALGORITHM-COLLAB.md) 第一节。

1. **改 `scoreOf()` 公式 = 允许，但必须版本化。**
   可以动乘法结构、`pow(raw, 1.8)`、各因子形状，**但必须**：
   ① 新公式作为**显式版本**（如 `ScoreOpts.formula: 'v2'`），旧版 `'v1'` 仍可调用；
   ② 页面明确切到新版；③ 历史快照记录 `scoreVersion`。
   **禁止**的是「直接把 v1 改成 v2、让老数据再也算不回去」——历史快照
   （`data/obs/forecast-*.json`）必须能被复算，**靠版本号，不靠冻结公式**。
   → 验收门槛：v2 的 A 级误报率必须 **≤** v1、命中 **≥** v1，否则回滚。
   → 历史上往 `ScoreOpts` 加可选开关（`midLift` / `horizonBlock` / `rainRelief`…）仍是首选做法。
2. **宁可漏报，不可误报。**
   任何让全站分数系统性上浮 / 下浮的改动，需要实测影响面并解释。
   （曾因此否掉过「峰值窗口当主分数」（+2.37 均值、30 个机位等级翻转）
   和 GPT 版 `fAod`（平均 −3.60、30/169 翻转）。）
   **这条是"优化"的验收标准，不是禁令。**
3. **加了机位必须重跑 `node tools/build-cache.mjs`。**
   省级缓存是按下标对齐的，不重跑会让新机位**静默拿到 `weather[0]` 的天气**。

---

## 3. 哪些事在等数据，别提前做

台账在 `tools/todo.mjs`，7 条。最关键的几条：

| id | 事项 | 等什么 |
|---|---|---|
| `profile-data-source` | 云种剖面要不要改用多模式平均（现在剖面看 ECMWF 单模式、计分看三家平均） | A 级样本 ≥30 天，或误报率 ≥25% |
| `pchip-continuous` | `candidates/continuous.ts`（PCHIP）接生产 | 同上，没有干净基准就没法做 A/B |
| `satellite-ctt` | 卫星云顶温度 | 只有出现「漏报为主」才值得做 |
| `audit-p1-p2` | 四项审计遗留 | 等 A 级样本指出具体问题 |

**这些不是"忘了做"，是"故意等"。** 要动之前请先问我。

---

## 4. 代码里搜「挂起决定」

凡是**先打了补丁、没换正解**的地方，头部注释都写着 **`挂起决定`** 四个字：

```bash
grep -rn "挂起决定" src/
```

目前两处：`src/lib/forecast/clouds.ts`（剖面数据源）、`src/lib/forecast/api.ts`（`anyCover` 补丁）。
看到这个词，说明那里有一个未完成的设计决定。

---

## 5. 改完必跑

```bash
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit   # vue-tsc 不在 PATH 里
npm run build
node tools/test-boundaries.mjs                      # 53 项：边界 + 六档映射 + 区间档位
node tools/test-physics.mjs                         # 23 项物理
node tools/test/text-lint.mjs                       # 预测页文案穷举自检（7680 + 324 组合）
```

改了**分数上限 / 等级阈值 / 区间写法**（`levels.ts`、`SCORE_MAX`、`RANGE_DELTA`）额外跑：

```bash
node tools/grade-dist.mjs --save=/tmp/base.json     # 改之前先存一份
# …改完…
node tools/grade-dist.mjs --base=/tmp/base.json     # 逐条 diff：升/降/等级翻转各几条
```
> 等级表只允许在 `src/data/forecast/levels.ts` 写一份。tools 里不要再抄 `[[92,'世纪大烧'],…]`
> 这种数组 —— 2026-11-06 改档名时，仓库里有 6 处抄写全都要手改一遍。
> 阈值与区间半径的理由见交接文档第 39 章。

改了**中云画布 / 云底照亮窗口**（`baselit.ts`、`midcloud.ts`、`MID_CANVAS`）额外跑：

```bash
node tools/test-baselit.mjs     # 40 项：地球阴影角 / 窗口长度 / 算不出必须 null
node tools/test-midcloud.mjs    # 47 项：云种三档 / lift 边界 / 只增不减 / 历史基准
node tools/ab-midcloud.mjs      # 影响面：必须「平均上浮 < 1 分」且「降低 0 条」
```
> `MID_CANVAS` 里任何一个常数都是实测反推的，不是拍的。改了就重跑 `ab-midcloud.mjs`，
> 没通过就别提交。理由与全部数字见交接文档第 38 章。

改了 `data/forecast/*.json` 的读写、机位表、或缓存格式，额外跑：

```bash
node tools/test-cache-format.mjs    # 缓存格式自洽 + 前端能吃下 + 机位对不上会报错
node tools/verify-cache-diff.mjs    # 读出来再写回去必须逐字节一致
```

改了大气剖面（`tools/xsec/`、`src/lib/xsec/`、`src/components/xsec/`、`src/pages/CrossSectionPage.vue`）额外跑：

```bash
python tools/xsec/verify_cross.py   # 剖面缓存结构 / 数量 / 量级 / 地形遮罩 / 时间单调
node tools/xsec/test-light.mjs      # 光照几何 52 项（曲率/受光判据/边界/AOD/地形遮挡/受光窗口）
node tools/test-rain.mjs            # 降水字段契约：缺测必须是 null，不能变 0
node tools/test-shadow.mjs          # 影子分数 14 项（含「不得高于基线」封顶规则扫描）
python tools/xsec/build_context.py --allow-partial  # 重建 DEM 地形 + AOD（Open-Meteo 限额时自动回退 SRTM）
python tools/xsec/build_cross_national.py     # 全国 224 机位剖面（约 25 分钟，4 MB）
python tools/xsec/quality_national.py         # 全国质量报告（覆盖/结构/真实性/逐省）
```

> `data/cross/context.json` 与 GFS 剖面缓存**分开**：它是 DEM（Copernicus/SRTM）与 CAMS AOD，
> 失败不会影响剖面；页面缺它就显示"地形缺测"，绝不伪造地形。

> 剖面系统是**独立的解释层**：它不读 `data/forecast/`、不参与 `scoreOf()`、不改排名。
> 任何把剖面云水接进评分公式的想法，按硬约束 1 处理（先立项、先 A 级证据）。

动了算法还要跑 `tools/diff-scores.mjs` 对比改动前后的逐机位分数，
**平均变化超过 ±1 分必须先解释清楚再提交**。

想重新量「缓存更新一次仓库涨多少」：`node tools/measure-cache-git.mjs`
（结论：每天 8 次约 70~85 KB，一年 0.03 GB，不构成问题）。

自测基准（改了算法必须对上，对不上就是错了）：

```
62/20/8,0.12,5,70→86   3/5/10,0.1,0,60→0      20/10/15,0.15,0,65→7
66/30/12,0.18,0,72→80  60/20/80,0.2,10,85→12  95/85/90,0.4,70,92→1
60/20/10,0.85,5,70→43  92/40/20,0.25,10,78→21 全缺测→4
```

---

## 6. 数据源现状（别再试已否定过的）

| 源 | 结论 |
|---|---|
| Open-Meteo（预报 + 空气质量） | ✅ 霞光评分的唯一预报源 |
| NOAA GFS 0.25° pgrb2 | ✅ **只给大气剖面用**（CLWMR/ICMR 真三维云水云冰），不参与算分 |
| 机场 METAR | ✅ 用作**校验真值**，不参与算分、不展示给用户 |
| 中国 SYNOP | ❌ 死路：66 条报文里只有 2 条带云组 |
| 卫星云顶温度 | ⏸ 暂缓，见 `satellite-ctt` |
| ERA5 / CAMS | ⏸ 未接：前者等 CDS 账号做阈值对照，后者任务书明确「不必须」 |
| 用户反馈表单 | ⚠ 后端未定，现在 `POST /` 返回 405 |

---

## 7. 不确定就问我

这个项目的主人**没有编程背景**，但很在意「别把没说改的东西偷偷改了」。
下列情况请**先问，不要自己决定**：

- 要改任何会影响用户看到的分数的东西
- 要换数据源 / 调阈值 / 改判定口径
- 要加新依赖
- 要动部署配置、仓库权限、CI 权限
- 要删除任何看起来"没用到"的代码（可能是有意的兼容层）

改了 `tools/obs/` 或验证数据管线（METAR / 卫星 / 剖面快照）额外跑：

```bash
node tools/obs/probe-sources.mjs          # 数据源连通性体检（哪些免注册可用、哪些 401）
node tools/obs/snapshot-xsec.mjs --check  # 剖面摘要只打印不落盘
node tools/obs/merge-cth.mjs --input <文件> --check  # 卫星存档合并（幂等，不写重复）
node tools/obs/compare-models.mjs --date YYYY-MM-DD --days 3   # GFS vs IFS 逐层分歧
```

> `data/obs/` 下所有快照都是**只增不改**的历史档案：脚本必须幂等（同一天同一机位只能有一条）。
> 卫星云顶高度的颜色→高度映射必须用 `tools/obs/data/cloud-top-height-colormap.xml`（官方），
> `unknownColors` 非 0 要停下来重下调色板，不能继续算。
