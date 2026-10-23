# 太阳光柱 / 云隙光判据调研 + SunsetBot 详情页对齐

> 2026-10-23 联网调研。来源分三级：**①权威科普**（Atmospheric Optics、Met Office、科普中国）、**②业务系统**（SunsetBot）、**③商业 App 经验值**（PhotoWeather）。标「合成」的是我据来源推导的工程取值，不是原文结论；没有出处的写「未找到可靠来源」。
> 另：本文件上一版是 `scoring.ts` 的阈值笔记，可用 `git show HEAD:research/rays.md` 取回；两版取值差异见文末附录。

---

## A. 太阳光柱（sun pillar / 日柱）

### A.1 机制

片状（plate）冰晶下落时，空气阻力使其**最大基面趋于水平**并带 ±3°～±6° 晃动；阳光在上下基面间反射，**上柱**来自晶体下表面、**下柱**来自上表面。[Atoptics: Pillars](https://www.atoptics.org.uk/halo/pillar.htm)｜[Plate Pillars](https://www.atoptics.org.uk/halo/platpill.htm)

反直觉的一点：**晶体越歪，柱子越高**；光学质量差的晶体常常只剩柱子这一种晕。柱高常见 **5–10°**，偶尔更高，颜色随太阳/云从白到红紫。[Pillars](https://www.atoptics.org.uk/halo/pillar.htm)｜[Plate Pillars](https://www.atoptics.org.uk/halo/platpill.htm)

温度层：卷云/卷层云云底多在 6 km 以上、**低于 -20 ℃**；云底 < -38 ℃ 可判为纯冰云。地面很热不影响成柱（加州 6 月地面 90 ℉ 仍拍到柱），关键是高空温度。[SunsetBot 教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)｜[Desert Pillar](https://www.atoptics.org.uk/fz94.htm)

### A.2 太阳高度窗口（各来源的度数）

| 来源 | 结论 |
|---|---|
| [Atoptics: Pillars](https://www.atoptics.org.uk/halo/pillar.htm) | 日出/日落前后最佳；**日落后仍增强，并沿太阳方位持续 30–60 min** |
| [Atoptics: Solar Altitude](https://www.atoptics.org.uk/halo/pillalt1.htm) | 太阳几度高时上柱短淡、下柱强；太阳越低上柱越长越亮，日落时两柱等长；日落后西侧高空云仍被照亮，形成强上柱 |
| [Atoptics: Lower Pillars](https://www.atoptics.org.uk/halo/lowpill.htm) | 太阳 **9°** 高时仍拍到强下柱；下柱大部分在地平线以下 |
| [SunsetBot 教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/) | 经验上 **太阳高度 < 20°** 较易出柱 |
| [科普中国·曙暮光](https://cloud.kepuchina.cn/h5/detail?id=6974065631582232576) | 民用曙暮光终点为太阳中心 **-6°**，此后高空云基本失去直射照明 |

**合成判据**：窗口 **-6° ≤ h ≤ 20°**，最优 **-2°～+8°**。中纬日落时太阳高度变化率约 0.15–0.22°/min，30–60 min ≈ 地平线下 6–13°，与 -6° 下界自洽。

### A.3 云、温度与云量

- 云型：**卷云、卷层云最优**，其次高积云、高层云；**带落幡的高积云**特别容易出柱。
- 云底温度 **-10～-25 ℃** 易见柱，**-12～-18 ℃ 枝晶区（DGZ）** 最容易出好柱；云顶高于 **-40 ℃**（片晶区）更好。以上是站长个人观测经验，原文自称“不可靠”。[SunsetBot 教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)
- 云量区间与“多薄”**未找到可靠定量来源**；可操作近似：高云 20%–90%，全阴反而无对比。
- 增强项：**钻石尘**（近地面冰晶）产生强下柱与闪烁，滑雪场、寒潮后山谷冰雾最典型。[Diamond dust](https://www.atoptics.org.uk/halo/diamonds.htm)

### A.4 光照与遮挡

必须有直射阳光打到冰晶层；柱本身不要求云缝，但太阳被低云挡住即消失。低云遮挡是主要杀伤项（太阳方位 ±30° 内），**定量阈值未找到可靠来源**。日落后柱会随太阳“向北爬行”，眩光减弱也让它更明显。[Pillars](https://www.atoptics.org.uk/halo/pillar.htm)

### A.5 与 22° 晕、幻日、环天顶弧的关系

同一批冰晶，**取向与光路不同**（[SunsetBot 教程表 2.2](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)）：

| 现象 | 晶体 | 光源高度角 | 机制 |
|---|---|---|---|
| 环天顶弧 | 片晶 | 0°–32° | 折射 |
| 22° 幻日 | 片晶 | 0°–55° | 折射 |
| 22° 晕 | 柱晶 | 0°–90° | 折射 |
| 上/下切弧 | 柱晶 | 0°–35° | 折射 |
| **日柱** | **片晶（大幅倾斜）** | 日出日落附近 | **基面镜面反射** |

幻日/环天顶弧要晶体**整齐**，日柱要晶体**歪**，所以柱很亮时幻日往往不明显。

### A.6 拍摄（经验）

70–200 mm 长焦压缩竖直结构；对天空亮部测光，**-0.7～-1.3 EV**，ISO 100、f/5.6–8，包围 3 张。时段：日出前 20 min 至日出后 10 min、日落后 10–40 min。机位：海上/湖面、高原（AOD 低）、冬季寒潮后（钻石尘）。上海 2022-04-16 有日柱记录。[教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)

---

## B. 云隙光 / 丁达尔光 / 曙暮光条（crepuscular rays）

### B.1 机制与云型

阳光被云切成**平行光柱与平行阴影柱**，靠空气中的气溶胶/薄云散射才可见；光条看似从太阳发散是透视效应，靠近太阳处最明显（视线沿阴影长轴 + 大颗粒前向散射）。[Atoptics: Ray formation](https://www.atoptics.org.uk/atoptics/rayform.htm)｜[中国天气网](https://www.weather.com.cn/anhui/tqyw/03/2672753.shtml)

云型：**积云、层积云**最出效果（低空气溶胶多、边缘锐利）；高积云与卷云缝隙亦可，尤其“远处积雨云挡光 + 本地薄卷云”可拉出几十至几百 km 的长条。[SunsetBot 教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)

### B.2 太阳高度窗口

Met Office 只说**日出或日落**、阳光被云缝切开；中国天气网说多云天气常见、**晴朗日子常发生在日落时**。[Met Office](https://dev.weather.metoffice.gov.uk/learn-about/weather/optical-effects/crepuscular-rays)｜[中国天气网](https://www.weather.com.cn/anhui/tqyw/03/2672753.shtml)

几何上太阳越低、阴影柱越长越容易被看到；太阳高时阴影短而陡，被云自身遮住。[Ray formation](https://www.atoptics.org.uk/atoptics/rayform.htm)

**合成判据**：**-1° ≤ h ≤ 15°**，最优 **0°～6°**（日出后/日落前约 30 min）。原文没有统一度数，这是合成值。

### B.3 为什么 40%–60% 云量最好

经验区间：PhotoWeather 明确写 **partial cloud cover 40–70%** 最佳。[PhotoWeather](https://photoweather.app/guides/weather/light-breakthrough-potential/)

机理（合成，缝隙统计）：看到光条要同时满足 ①太阳方向有缝（概率随云量 f 下降）②缝旁有云影做对比（随 f 上升）③视线不被低云封死。三者相乘在 f≈0.5 取极大。云量 >80% 无直射光、<20% 没有云边缘。定性上“边缘密度 ∝ f(1-f)”也给出同样的 50% 峰。

### B.4 气溶胶 / 水汽 / 雾

必须有散射介质：尘埃、烟、干颗粒、薄雾；空气太干净则“光条不可见”（原文 *pristine clear air produces invisible rays*）。[Met Office](https://dev.weather.metoffice.gov.uk/learn-about/weather/optical-effects/crepuscular-rays)｜[PhotoWeather](https://photoweather.app/guides/weather/light-breakthrough-potential/)

太脏则整片发灰、对比消失。SunsetBot 的 AOD 分级：0.1–0.2 水晶天、0.3–0.5 普通、0.5–0.8 明显有霾、>0.8 污浊。[教程表 2.3](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)

**合成区间**：AOD(550 nm) **0.1–0.5**（最佳 0.2–0.4），能见度 **10–30 km**（<5 km 漫射、>40 km 光条过弱）。这组组合阈值没有原文，属工程取值。

### B.5 反云隙光

背对太阳，光条**汇聚于反日点**（antisolar point），本质仍是平行光柱的透视；反日点高度 = -h。[Atoptics: Anti-crepuscular](https://www.atoptics.org.uk/atoptics/anti1.htm)｜[MetService](https://about.metservice.com/learning/anti-crepuscular-rays)

条件：太阳低（同 B.2）、太阳侧有云缝、反日方向有云/尘做背景。并不罕见，“看到普通云隙光就转身找它的反面”。[Atoptics](https://www.atoptics.org.uk/atoptics/anti1.htm)

### B.6 拍摄（经验）

16–35 mm 收放射结构，或 24–70 mm；对天空亮部点测光，**-1～-2 EV**，包围曝光，遮光罩防眩。反云隙光要背对太阳、把反日点放画面上方。

---

## C. SunsetBot「预报详情」有什么

站点 [sunsetbot.top](https://www.sunsetbot.top/)（小程序同名）。`/halo/` 不是预报页，而是站长 sdc 的博客「天空的奇迹」（Pelican），有 22° 晕与火烧云教程，**没有日柱专文**。[归档](https://www.sunsetbot.top/halo/archives.html)

**访问限制**：`/detailed/` 与 JSON 接口当前报 `'NoneType' object is not iterable` / HTTP 500，无法实测渲染；“✅”指有官方页面、教程或第三方测评文字佐证。

| 项目 | 结论 | 确认度 | 证据 |
|---|---|---|---|
| 云量分层 | 数据按**高云/中云/低云**三层（GFS/EC 云量产品原生分层，教程通篇用这三层） | ⚠️ 部分 | [教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/) |
| 每层名称 | 高云、中云、低云，无更细云属 | ⚠️ 部分 | 同上 |
| 云种 | **预报不输出 cirrus/altocumulus**；云属只出现在 `/record/` 人工记录（“高积云”“层云”“密卷云，积云”） | ❌ 预报 / ✅ 记录 | [记录页](https://www.sunsetbot.top/record/) |
| 云底高度 | 参与“鲜艳度”计算；详情页以**大气截面图**呈现垂直分布，无独立数值字段证据 | ⚠️ 部分 | [首页](https://www.sunsetbot.top/)｜[测评](https://www.shephe.com/post/sunsetbot-predict-sunset-glow-tool/) |
| 云顶高度 | 同上，截面图可见、无字段 | ❌ | 同上 |
| AOD | ✅ 首页独立“气溶胶”项 + 分级说明 | ✅ | [首页](https://www.sunsetbot.top/) |
| 能见度 / 降水概率 | 未找到 | ❌ | — |
| 火烧云指数 | ✅ 名“**鲜艳度**”，0–2.5+，8 档（微微烧→世纪大烧） | ✅ | [首页](https://www.sunsetbot.top/)｜[测评](https://www.shephe.com/post/sunsetbot-predict-sunset-glow-tool/) |
| 不确定性 | 首页写“见专业版”；详情页有**分位数图** | ✅ | 首页｜测评 |
| 文字解读 | 后端字段 `img_summary` 存在，当前返回“没有该时次的预报”占位，**未取得真实文案** | ⚠️ | 接口实测 |
| 数据来源 | **NCEP-GFS + ECMWF + CAMS**（云况用 GFS/EC，霾用 CAMS），**不是 CMA** | ✅ | [首页](https://www.sunsetbot.top/)｜[测评](https://www.shephe.com/post/sunsetbot-predict-sunset-glow-tool/) |

详情页展示：**趋势图、分位数图、邻近城市对比表、大气截面图**（判断高/低云是否挡光）。GFS 每日 4 次（大更新 7:30–8:30、19:30–20:30；13:30/1:30 仅中东部与东北）；EC 中东部每日 4 次（4/10/16/22 时）。[测评](https://www.shephe.com/post/sunsetbot-predict-sunset-glow-tool/)｜[首页](https://www.sunsetbot.top/)

「鲜艳度」官方输入：持续时间、亮度与颜色、云量（格点云量、相态、含水量）、占天空面积、云底高度、层间照明/遮挡、AOD/浑浊度（或雾）。[首页](https://www.sunsetbot.top/)

> 对齐建议：最小可用字段 = **指数 + AOD + 分模型(GFS/EC) + 不确定性**；云种、能见度、降水概率需自建，SunsetBot 没有。

---

## D. 可落地的判据建议

`h` 太阳几何高度（°，地平线下为负）；`f_*` 云量 0–1；`T_base/T_top` ℃；`AOD` 550 nm；`vis` km；`ramp(x,a,b)` 为 [a,b] 上 0→1 线性。

### D.1 光柱指数

| # | 判据 | 取值 | 依据 |
|---|---|---|---|
| P1 | 太阳高度 | `-6 ≤ h ≤ 20`，窗外置 0 | [Atoptics](https://www.atoptics.org.uk/halo/pillar.htm)｜[科普中国](https://cloud.kepuchina.cn/h5/detail?id=6974065631582232576) |
| P2 | 高度权重 | `w_alt = ramp(h,-6,-2)*(1-ramp(h,12,20))` | 合成（日落后增强 + <20°） |
| P3 | 高云量 | `w_high = ramp(f_high,0.1,0.3)*(1-ramp(f_high,0.85,1.0))` | 经验，无定量来源 |
| P4 | 云底温度 | `[-25,-10]`→1；`[-18,-12]`→×1.2；`<-35` 或 `>0`→0 | [教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/)（站长经验） |
| P5 | 云顶温度 | `T_top > -40`（片晶区）→×1.1；`T_base ≤ -38` 判为冰云 | 同上 |
| P6 | 低云遮挡 | 太阳方位 ±30° 内 `f_low>0.3` 起罚，`>0.6`→0：`×(1-0.8*ramp(f_low,0.3,0.6))` | 经验 |
| P7 | AOD 惩罚 | `<0.3`→1；`0.3–0.6`→0.6；`>0.6`→0.3 | [教程 AOD 表](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/) |
| P8 | 钻石尘 | `T2m<-15 且 RH>80%` → `+0.2`（上限 1） | [Diamond dust](https://www.atoptics.org.uk/halo/diamonds.htm) |

```python
def pillar_score(h, f_high, f_low_sun, T_base, T_top, aod, T2m, rh):
    if not (-6 <= h <= 20): return 0.0
    w  = ramp(h, -6, -2) * (1 - ramp(h, 12, 20))
    w *= ramp(f_high, 0.1, 0.3) * (1 - ramp(f_high, 0.85, 1.0))
    w *= 1.2 if -18 <= T_base <= -12 else (1.0 if -25 <= T_base <= -10 else 0.0)
    w *= 1.0 if T_base <= -38 else 0.8          # 冰云置信
    if T_top > -40: w *= 1.1                    # 片晶生长区
    w *= 1 - 0.8 * ramp(f_low_sun, 0.3, 0.6)    # 低云挡光
    w *= 1.0 if aod < 0.3 else (0.6 if aod < 0.6 else 0.3)
    if T2m < -15 and rh > 80: w = min(1.0, w + 0.2)
    return round(w, 3)
```

### D.2 云隙光指数

| # | 判据 | 取值 | 依据 |
|---|---|---|---|
| C1 | 太阳高度 | `-1 ≤ h ≤ 15`；`w_alt = ramp(h,-2,0)*(1-ramp(h,8,15))` | [Met Office](https://dev.weather.metoffice.gov.uk/learn-about/weather/optical-effects/crepuscular-rays) + 合成 |
| C2 | 总云量 | `w_frac = ramp(f,0.25,0.45)*(1-ramp(f,0.75,0.95))`，峰 **0.45–0.75** | [PhotoWeather 40–70%](https://photoweather.app/guides/weather/light-breakthrough-potential/) |
| C3 | 云型 | 低/中云（积云、层积云、高积云）1.0；纯卷云缝隙 0.6 | [教程](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/) |
| C4 | 缝隙邻近 | 云边界方位距太阳 `<30°` 且云顶 1–6 km → 1.0，否则 0.5 | 合成（阴影几何） |
| C5 | 低云封地平线 | 太阳方位 ±20° 内 `f_low > 0.6` → 0 | 经验 |
| C6 | 散射介质 | `0.1 ≤ AOD ≤ 0.5`→1；`<0.05`→×0.3；`>0.8`→×0.2 | [Met Office](https://dev.weather.metoffice.gov.uk/learn-about/weather/optical-effects/crepuscular-rays)｜[PhotoWeather](https://photoweather.app/guides/weather/light-breakthrough-potential/)｜[AOD 表](https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/) |
| C7 | 能见度 | `10–30 km`→1；`<5`→0；`>40`→×0.6 | 合成 |

```python
def ray_score(h, f_total, f_low_sun, aod, vis, cloud_top_km, d_az_to_sun):
    if not (-1 <= h <= 15): return 0.0
    w  = ramp(h, -2, 0) * (1 - ramp(h, 8, 15))
    w *= ramp(f_total, 0.25, 0.45) * (1 - ramp(f_total, 0.75, 0.95))
    w *= 1.0 if 1 <= cloud_top_km <= 6 else 0.5
    if d_az_to_sun > 30: w *= 0.5
    if f_low_sun > 0.6: return 0.0
    w *= 1.0 if 0.1 <= aod <= 0.5 else (0.3 if aod < 0.05 else 0.2)
    w *= 1.0 if 10 <= vis <= 30 else (0.0 if vis < 5 else 0.6)
    return round(w, 3)

def anti_ray_score(h, f_anti, f_low_anti, aod, vis, top_km):
    return ray_score(h, f_anti, f_low_anti, aod, vis, top_km, d_az_to_sun=0)
```

### D.3 三条落地提醒

1. **两个现象物理上独立**：光柱要冰晶 + 高空低温云，云隙光要液态云边缘 + 气溶胶。同一片天可以只有其一，别用一个指数硬套。
2. **“低云不挡地平线”是共同前提**：都先检查太阳方位 ±30° 的低云，否则指数虚高。
3. **AOD 方向相反**：光柱要低 AOD（通透、对比强），云隙光要适中 AOD（有散射介质）。建议分别用 `1/(1+AOD)` 与 `AOD*exp(-AOD)` 形状的核。

---

## 附录：与旧 `scoring.ts` 笔记的差异

旧版取值（`git show HEAD:research/rays.md`）：光柱 `h ∈ [-8°,+5°]`、高空云 10–60%、低云 <15% 满分；云隙光 `h ∈ [-6°,+4°]`、云量 40–60%、AOD<0.08 打 0.65 折。本文据 Atoptics/SunsetBot 把光柱上界放宽到 **+20°**（太阳 9° 高仍有强下柱、<20° 经验），把云隙光下界收到 **-1°**（需直射光），并给出 AOD 两侧都能罚的 V 形核。旧版“边缘密度 ∝ 4c(1-c)”的 50% 峰与本文一致，可保留。
