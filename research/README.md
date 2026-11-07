# 参考文献库（开发用）

> **改任何算法之前，先在这里查依据。**
> 每条都标注：出处 / **用在哪** / **可信度等级**。可信度等级决定了你能不能把它当"物理定律"用——
> 详见文末「可信度分级」。
>
> 页面上的 13 条正式文献由 `src/components/forecast/References.vue` 渲染
> （用户在前端「参考文献与方法来源」折叠区能看到）。**改那 13 条要同步改本文件。**

---

## 一、正式文献（页面上展示的 13 条，权威依据）

> 这是项目对外承诺的方法来源。**引用它们时不能曲解原意**，
> 每条后面的「用于」是本站实际怎么用它的。

| # | 文献 | 用在哪 | 等级 |
|---|---|---|---|
| 1 | 张帅, 吴捷, 陈敏, 仲跻芹, 黄向宇, 卢冰, 杨扬. **CMA-BJ 系统总云量预报性能检验评估**[J]. 气象, 2024, 50(9): 1057–1070. DOI: 10.7519/j.issn.1000-0526.2024.063001 | ① 1 天时效真实技巧评分 TCC 仅 0.47、有技巧上限 48–72 h → **`scoreOf` 的 1.8 次方压缩与时效折扣**；② 模式相对湿度偏小会造成云量低估 → **湿度剖面阈值放宽到 80%**（`clouds.ts` / `midcloud.ts`） | **A** |
| 2 | MetCoOp (Met Norway), 2012. **Verification of cloud forecasts**（MetCoOp MEMO） | ECMWF、AROME 等高估「无云」出现频率，报晴≠真晴 → **高云为 0 时不做硬性归零，低端保留缓坡**（`scoring.ts` 的 `fHigh`） | **A** |
| 3 | SunsetBot 团队. **火烧云定量预报速成 · 第一章节**（大气科学常识 / 几何 / 光谱消光） | 火烧云静态几何模型（光需从云底下方照上来）、霞光深入距离、瑞利与米散射对饱和度的影响 → **AOD 低才「通透」的理由**（`scoring.ts` 的 `fAod`、`baselit.ts`） | **C** |
| 4 | SunsetBot 团队. **同书 · 第二、三章节**（云 / 气象观测 / 数据来源） | AOD 与通透度对照表（0.1 水晶天 / 0.2 湛蓝 / 0.3 较蓝 / 0.5 普通 / 0.8 有霾）；彩虹判据（虹在太阳对面、太阳高度 <42°、雨滴 >0.5 mm）；各类云对火烧云的贡献 | **C** |
| 5 | WMO. **International Cloud Atlas**（国际云图）, 2017 版. https://cloudatlas.wmo.int/ | 云属定义与高度分界（低云 <2500 m / 中云 2500–7000 m / 高云 >6000 m）→ **850 / 700 / 500 / 400 hPa 划成低中高三层**（`clouds.ts`、`xsec/cloudgenus.ts`） | **A** |
| 6 | Open-Meteo. **Weather Forecast API 文档**. https://open-meteo.com/en/docs | 全部预报变量的来源与定义（分层云量、2 m 湿度、降水概率、边界层高度、CAPE、各气压层相对湿度）→ `api.ts`、`build-cache.mjs` | **B** |
| 7 | Open-Meteo. **Air Quality API**（底层 CAMS 再分析/预报）. https://open-meteo.com/en/docs/air-quality-api | AOD 与 PM2.5 数据来源 → `api.ts`（`aerosol_optical_depth`） | **B** |
| 8 | NOAA Global Monitoring Laboratory. **Solar Calculator**. https://gml.noaa.gov/grad/solcalc/ | 太阳高度角与方位角（本站用同一套低精度解析式）→ `lib/forecast/sun.ts`、`lib/xsec/sun.ts`、机位朝向匹配、彩虹判据 | **A** |
| 9 | Wikipedia. **«晕 (光学现象)»**. https://zh.wikipedia.org/wiki/晕 | 22° 晕、幻日、环天顶弧、太阳光柱同属冰晶光学（片状冰晶水平取向 → 光柱；随机取向 → 晕/幻日）→ **「太阳光柱」指数单独建模**，见 `research/rays.md` | **B** |
| 10 | RMetS. **Crepuscular rays formed by the Western Ghats**. Weather, 1986. https://rmets.onlinelibrary.wiley.com/doi/pdf/10.1002/j.1477-8696.1986.tb03862.x | 云隙光的观测个例与形成条件（太阳贴近地平线 + 云的缝隙 + 空气中有散射介质）→ **「云隙光」指数的太阳高度窗口与 AOD 窗口**（`scoring.ts` 的 `crepuscularOf`） | **A** |
| 11 | WMO. **International Cloud Atlas 中的云种命名**（含 Fluctus 迭浪云，2017 新增） | 云种识别结果的中文命名与俗称对照（透光高积云＝鱼鳞云、波状层积云＝排骨云）→ `xsec/cloudgenus.ts`、`data/forecast/phenomena.ts` | **A** |
| 12 | Bohren, C. F. & Huffman, D. R. **Absorption and Scattering of Light by Small Particles**. Wiley, 1983 | 背景阅读：米散射与瑞利散射经典教材，理解 AOD 为何影响色彩饱和度 | **A**（但仅作原理支撑，未直接取数值） |
| 13 | Petty, G. W. **A First Course in Atmospheric Radiation**. 2nd ed. Sundog Publishing, 2006 | 背景阅读：大气辐射传输基础，云的光学厚度与透射率的定性关系 → `baselit.ts` 的定性依据 | **A**（同上） |

---

## 二、数据源与工程规范（不在页面展示，但算法直接依赖）

| 资料 | 出处 | 用在哪 | 等级 |
|---|---|---|---|
| Open-Meteo Marine API | https://marine-api.open-meteo.com/v1/marine | 海表温度 SST（**只有海面点有值**，内陆全 null）→ `fog.ts` / `sst.ts` | **B** |
| NOAA GFS 0.25° pgrb2 | https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/ | 三维云水 CLWMR / 云冰 ICMR（**唯一免费源**）→ `tools/xsec/build_cross.py` | **B** |
| AWC METAR API | https://aviationweather.gov/api/data/metar | 机场实测（校验真值，不参与评分、不展示）→ `tools/fetch-metar.mjs` | **B** |
| Copernicus CDS（ERA5） | https://cds.climate.copernicus.eu/ | 仅 dry-run；等账号做阈值对照（台账 `xsec-era5-validate`） | **B** |
| NASA GIBS WMTS | https://gibs.earthdata.nasa.gov/wmts/epsg3857/best | 卫星云顶高度（免注册瓦片）→ `tools/obs/sample-cth.mjs` | **B** |
| AWS elevation-tiles-prod（SRTM 30 m） | https://s3.amazonaws.com/elevation-tiles-prod/skadi/ | 真实 DEM 地形 → `tools/xsec/build_context.py`（主源，无限速） | **B** |
| OpenTopoData / Open-Meteo elevation | api.opentopodata.org / api.open-meteo.com/v1/elevation | DEM 备选源（限额或慢，已降级） | **B** |
| OurAirports 机场数据 | https://davidmegginson.github.io/ourairports-data/airports.csv | 机场→机位点位 → `enrich-stations.mjs` | **C** |
| EUMETSAT View | https://view.eumetsat.int/ | 仅 `probe-sources.mjs` 探测，**未接入** | **B** |
| OGIMET SYNOP | https://meteo.ogimet.com/cgi-bin/getsynop | ❌ **已否定为死路**：66 条报文只有 2 条带云组 | — |

---

## 三、摄影实践与本地调研（C 级，经验性但不可替代）

| 资料 | 位置 | 用在哪 |
|---|---|---|
| 摄影圈天象黑话调研（102 条，含 67 条可验证来源） | `research/jargon.md` / `jargon.json` | 站内 68 条天象词库（`data/forecast/phenomena.ts`）的母本 |
| 太阳光柱 / 云隙光判据调研 + SunsetBot 详情页对齐 | `research/rays.md` | 光柱/云隙光两个指数的窗口与阈值 |
| scoring.ts 阈值来源笔记（实现侧） | `research/scoring-thresholds.md` | 每个系数为什么取这个值、哪些"没做也别假装做了" |
| 免费气象数据源调研（五源实测） | `docs/阶段三-免费气象数据源调研.md` | 接新数据源前必读；含「谁唯一免费给三维云水」的结论 |
| 参考资料原文整理与可行性审查 | `docs/阶段六-00参考资料原文整理与可行性审查.md` | 光线几何引擎的资料底稿 |
| 平流雾调研（海南） | `docs/平流雾调研-海南.md` | `fog.ts` 五条判据、为什么硬门槛不参与百分比、SST 来源 |
| 卫星云顶高度可行性 | `docs/阶段七-03-卫星云顶高度-可行性落地.md` | GIBS 链路 + 官方调色板 |

---

## 四、⚠️ 本站实测反推值（**没有文献支撑，最需要标定**）

