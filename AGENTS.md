# AGENTS.md · 给接手这个仓库的 AI / 开发者

> 这份文件很短，**请先读完再动手改任何代码**。
> 完整背景在 `交接文档.md`（约 1500 行，不用全读，看第 0 章的目录导航挑章节）。

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

三块业务：**摄影作品**、**摄影师社群**、**霞光预测**。
不要把它改造成通用企业官网或普通天气网站。

---

## 2. 三条硬约束（违反会出大事）

1. **不改 `scoreOf()` 的公式**，只在外面加物理修正。
   历史快照（`data/obs/forecast-*.json`）必须能用同一套代码复算。
   → 具体做法是往 `ScoreOpts` 里加**可选**开关（`midLift` / `horizonBlock` / `rainRelief` …），
   不传时 `scoreOfAt` 必须与 `scoreOf` 逐位一致。2026-11-06 的中云抬升就是这么加的：
   `h' = h + (1−h)×lift`，`lift=0` 时结果完全不变（`tools/test-midcloud.mjs` 在守这条）。
2. **宁可漏报，不可误报。**
   任何让全站分数系统性上浮 / 下浮的改动，一票否决。
   （曾因此否掉过「峰值窗口当主分数」（+2.37 均值、30 个机位等级翻转）
   和 GPT 版 `fAod`（平均 −3.60、30/169 翻转）。）
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
node tools/test-boundaries.mjs                      # 32 项边界
node tools/test-physics.mjs                         # 23 项物理
```

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
