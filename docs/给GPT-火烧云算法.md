# 火烧云评分算法 · 单一文件版（给 GPT 用）

把你想要 GPT 做的事贴在下面这段之前，然后整份文件内容一起贴给它可以了。

> **给你的三种用法（挑一段贴在文件前面）**
>
> - 想让它**读懂并解释**：「下面是一套摄影用的火烧云评分算法。读完后用中文解释它的结构、每个因子的作用和设计取舍，不要改代码。」
> - 想让它**移植**：「下面这套算法要移植到 <语言/平台>。要求：逐行保持数值等价，不要"优化"公式，移植后必须用文末的自测表验证，结果要逐个对上。」
> - 想让它**评审**：「下面这套算法的阈值是启发式推出来的、没有回测。请指出你认为最不可靠的三个假设，并说明你会用什么数据检验它。不要直接改代码。」

---

## 0. 它是什么（**先看这段，别当天气预报**）

输入**某地某时刻的三层云量、气溶胶光学厚度、降水概率、湿度**，
输出 **0–96 的「霞光指数」**，映射成六档：火烧云 / 大烧 / 中烧 / 小烧 / 微烧 / 不烧。

用途是**「这个黄昏值不值得专门跑一趟机位」的排序工具**，不是气象预报。
输出是相对排序，绝对值不可当真——气象模式对 1 天后的云量预报，相关系数只有 **0.47**。

**出处**：算法由项目原开发者在另一套环境完成，本文件是对现有源码的抽取与核对，
代码已用 20 万组随机输入与源码逐点比对，数值完全一致。

---

## 1. 完整代码（纯 JS，零依赖，可直接跑）

