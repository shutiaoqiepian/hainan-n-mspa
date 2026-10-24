/**
 * 把「给 GPT / 其他模型做代码级审查」所需的源码打包成一个可粘贴的 Markdown。
 *
 * 为什么需要：网页版 GPT 只能接收粘贴文本或上传文件；
 * 逐个上传 6 个文件容易漏、也容易让它只看片段就下结论。
 * 这里按顺序拼成一份，带文件头、行号区间说明和「不可改动的部分」警告。
 *
 * 用法：
 *   node tools/bundle-for-review.mjs
 * 输出：docs/给GPT-源码包-可粘贴.md
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs', '给GPT-源码包-可粘贴.md')

/** 顺序有意义：先类型与常量，再评分，再取数，再云与解读 */
const FILES = [
  'src/lib/forecast/types.ts',
  'src/data/forecast/levels.ts',
  'src/lib/forecast/scoring.ts',
  'src/lib/forecast/api.ts',
  'src/lib/forecast/clouds.ts',
  'src/lib/forecast/interpret.ts',
  'src/lib/forecast/feedback.ts'
]

const HEADER = `# 火烧云预报 · 源码包（可整份粘贴给 GPT）

> 仓库：https://github.com/shutiaoqiepian/hainan-n-mspa　（代码 GPL-2.0，可公开传阅）
> 生成时间：${new Date().toISOString().slice(0, 10)}
>
> ## 给模型的话（贴的时候一起贴）
>
> 你要审查的是**一个已经上线运行**的霞光预报模块。请遵守三条：
>
> 1. **\`scoreOf()\` 的公式和阈值不要直接替换。** 它们未经回测，但也没有证据表明你的改法更好。
>    要改就写成**候选实现**（新函数/新文件），并在同一批输入上与基线并列对比，而不是覆盖。
> 2. **不要声称"准确率提高"。** 这个项目**没有任何带真实观测的标签数据**，
>    唯一的真值源是机场 METAR 的云量实况（只能判断"有没有画布"，判断不了"烧得好不好看"）。
>    没有标签就不可能有准确率，任何这方面的结论都是编的。
> 3. **区分"天气不好"和"没数据"。** 这两个在现有代码里被混在一起了（见下方已知问题），
>    改的时候请显式分开。
>
> ## 已知问题（我已经审计过，不用重复发现）
>
> | 编号 | 问题 | 位置 |
> |---|---|---|
> | P0 | 缺测时用固定不利值填充（90/60/70/60/90），界面看不出"没数据" | \`scoring.ts\` \`scoreOf()\` |
> | P0 | AOD 有两套默认值：\`api.ts\` 用 0.2，\`scoring.ts\` 用 0.4 | 两处 |
> | P1 | 阈值跳变：降水跨 40% 分数跳 25 分，湿度跨 93% 跳 17 分 | \`fWet\` |
> | P1 | 机位朝向直接乘进总分，事件概率与出片机会混算 | \`api.ts\` \`compute()\` |
> | P1 | 缓存过期与请求失败共用一个错误出口 | \`api.ts\` \`loadStatic()\` |
> | P2 | 云属推断只用两个阈值，却输出 11 种云属 + 具体云底/云顶米数 | \`clouds.ts\` |
> | P2 | \`canvasFactor()\` 已实现但全仓库无调用点（死代码） | \`clouds.ts\` 末尾 |
> | P2 | 平滑权重 0.25/0.5/0.25 会把单小时的 100 分削到 50 分 | \`api.ts\` \`compute()\` |
>
> ## 我希望你产出什么（按优先级）
>
> 1. **能立即合并、不改分数的改进**：类型更严、边界测试、\`canvasFactor\` 的死代码处理建议、
>    把"缺测"与"天气差"在类型层面分开的具体类型设计。
> 2. **阈值连续化的候选实现**：把 \`fWet\`/\`fAod\` 的分段常数改成单调插值，
>    并且**校准到与原实现同均值**（给出校准步骤，不要只给公式）。
> 3. **单元测试**：覆盖 null / 0 / 100 / NaN / 极端值；给出期望值。
> 4. 只有在你确认上面都做完之后，才讨论更换评分结构。

## 文件清单
`

async function main() {
  const parts = [HEADER]

  for (const rel of FILES) {
    const text = await readFile(path.join(ROOT, rel), 'utf8')
    const lines = text.split('\n').length
    parts.push('\n---\n\n### `' + rel + '`（' + lines + ' 行）\n\n```ts\n' + text.replace(/\s*$/, '') + '\n```\n')
  }

  parts.push(`
---

## 附：现有实现的自测期望值（用来验证你没有改坏）

\`\`\`
输入格式：高云/中云/低云, AOD, 降水%, 湿度%   →  scoreOf()

62/20/8,   0.12, 5,  70   →  86
3/5/10,    0.10, 0,  60   →   0
20/10/15,  0.15, 0,  65   →   7
66/30/12,  0.18, 0,  72   →  80
60/20/80,  0.20, 10, 85   →  12
95/85/90,  0.40, 70, 92   →   1
60/20/10,  0.85, 5,  70   →  43
92/40/20,  0.25, 10, 78   →  21
null/null/null, 0.2, null, null  →  4
\`\`\`

任何"改进版"都必须能解释：为什么在某些用例上数值变了、变的方向是否符合物理直觉。
如果只是让分数"看起来更合理"，那不是改进。

## 附：这个项目已验证过的事（不用再查）

- 太阳位置函数：与 Open-Meteo 的 sunrise/sunset 比对 48 组样本，**平均差 0.55 分钟，最大 1.22 分钟**，实现无误。
- Open-Meteo **没有**云光学厚度 / 云顶高度 / 云相态变量（实测请求返回 \`Invalid value\`），
  所以"加入云微物理特征"在这个数据源下不可实现。
- 中国地面站 SYNOP 在 Ogimet 上**不报总云量**（抽样 8 站全部缺报），云属编码 CL/CM/CH 取不到。
`)

  await writeFile(OUT, parts.join(''), 'utf8')
  const bytes = (await readFile(OUT)).length
  console.log('写入 ' + path.relative(ROOT, OUT))
  console.log('大小 ' + Math.round(bytes / 1024) + ' KB，约 ' + Math.round(bytes / 2.2) + ' tokens（中文偏多，粗估）')
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })
