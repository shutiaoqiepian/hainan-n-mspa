/**
 * 预测页文案自检（跑在 node 里，不需要浏览器）。
 *
 *   node tools/test/text-lint.mjs
 *
 * 为什么要有它：2026-11-05 用户报「预测页描述语言很多纰漏」，
 * 一次扫出 7 类问题，全部是**不会报错、只能靠人眼发现**的那种：
 *   1) 「地平线略毛」—— 圈内口语，不是可验证的判据
 *   2) 「高云落在 40–80% 理想区间」—— 代码里真正满分是 55–78%
 *   3) pros 说「地平线干净」、headline 说「低云是主要短板」—— 同一段话自相矛盾
 *   4) 「日出后 10 分钟内的回光」—— 回光返照只在日落后出现，物理错误
 *   5) headline 和 advice 都写「重点赌云缝」—— 重复
 *   6) 「系数 0.85」—— 页面上从没解释过这个数是什么意思
 *   7) 「太阳沉入海面」—— 全国 224 机位含 24 个山顶机位和大量内陆机位
 *   8) 「积云会烧成湛蓝」—— 湛蓝是晴空底色，低云只会成剪影
 *
 * 这些用类型检查和构建都发现不了，所以单独做一次穷举扫描。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = await build({
  entryPoints: [path.join(ROOT, 'src/lib/forecast/interpret.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node',
  alias: { '@': path.join(ROOT, 'src') }
})
const { interpret } = await import(
  'data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'))

const mk = (o) => ({
  kind: 'sunset', score: 60, levelName: '小烧',
  m: { high: 50, mid: 20, low: 18, aod: 0.2, pop: 10, rh: 75, vis: 20, t2m: 26 },
  sun: { el: -1, az: 253 }, spread: 4, faceOff: false, face: '西',
  cloudBaseLow: 1200, layers: [], cape: 300, day: 0, ...o
})

const problems = []
const push = (label, kind, detail) => problems.push({ label, kind, detail })

function scan(label, res) {
  const all = [res.headline, res.advice, ...res.pros, ...res.cons].join(' ')
  if (/略毛/.test(all)) push(label, '口语', '含「略毛」')
  if (/海面|海边|靠海/.test(all)) push(label, '地形预设', '含「海面/海边/靠海」')
  if (/系数 \d\./.test(all)) push(label, '术语未解释', '含裸「系数 0.x」')
  if (/理想 40–80|40–80% 的理想/.test(all)) push(label, '区间不符', '高云理想区间应为 55–78%')
  if (/地平线干净|基本不挡/.test(all) && /短板是低云|低云遮挡（/.test(res.headline)) {
    push(label, '自相矛盾', '低云被说干净，又说是主要短板')
  }
  if (/日出/.test(all) && /回光/.test(res.advice)) push(label, '物理错误', '日出建议里出现「回光」')
  if (res.advice.includes('重点赌云缝') && res.headline.includes('重点赌云缝')) {
    push(label, '重复', 'headline 与 advice 都含「重点赌云缝」')
  }
}

let n = 0
for (const kind of ['sunrise', 'sunset'])
  for (const score of [10, 25, 40, 50, 60, 66, 70, 80, 88, 95])
    for (const high of [0, 10, 30, 45, 55, 65, 80, 95])
      for (const low of [0, 20, 45, 70])
        for (const aod of [0.08, 0.25, 0.45, 0.9])
          for (const pop of [5, 45, 80]) {
            scan(`${kind}/score${score}/h${high}/l${low}/a${aod}/p${pop}`,
              interpret(mk({ kind, score, m: { high, mid: 20, low, aod, pop, rh: 75, vis: 20, t2m: 26 } })))
            n++
          }

// 高云文案方向：低于 55% 不能说「偏多」，高于 78% 不能说「少于/够铺开」
for (const high of [0, 5, 8, 20, 30, 40, 45, 55, 65, 78, 80, 85, 93, 100]) {
  const res = interpret(mk({ score: 80, m: { ...mk({}).m, high } }))
  const t = [...res.pros, ...res.cons].find((x) => x.startsWith('高云')) ?? ''
  if (high < 55 && /偏多/.test(t)) push(`high=${high}`, '方向说反', `高云 ${high}% 被说成偏多`)
  if (high > 78 && /少于|够铺开/.test(t)) push(`high=${high}`, '方向说反', `高云 ${high}% 被说成偏少`)
}

/* ============================================================
   雾文案专项检查（2026-11-05 加）
   ------------------------------------------------------------
   为什么单独一段：雾的百分比最容易被写成「成雾概率 80%」，
   而我们**没有任何雾观测**，那个数字是编的。
   把这条边界做成机器检查，而不是靠人记（交接文档 §36）。
   ============================================================ */
{
  const fr = await build({
    entryPoints: [path.join(ROOT, 'src/lib/forecast/fog.ts')],
    bundle: true, format: 'esm', write: false, platform: 'node',
    alias: { '@': path.join(ROOT, 'src') }
  })
  const { computeFog } = await import(
    'data:text/javascript;base64,' + Buffer.from(fr.outputFiles[0].text).toString('base64'))

  /* 禁用的词：出现在雾文案里就是「把提示说成了预报」 */
  const BANNED = ['预报', '概率', '一定', '必然', '将出现', '肯定会', '准没错']
  /* 至少要有其中一个，表明它还是「提示」口吻 */
  const NEED_ONE = ['潜势', '符合度', '可能', '参考', '不是']

  /* 穷举：温度/露点/湿度/风/低云/海温 各档 + 两个清晨小时 */
  let fogN = 0
  for (const t of [22, 24, 26]) {
    for (const spread of [0.3, 1.2, 3.0]) {
      const td = t - spread
      for (const rh of [88, 94]) {
        for (const wind of [1, 5, 12]) {
          for (const low of [10, 40]) {
            for (const sst of [null, 20.0, 28.7]) {
              const res = computeFog({ t2m: t, td2m: td, rh, low, wind10: wind, sst, hour: 6 })
              fogN++
              const text = res.guide.join(' ')
              for (const w of BANNED) {
                if (text.includes(w)) {
                  push(`T=${t} Td=${td} RH=${rh} 风=${wind} SST=${sst}`, '雾文案禁用词',
                    `指导里出现了「${w}」—— 雾是潜势提示，不能说成预报/概率`)
                }
              }
              if (!NEED_ONE.some((w) => text.includes(w))) {
                push(`T=${t} Td=${td} RH=${rh}`, '雾文案缺提示口吻',
                  '指导里既没写「潜势」也没写「符合度/可能/参考/不是」')
              }
              /* 数据状态非 ok 时，必须出现「数据不足/不完整/实验性/没有数据」之一 */
              if (res.dataStatus !== 'ok') {
                const okWords = ['数据不足', '不完整', '实验性', '没有数据', '没有海温', '缺测', '没有观测']
                if (!okWords.some((w) => text.includes(w))) {
                  push(`dataStatus=${res.dataStatus}`, '雾数据缺失未说明',
                    '数据不齐时必须明说，不能让人以为是「确定没有雾」')
                }
              }
              /* 必要条件不成立时，指南里必须点明「基本可以排除」 */
              if (res.gate === 'no' && !text.includes('排除')) {
                push(`SST=${sst} Td=${td}`, '雾硬门槛未明说',
                  '冷面条件不满足时必须说清「这一类雾基本可以排除」')
              }
              /* 百分比必须能对上「满足几条 ÷ 可用几条」 */
              const usable = res.basis.filter((b) => b.state === 'ok' || b.state === 'no')
              if (res.total !== usable.length) {
                push(`T=${t}`, '雾分母算错', `total=${res.total} 但可判定条数=${usable.length}`)
              }
              if (res.pct != null && res.total > 0) {
                const expect = Math.round((res.hit / res.total) * 100)
                if (res.pct !== expect) {
                  push(`T=${t}`, '雾百分比算错', `pct=${res.pct} 应为 ${expect}`)
                }
              }
            }
          }
        }
      }
    }
  }
  console.log(`  雾判据扫描 ${fogN} 种组合`)
}

console.log(`扫描 ${n} 种参数组合`)
if (problems.length) {
  console.log(`❌ 发现 ${problems.length} 处问题：`)
  const byKind = {}
  for (const p of problems) (byKind[p.kind] ??= []).push(p)
  for (const [k, list] of Object.entries(byKind)) {
    console.log(`  [${k}] ${list.length} 处，例：${list[0].label} — ${list[0].detail}`)
  }
  process.exit(1)
}
console.log('✅ 文案自检全部通过')