> **这一节是多个 AI 协作改进算法时的重点。** 这些数字不是从文献抄来的，
> 是「在硬约束下反推 / 经验估计」出来的。改它们**必须**跑对应的影响面测量。

| 参数 | 当前值 | 在哪 | 怎么来的 | 标定状态 |
|---|---|---|---|---|
| 中云画布折扣 `alpha` | **0.6** | `midcloud.ts` → `MID_CANVAS.alpha` | `tools/ab-midcloud.mjs` 扫 0.4/0.6/0.8：0.8 平均上浮 +1.12 超门槛；0.6 平均 +0.54、救起 8.9% 漏报 | ❌ 无观测标定（台账 `midcloud-calibrate`） |
| 中云「铺满」阈值 `fullCover` | 55% | 同上 | 按云量分布取的中位偏上 | ❌ 同上 |
| 中云「最低补充」`minCover` | 25% | 同上 | 低于此量不补（漏报优于误报） | ❌ 同上 |
| 云光学厚度代理 RH 阈值 | **92 / 85 / 76 / 66** | `midcloud.ts` | 气象上「无光学厚度数据时的标准替代做法」，但**未本地验证**；刻意往不透明方向取整 | ❌ 同上 |
| 云底照亮窗口置信度下限 | 0.65 | `baselit.ts` | 窗口越窄，小时级数据越担保不了 → 补得越少 | ❌ 同上 |
| 六档分界线 | 92 / 82 / 66 / 48 / 30 | `data/forecast/levels.ts` | 沿用 SunsetBot/莉景/Windy 分级被二次传播的数值，**各家阈值不同** | ⚠️ 约定值，非标定 |
| 区间形容词半径 | **±5** | `levels.ts` → `RANGE_DELTA` | 取半个档宽（最窄档 82→92 隔 10 分），保证不跨两条分界 | ⚠️ 约定值 |
| 分数压缩指数 | **1.8** | `scoring.ts` → `pow(raw, 1.8)` | 由文献 #1（TCC 0.47）与「宁可漏报」共同定 | ⚠️ 半经验，**属红线不许改** |
| 雾判据阈值 | T−Td ≤1.5 K / RH ≥93% / 风 2–8 m/s / 低云 ≥30% | `fog.ts` | 预测文档 §6.2 + 本次补充 | ❌ 无雾观测（台账 `fog-feedback-label`） |
| GFS 云判据阈值 | 10 mg/kg 等 | `clouds.ts` | 只在 1 天、冰云样本上标定过 | ❌ 季节/暖云适用性未知（台账 `tcdc-multiseason`） |

> **纪律**：这一节的任何数字被改动，提交信息必须写清「依据什么」「影响多少条」
> 「能否回滚」，并跑 `docs/ALGORITHM-COLLAB.md` 里对应的验证矩阵。

---

## 五、可信度分级（引用时必须标明）

| 等级 | 含义 | 能不能当"定律"用 |
|---|---|---|
| **A** | 同行评议期刊 / 国际权威机构标准（WMO、RMetS、经典教材） | ✅ 可以直接作为物理依据 |
| **B** | 权威机构的官方文档（NOAA、Open-Meteo、NASA、Copernicus） | ✅ 接口/定义可信；但它是「数据说明」，不是「霞光理论」 |
| **C** | 民间实践总结 / 摄影圈经验 / 二手转述（SunsetBot、黑话调研） | ⚠️ 只能作**启发式**，不能当准确率依据 |
| **D** | 本站实测反推 / 约定值 / 经验参数（第四节全部） | ❌ 只能说「当前取值」，**不许说「准确率」或「概率」** |

**红线**：
1. 任何 C/D 级依据，界面上都不许写成「概率」「准确率」「实测验证过」。
2. 文献 #1、#2 给的是「**预报有多不准**」，**不是**「火烧云概率模型」——
   那种论文目前几乎不存在，真正的验证只能靠回填的实际结果（见 `使用说明.md` 第八章）。
3. 引用外文文献时保留原文标题与年份，不要转述成看起来更权威的措辞。

---

## 六、怎么补充新文献

1. 优先找 **A 级**（期刊、WMO、经典教材）；找不到再退 B。
2. 每条必须写清「**用在哪**」——说不出用在哪，就不要收。
3. 新增文献要同时：
   - 加进本文件对应章节
   - 如果是用户可见的方法来源，同步 `src/components/forecast/References.vue`
   - 在 `research/scoring-thresholds.md` 里记它具体改了哪个系数
4. 找不到依据、只能靠经验的，**写进第四节的 D 级表**，不要伪装成 A 级。

---

