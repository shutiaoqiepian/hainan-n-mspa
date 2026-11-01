/**
 * 线上页面 DOM 诊断：看 /cross 到底渲染出了什么。
 * 用法：node tools/obs/diag-live.mjs https://hainan-n-mspa.pages.dev/cross
 */
import { spawn } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { MiniWebSocket } from './miniwsc.mjs'

const URL = process.argv[2] ?? 'https://hainan-n-mspa.pages.dev/cross'
const PORT = 9334
const USERDIR = join(process.env.TEMP ?? '/tmp', 'edge-diag-' + Date.now())

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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 40000)
  })
}
async function evaluate(expression, sessionId) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}

let edgePath = null
for (const p of EDGE) if (existsSync(p)) { edgePath = p; break }
rmSync(USERDIR, { recursive: true, force: true })
const proc = spawn(edgePath, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDIR}`,
  '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' })

try {
  let info = null
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) { info = await r.json(); break }
    } catch { /* 继续等 */ }
  }
  if (!info) throw new Error('调试端口没起来')

  ws = new MiniWebSocket()
  await ws.connect(info.webSocketDebuggerUrl)
  ws.on('message', (text) => {
    const m = JSON.parse(text)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) rej(new Error(m.error.message)); else res(m.result)
    }
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)

  // 收集控制台报错
  const logs = []
  ws.on('message', (text) => {
    const m = JSON.parse(text)
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(m.params.type.toUpperCase() + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })

  console.log('打开：' + URL)
  await send('Page.navigate', { url: URL }, sessionId)
  await sleep(9000)

  console.log('\n=== URL ===')
  console.log(await evaluate('location.href', sessionId))

  console.log('\n=== 页面骨架 ===')
  console.log(JSON.stringify(await evaluate(`(() => ({
    hasToolbar: !!document.querySelector('.xsec-toolbar'),
    hasGuide: !!document.querySelector('.xsec-guide'),
    hasSpots: !!document.querySelector('.xsec-spots'),
    loading: !!document.querySelector('.fc-empty'),
    loadingText: document.querySelector('.fc-empty')?.innerText?.slice(0,200) ?? null,
    bodyLen: document.body.innerText.length,
    bodyHead: document.body.innerText.slice(0, 400),
    scripts: [...document.querySelectorAll('script[src]')].map(s => s.src).slice(0,6)
  }))()`, sessionId), null, 2))

  console.log('\n=== 控制台 ===')
  console.log(logs.length ? logs.slice(0, 15).join('\n') : '(无)')

} finally {
  try { ws?.close() } catch {}
  proc.kill()
  await sleep(400)
  rmSync(USERDIR, { recursive: true, force: true })
}
