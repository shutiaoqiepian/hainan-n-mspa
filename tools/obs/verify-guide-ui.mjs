/**
 * 用无头 Edge + 手写 CDP 客户端，验证 /cross 的「怎么看这张图」面板。
 *
 * 为什么不用现成 puppeteer：仓库没装，而 CDP 只需要 WebSocket + HTTP，
 * 这里手写最小客户端避免新增依赖。
 *
 * 验证项：
 *   1. 折叠按钮存在且默认收起（说明 body 还没渲染）；
 *   2. 点击后展开，分组数量、条目数量与 guide.ts 对得上；
 *   3. 没有横向溢出（说明面板撑破布局是常见事故）；
 *   4. 截图留档。
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { MiniWebSocket } from './miniwsc.mjs'

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/cross.html'
const OUT = process.argv[3] ?? 'tools/obs/out'
const PORT = 9333
const USERDIR = join(process.env.TEMP ?? '/tmp', 'edge-guide-' + Date.now())

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]

let ws
let msgId = 0
const pending = new Map()

function send(method, params = {}, sessionId) {
  const id = ++msgId
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout ${method}`)) }
    }, 30000)
  })
}

async function evaluate(expression, sessionId) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

const fails = []
let pass = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push(detail ? `${name} — ${detail}` : name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  let edgePath = null
  const { existsSync } = await import('node:fs')
  for (const p of EDGE) if (existsSync(p)) { edgePath = p; break }
  if (!edgePath) throw new Error('找不到 Edge')

  rmSync(USERDIR, { recursive: true, force: true })
  const proc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USERDIR}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,1000',
    'about:blank'
  ], { stdio: 'ignore' })

  try {
    let info = null
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
        if (r.ok) { info = await r.json(); break }
      } catch { /* 还没起来 */ }
    }
    if (!info) throw new Error('Edge 调试端口没起来')

    ws = new MiniWebSocket()
    await ws.connect(info.webSocketDebuggerUrl)
    ws.on('message', (text) => {
      const m = JSON.parse(text)
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id)
        pending.delete(m.id)
        if (m.error) rej(new Error(m.error.message))
        else res(m.result)
      }
    })

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false
    }, sessionId)

    await send('Page.navigate', { url: URL }, sessionId)
    await sleep(3500)

    // 等剖面数据加载完（工具条出现）
    for (let i = 0; i < 40; i++) {
      const ok = await evaluate(`!!document.querySelector('.xsec-toolbar')`, sessionId)
      if (ok) break
      await sleep(300)
    }

    console.log('\n[1] 默认收起')
    const toggleText = await evaluate(
      `document.querySelector('.xsec-guide-toggle')?.innerText.replace(/\\s+/g,' ').trim() ?? null`, sessionId)
    check('折叠按钮存在', !!toggleText, '页面找不到 .xsec-guide-toggle')
    check('按钮文案含「怎么看」', !!toggleText && toggleText.includes('怎么看这张图'), toggleText ?? '')
    check('默认收起（body 未渲染）', await evaluate(
      `!document.querySelector('.xsec-guide-body')`, sessionId), '默认应该是收起的')

    console.log('\n[2] 点击展开')
    await evaluate(`document.querySelector('.xsec-guide-toggle').click()`, sessionId)
    await sleep(500)

    const stats = await evaluate(`(() => {
      const body = document.querySelector('.xsec-guide-body')
      if (!body) return null
      return {
        blocks: document.querySelectorAll('.xsec-guide-block').length,
        titles: [...document.querySelectorAll('.xsec-guide-title')].map(e => e.textContent.trim()),
        dts: document.querySelectorAll('.xsec-guide-dl dt').length,
        uses: document.querySelectorAll('.xsec-guide-use').length,
        cautions: document.querySelectorAll('.xsec-guide-caution').length,
        quick: document.querySelectorAll('.xsec-guide-quick li').length,
        expanded: document.querySelector('.xsec-guide-toggle').getAttribute('aria-expanded'),
        textLen: body.innerText.length
      }
    })()`, sessionId)

    check('展开后 body 出现', !!stats, '点击后没有渲染 body')
    if (stats) {
      // TOOLBAR_GUIDE 9 个分组 + 「图上那些东西是什么」1 块 = 10
      check('分组数符合预期', stats.blocks === 10, `实际 ${stats.blocks}`)
      check('每个分组都有标题', stats.titles.length === stats.blocks, `${stats.titles.length}/${stats.blocks}`)
      check('说明条目数量充足', stats.dts >= 30, `实际 ${stats.dts} 条`)
      check('每条都有「怎么用」', stats.uses === stats.dts, `${stats.uses}/${stats.dts}`)
      check('有「别误读」提醒', stats.cautions >= 8, `实际 ${stats.cautions}`)
      check('三十秒上手有 5 步', stats.quick === 5, `实际 ${stats.quick}`)
      check('aria-expanded = true', stats.expanded === 'true', String(stats.expanded))
      check('正文确实有内容', stats.textLen > 3000, `只有 ${stats.textLen} 字`)

      console.log('\n  分组：' + stats.titles.join(' / '))
    }

    console.log('\n[3] 布局')
    const overflow = await evaluate(`(() => {
      const de = document.documentElement
      return { scrollW: de.scrollWidth, clientW: de.clientWidth }
    })()`, sessionId)
    check('无横向溢出', overflow.scrollW <= overflow.clientW + 2,
      `scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`)

    // 关键：说明面板在工具条之上，不应把工具条挤出首屏太远
    const order = await evaluate(`(() => {
      const g = document.querySelector('.xsec-guide').getBoundingClientRect()
      const t = document.querySelector('.xsec-toolbar').getBoundingClientRect()
      return { guideTop: g.top, toolbarTop: t.top }
    })()`, sessionId)
    check('说明面板在工具条上方', order.guideTop < order.toolbarTop,
      `guide ${order.guideTop} / toolbar ${order.toolbarTop}`)

    console.log('\n[4] 截图')
    mkdirSync(OUT, { recursive: true })
    // 滚到说明面板顶部
    await evaluate(`window.scrollTo(0, document.querySelector('.xsec-guide').offsetTop - 20)`, sessionId)
    await sleep(400)
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    const p1 = join(OUT, 'guide-open.png')
    writeFileSync(p1, Buffer.from(shot.data, 'base64'))
    console.log('  · ' + p1)

    // 收起状态截图
    await evaluate(`document.querySelector('.xsec-guide-toggle').click()`, sessionId)
    await sleep(400)
    await evaluate(`window.scrollTo(0, 0)`, sessionId)
    await sleep(300)
    const shot2 = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    const p2 = join(OUT, 'guide-collapsed.png')
    writeFileSync(p2, Buffer.from(shot2.data, 'base64'))
    console.log('  · ' + p2)

    check('收起后 body 消失', await evaluate(
      `!document.querySelector('.xsec-guide-body')`, sessionId), '再点一次应该收起')

  } finally {
    try { ws?.close() } catch {}
    proc.kill()
    await sleep(500)
    rmSync(USERDIR, { recursive: true, force: true })
  }

  console.log('')
  if (fails.length) {
    console.error(`✗ 浏览器验证：${pass} 通过，${fails.length} 失败`)
    for (const f of fails) console.error('  · ' + f)
    process.exit(1)
  }
  console.log(`✓ 浏览器验证：${pass}/${pass} 全部通过`)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