```js
/* ===== 工具 ===== */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

/* ===== 气溶胶分级（550 nm AOD）=====
   数值来自 SunsetBot 团队公开的对照表 */
const AOD_BANDS = [
  { max: 0.1,      name: '水晶天', v: 1.00 },
  { max: 0.2,      name: '湛蓝',   v: 0.97 },
  { max: 0.3,      name: '较蓝',   v: 0.92 },
  { max: 0.5,      name: '普通',   v: 0.80 },
  { max: 0.8,      name: '有霾',   v: 0.55 },
  { max: Infinity, name: '污烧',   v: 0.30 }
]
function aodBand(a) {
  for (const b of AOD_BANDS) if (a <= b.max) return b
  return AOD_BANDS[AOD_BANDS.length - 1]
}

/* ===== 五个因子，全部归一到 0–1 ===== */

/* 高云是「画布」。最佳 55–78%：太少没东西烧，太厚挡光 */
function fHigh(h) {
  if (h < 8) return 0                        // 几乎无高云 → 无画布
  if (h <= 55) return (h - 8) / 47           // 缓坡：8%→0，55%→1
  if (h <= 78) return 1                      // 最佳窗口
  return 0.25 + 0.75 * (100 - h) / 22        // >78% 多为厚层云
}

/* 低云挡地平线，越少越好 */
function fLow(l) { return clamp(1 - l / 82, 0, 1) }

/* 中云适中最好，太厚会盖住 */
function fMid(m) { return m <= 55 ? 1 : clamp(1 - (m - 55) / 40, 0, 1) }

/* 气溶胶通透度 */
function fAod(a) { return aodBand(a).v }

/* 下雨、起雾都不利 */
function fWet(pop, rh) {
  const p = pop < 40 ? 1 : pop < 70 ? 0.62 : 0.22
  const r = rh > 93 ? 0.5 : rh > 88 ? 0.78 : 1
  return p * r
}

/* ===== 核心评分 ===== */
function scoreOf(m) {
  // 缺数据一律按「最不利」处理：宁可低估，也不虚高
  const high = m.high == null ? 90 : m.high
  const mid  = m.mid  == null ? 60 : m.mid
  const low  = m.low  == null ? 70 : m.low
  const pop  = m.pop  == null ? 60 : m.pop
  const rh   = m.rh   == null ? 90 : m.rh

  const h = clamp(fHigh(high), 0, 1)
  if (h <= 0) return 0

  // 注意是乘法，不是加权平均（原因见 §4.1）
  const lowF = 0.30 + 0.70 * fLow(low)
  const midF = 0.72 + 0.28 * fMid(mid)
  const aodF = 0.55 + 0.45 * fAod(m.aod ?? 0.4)
  const wetF = 0.55 + 0.45 * fWet(pop, rh)

  const raw = h * lowF * midF * aodF * wetF
  const score = 100 * Math.pow(clamp(raw, 0, 1), 1.8)   // 1.8 次方整体压缩
  return Math.round(Math.min(96, score))                // 封顶 96
}

/* ===== 六档（本站口径，别家阈值不同，不可直接对比）===== */
const LEVELS = [
  { min: 92, name: '火烧云' }, { min: 82, name: '大烧' },
  { min: 66, name: '中烧' },   { min: 48, name: '小烧' },
  { min: 30, name: '微烧' },   { min: 0,  name: '不烧' }
]
function levelOf(score) {
  for (const l of LEVELS) if (score >= l.min) return l
  return LEVELS[LEVELS.length - 1]
}

/* ===== 太阳位置（NOAA 低精度解析式，纯几何）===== */
function sunPosition(timeMs, latDeg, lonDeg) {
  const rad = Math.PI / 180
  const n = timeMs / 86400000 + 2440587.5 - 2451545.0

  const L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360
  const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360
  const lambda = (L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad)) * rad
  const eps = (23.439 - 0.0000004 * n) * rad

  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360
  const lst = ((gmst + lonDeg) % 360 + 360) * rad
  const ha = lst - ra

  const latR = latDeg * rad
  let sinEl = Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha)
  sinEl = clamp(sinEl, -1, 1)

  const el = Math.asin(sinEl)
  const cosEl = Math.cos(el) || 1e-6
  const sinA = -Math.cos(dec) * Math.sin(ha) / cosEl
  const cosA = (Math.sin(dec) - sinEl * Math.sin(latR)) / (cosEl * Math.cos(latR))
  let az = Math.atan2(sinA, cosA) / rad
  if (az < 0) az += 360

  return { el: el / rad, az }   // 度；az 正北 0°，顺时针
}

/* ===== 机位朝向：太阳不在你能看见的方向，分再高也拍不到 ===== */
const FACE_AZ = { 西: 270, 西南: 235, 南: 180, 东南: 135, 东: 90, 西北: 305, 北: 0 }
function faceMatch(face, az) {
  const center = FACE_AZ[face]
  if (center == null) return 0.9            // 山顶等不限方向
  let d = Math.abs(((az - center) % 360 + 360) % 360)
  if (d > 180) d = 360 - d
  return 0.55 + 0.45 * clamp(1 - d / 110, 0, 1)
}

/* ===== 高空湿度剖面修正（各气压层相对湿度判云在哪层）=====
   850 hPa≈1500 m、700≈3000 m、500≈5500 m、400≈7200 m
   blh = 边界层高度（m） */
function profileMod(rh850, rh700, rh500, rh400, blh) {
  const lowWet  = rh850 != null && rh850 >= 80
  const midWet  = rh700 != null && rh700 >= 80
  const highWet = (rh500 != null && rh500 >= 60) || (rh400 != null && rh400 >= 60)

  let mod
  if (lowWet && highWet) mod = 0.72   // 低云封挡，高云被遮
  else if (lowWet)       mod = 0.82   // 低层潮湿，地平线不清
  else if (highWet)      mod = 1.10   // 高层有云、低层干爽（唯一加分项）
  else if (midWet)       mod = 0.95   // 中层有云，高层偏干
  else                   mod = 0.90   // 各层偏干，本就不易有霞

  if (blh != null && blh < 350 && mod > 0.7) mod *= 0.94   // 边界层浅 → 霾贴地
  return mod
}

/* ===== 完整流水线（scoreOf 只是第一步）=====
   perModel: 各模式的分数数组（如 [78,60,42]）；只有一个模式就传 null
   smoothing: [前一小时, 本小时, 后一小时] 的 scoreOf，可省略 */
function finalScore({ m, perModel, smoothing, sun, face, profMod, isTomorrow }) {
  const s1 = scoreOf(m)
  const sp = smoothing ?? [s1, s1, s1]

  // ② 逐时平滑，避免整点之间跳变
  let score = 0.25 * sp[0] + 0.5 * sp[1] + 0.25 * sp[2]

  // ③ 模式分歧越大越不可信 → 打折（最多扣 28%）
  if (perModel && perModel.length > 1) {
    const mean = perModel.reduce((a, b) => a + b, 0) / perModel.length
    const varr = perModel.reduce((a, b) => a + (b - mean) ** 2, 0) / perModel.length
    const spread = Math.round(Math.sqrt(varr))
    score = score * (1 - Math.min(0.28, spread / 55))
  }

  // ④ 朝向
  if (sun) score = Math.round(score * (face ?? 1))

  // ⑤ 剖面
  if (profMod && profMod !== 1) score = clamp(Math.round(score * profMod), 0, 100)

  // ⑥ 时效折扣：明天 ×0.95
  if (isTomorrow) score = Math.round(score * 0.95)

  // ⑦ 封顶
  return Math.round(clamp(score, 0, 96))
}
```