## 七、按任务分的阅读路径（别全读，按需挑）

> 文献加起来 8000+ 行。**按你要做的事挑，不要通读。**

### 7.1 任何 AI 接手时（最低限度，约 20 分钟）

```
必读：本文件（114 行）全文  ← 你正在读的这份
必读：research/scoring-thresholds.md（68 行）← 每个系数为什么取这个值
选读：交接文档 §18（算法四项改进）、§38（中云画布）、§39（等级与区间）
```

### 7.2 要改「评分公式 / 分数分布」

```
必读：本文件第一节 #1 #2（TCC 0.47 → 为什么 1.8 次方；报晴≠真晴 → 为什么高云 0 不归零）
必读：本文件第四节 D 级表 ← 哪些参数根本没标定
必读：docs/ALGORITHM-COLLAB.md §1.3「想优化分数分布该动哪里」
必读：research/scoring-thresholds.md 全文
```

### 7.3 要做「天空霞 / 晴天霞光」（当前 WorkBuddy 的方向）

```
必读：本文件第一节 #3 #4（SunsetBot 速成：火烧云静态几何、AOD 对照表）
必读：本文件第一节 #12 #13（Bohren & Huffman 米散射、Petty 辐射传输）← 晴空为什么能发红光
必读：本文件第四节 ← 天空霞的判据全部是 D 级，必须自己标定
必读：docs/阶段六-00参考资料原文整理与可行性审查.md（275 行）← 光线几何资料底稿
选读：docs/analysis/sky-glow-literature.md（WorkBuddy 自己的调研，C 级以上）
```

### 7.4 要做「云隙光 / 光柱 / 冰晶光学」

```
必读：research/rays.md（200 行）全文 ← 窗口、阈值、各家来源
必读：本文件第一节 #9（Wikipedia 晕——冰晶取向决定光柱 vs 晕/幻日）
必读：本文件第一节 #10（RMetS 1986 云隙光个例）
必读：docs/阶段六-02大气光学实验室-技术设计.md（含"旧模拟器取向采样全错"的坑）
```

### 7.5 要做「云种判定 / 云属分类」

```
必读：本文件第一节 #5 #11（WMO Cloud Atlas：高度分界 + 云种命名）
必读：docs/阶段六-03litgeo-verify-验证报告.md（TCDC 阈值专项审查与更正）
注意：GFS 云阈值只在 1 天、冰云样本上标定过（台账 tcdc-multiseason）
```

### 7.6 要做「雾 / 平流雾」

```
必读：docs/平流雾调研-海南.md（306 行）全文
必读：本文件第一节 + 第四节雾判据那一行（全部无观测标定）
注意：硬门槛「冷面条件 Td > SST」不满足时显示「不满足」，不是百分比
```

### 7.7 要做「大气剖面 / 光照几何」

```
必读：docs/阶段五-02大气剖面-GFS数据管线与验证.md（298 行）
必读：docs/阶段七-01-太阳几何与照明引擎-实现报告.md（202 行）
必读：本文件第二节（GFS / DEM / AOD 数据源）
注意：剖面是独立解释层，不参与评分
```

### 7.8 要做「数据源接入」

```
必读：docs/阶段三-免费气象数据源调研.md（348 行）← 五个源全实测过
必读：本文件第二节（含哪些是死路：OGIMET SYNOP 已否定）
必读：docs/数据源核实-OpenMeteo实测.md（97 行）← 哪些字段实测是 null
```

---

## 八、学习验收：怎么证明你真的读懂了

> 要求任何 AI 在**改算法前**能回答下面 5 个问题（答不出说明没读）。

| # | 问题 | 答案在哪 |
|---|---|---|
| 1 | 文献 #1（CMA-BJ）说的是「预报有多不准」，它怎么导致我们要用 `pow(raw, 1.8)`？ | 本文件第一节 #1 + 交接文档 §18 |
| 2 | 为什么高云 0% 时不能硬性归零？ | 第一节 #2（MetCoOp：模式高估"无云"频率） |
| 3 | `α=0.6`、RH `92/85/76/66` 是 A 级文献值还是本站反推值？ | 第四节 D 级表（答案是：**反推，无标定**） |
| 4 | 想解决"分数太挤"，该动压缩指数还是上游画布？为什么？ | `docs/ALGORITHM-COLLAB.md` §1.3（**上游**，因为 65.5% 样本 raw=0，改指数无效） |
| 5 | 天空霞（clear-sky glow）当前有几条 A 级依据？ | 第四节（答案是：**0 条**，全部 C/D 级，必须自证） |

**答错任何一条 → 回去重读，别动代码。**