---

## 2. 输入契约

```js
Measure = {
  high: number|null,  // 高云量 % (0–100)
  mid:  number|null,  // 中云量 %
  low:  number|null,  // 低云量 %
  rh:   number|null,  // 2 m 相对湿度 %
  pop:  number|null,  // 降水概率 %
  aod:  number        // 550 nm 气溶胶光学厚度，必填（无量纲，典型 0.05–1.5）
}
```

`null` 表示**没有数据**，不表示 0——`scoreOf` 里有专门的保守填充。
`t2m / td2m / vis`（气温/露点/能见度）只在别的指标里用，**评分不需要**。

---

## 3. 全部阈值一览（要调参就改这里）

| 位置 | 阈值 | 含义 |
|---|---|---|
| `fHigh` | 8 / 55 / 78 / 100 | 无画布 / 缓坡起点 / 最佳窗口上沿 / 厚云 |
| `fLow` | 82 | 低云到 82% 时完全挡死地平线 |
| `fMid` | 55 / 95 | 55% 以内不扣分；95% 时归零 |
| `AOD_BANDS` | 0.1 / 0.2 / 0.3 / 0.5 / 0.8 | 水晶天 / 湛蓝 / 较蓝 / 普通 / 有霾 |
| `fWet` | 40 / 70；88 / 93 | 降水概率拐点；湿度拐点 |
| `scoreOf` | 1.8 次方；上限 96 | 整体压缩指数；分制上限 |
| 缺数据填充 | 90 / 60 / 70 / 60 / 90 | high/mid/low/pop/rh |
| 平滑 | 0.25 / 0.5 / 0.25 | 前一小时 / 本小时 / 后一小时 |
| 模式分歧 | 28%；分母 55 | 最多扣 28%，spread=55 时扣满 |
| `faceMatch` | 110°；0.55 下限 | 偏离超过 110° 打到底 |
| `profileMod` | 0.72 / 0.82 / 1.10 / 0.95 / 0.90 | 五种湿度剖面的修正系数 |
| 时效 | 0.95 | 次日折扣 |

---

## 4. 三个最容易做错的地方

### 4.1 必须是乘法，不能是加权平均
早期版本用 `0.35*高云 + 0.25*低云 + 0.2*中云 + …` 的加权和，结果**海南任何晴天都给 90 分以上**。
因为低云、中云、AOD 在多数日子都是"还不错"的中间值，加权和把它们平均掉，分数几乎只跟着高云量走。

同一组输入（高云 70 / 中云 10 / 低云 10 / AOD 0.1 / 无雨）：

| 公式 | 得分 |
|---|---|
| 旧加权平均 | **97**（"大烧"） |
| 现乘法 + 1.8 次方 | **85**（"中烧"） |

乘法的作用是：**任何一项差都会把总分整体压下去，不会被别的项补回来。**

### 4.2 `null` 不能当 0
`high = null` 时如果按 0 算，`fHigh(0) = 0` → 直接 0 分，
但实际上"模式没给数据"不等于"天上没云"。所以缺数据按最不利值填充，走完整个公式。

### 4.3 别忘了 `scoreOf` 之后还有四层压制
只搬 `scoreOf()` 会系统性偏高。用真实缓存数据实测（2026-10-24 那次）：

| 机位 | 只看 `scoreOf` | 完整流水线后 | 差额 |
|---|---|---|---|
| 临高角 | 84 | **51** | −33 |
| 海口西海岸观海台 | 81 | **46** | −35 |
| 乐东龙沐湾 | 79 | **55** | −24 |

差额主要来自**模式分歧打折**（spread 32–35 时扣满 28%）和剖面修正。

#### 一个可复算的完整示例

| 步骤 | 计算 | 结果 |
|---|---|---|
| 输入 | 高云 62 / 中云 20 / 低云 8 / AOD 0.12 / 降水 5% / 湿度 70% | — |
| ① `scoreOf` | — | **86** |
| ② 三模式 `[78, 60, 42]` | 均值 60，spread = 15，折扣 `1−15/55 = 0.7273` | 62.55 |
| ③ 朝向 | 太阳方位 258.3°，机位朝西南 → `faceMatch = 0.905` | **57** |
| ④ 剖面 | 低层潮湿 `0.82` | **47** |
| ⑤ 时效 | 今天（不打折） | 47 |
| 最终 | 封顶 96 | **47（小烧）** |

---

## 5. 自测表（移植后必须逐行对上）

输入格式：`高/中/低云, AOD, 降水%, 湿度%`，`null` 表示缺数据。

| 用例 | 输入 | `scoreOf` | 等级 |
|---|---|---|---|
| 教科书级大烧 | 62/20/8, 0.12, 5, 70 | **86** | 大烧 |
| 晴空无云 | 3/5/10, 0.1, 0, 60 | **0** | 不烧 |
| 薄卷云偏少 | 20/10/15, 0.15, 0, 65 | **7** | 不烧 |
| 云量最佳窗口 | 66/30/12, 0.18, 0, 72 | **80** | 中烧 |
| 低云封地平线 | 60/20/80, 0.2, 10, 85 | **12** | 不烧 |
| 厚云阴天 | 95/85/90, 0.4, 70, 92 | **1** | 不烧 |
| 有霾 | 60/20/10, 0.85, 5, 70 | **43** | 微烧 |
| 高云过厚 | 92/40/20, 0.25, 10, 78 | **21** | 不烧 |
| 全部缺数据 | null/null/null, 0.2, null, null | **4** | 不烧 |

其他可直接核对的值：

| 项 | 输入 | 期望输出 |
|---|---|---|
| `sunPosition` | 海口 20.05°N, 110.30°E, 2026-10-24 18:16 (+08:00) | `el = -2.42`, `az = 258.29` |
| `faceMatch` | 朝西南，太阳方位 258.29° | `0.905` |
| `profileMod` | rh850=85, rh700=60, rh500=40, rh400=30, blh=800 | `0.82` |
| `profileMod` | rh850=60, rh700=50, rh500=70, rh400=65, blh=800 | `1.10` |
| `profileMod` | rh850=85, …, blh=300（边界层浅） | `0.7708` |

> 只要实现与本文一致，这些数字应当**逐个完全相同**。对不上说明有地方被"优化"了。

---

## 6. 已知局限（照实说，不要包装）

| 限制 | 后果 |
|---|---|
| 没有云底高度、云水含量、云的相态（冰/水） | 分不清"薄卷云"和"厚高积云"的透光差异 |
| 模式网格 6–28 km | 同一城市多个机位共享一份数据，数值相同是正常的 |
| 云量 1 天时效 TCC ≈ 0.47 | 只能当相对排序，绝对值不可当真 |
| **全部阈值未做回测** | 是"物理原理 + 摄影经验"的启发式，不是拟合结果 |
| 气溶胶分辨率更粗 | 山区局地霾判断不了 |

**使用建议**：界面上写明「仅供参考」；对外不要承诺准确率；
宁可在"85 分"时说不确定，也不要在"95 分"时打包票。

---

## 7. 参考

1. 张帅 等. CMA-BJ 系统总云量预报性能检验评估[J]. 气象, 2024, 50(9): 1057–1070.
   DOI: 10.7519/j.issn.1000-0526.2024.063001 → 1 天 TCC 0.47、技巧上限 48–72 h
2. MetCoOp (Met Norway). *Verification of cloud forecasts*, 2012 → 模式高估「无云」频率
3. SunsetBot 团队.《火烧云定量预报速成》→ 几何模型、瑞利/米散射、AOD 对照表
4. WMO. *International Cloud Atlas*, 2017 → 云属定义与高度分界
5. Open-Meteo 文档 → 预报变量定义
6. Bohren & Huffman. *Absorption and Scattering of Light by Small Particles*, Wiley, 1983
