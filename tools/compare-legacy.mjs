/**
 * 视觉与结构回归比对：把「改造前（基线提交）」和「改造后（dist）」逐页比对。
 *
 *   node tools/compare-legacy.mjs            # 全部页面
 *   node tools/compare-legacy.mjs index      # 只比某几页
 *
 * 两个站点用静态服务器起在 4100 / 4200，用本机 Chrome 无头模式各取：
 *   1) 渲染后的 DOM → 归一化成「标签+class」签名与纯文本，逐行 diff
 *   2) 截图 → ImageMagick compare 数像素差异（关掉动画与 reveal 干扰）
 * 任何一页有差异都会以非零码退出。
 */
import { execFileSync, execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const LEGACY_DIR = '/tmp/mspa-legacy'
const SHOT_DIR = '/tmp/mspa-compare'
const LEGACY_PORT = 4100
const NEW_PORT = 4200
const CHROME = 'google-chrome'
const VIEWPORT = { w: 1280, h: 1400 }
// 虚拟时间预算：图片多的页面（作品集 40 张）要够大，否则两端解码进度会不一致
const SETTLE_MS = Number(process.env.SETTLE_MS || 7000)
/** 截图受本机负载影响（图片解码时序），同一页重试几次，取最好的一次 */
const SHOT_ATTEMPTS = 4
/** 允许的抗锯齿噪声像素数（同引擎同 CSS 下通常为个位数） */
const PIXEL_TOLERANCE = 50

/**
 * 改造前的基线提交（Vue 迁移开始前的最后一次提交）。
 * 固定成提交号而不是 HEAD，这样将来把重构提交上去之后，
 * 比对仍然是对「改造前」而不是对「改造后自己」。
 * 需要临时换基线时用 LEGACY_REF=<commit> 覆盖。
 */
const BASELINE_REF = process.env.LEGACY_REF || '01d5019'

const ALL_PAGES = ['index', 'about', 'gallery', 'forecast', 'members', 'join', '404']
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ALL_PAGES

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

function prepareLegacy() {
  rmSync(LEGACY_DIR, { recursive: true, force: true })
  mkdirSync(LEGACY_DIR, { recursive: true })
  const tar = execSync('git archive ' + BASELINE_REF, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 })
  const out = spawn('tar', ['-x', '-C', LEGACY_DIR])
  out.stdin.end(tar)
  return new Promise((resolve, reject) => {
    out.on('close', (code) => (code === 0 ? resolve() : reject(new Error('tar failed'))))
  })
}

function serve(dir, port) {
  return spawn('python3', ['-m', 'http.server', String(port), '--directory', dir], { stdio: 'ignore' })
}

async function waitFor(url) {
  for (let i = 0; i < 80; i++) {
    try {
      execSync('curl -sf -o /dev/null -m 2 ' + JSON.stringify(url), { stdio: 'ignore' })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error('server did not start: ' + url)
}

function chrome(args) {
  return run(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--force-prefers-reduced-motion',
    '--user-data-dir=/tmp/mspa-chrome-profile-' + process.pid,
    '--virtual-time-budget=' + SETTLE_MS,
    ...args
  ], { maxBuffer: 64 * 1024 * 1024 })
}

function dumpDom(url) {
  return chrome(['--dump-dom', url])
}

/* ---------- 截图：走 CDP ----------
   CLI 的 --screenshot 只拍视口、且不等懒加载的图片解码完。作品集有 40 张图，
   两端解码进度一不一致，CSS 多列布局的高度就不同，像素差会从 0 跳到几十万。
   这里改成：真实时间等待 → 在页面里滚到底再回顶把所有懒加载触发完 →
   等所有 <img> 解码完成 → 截图时整页拍下来。 */

const CDP_PORT = 4300 + (process.pid % 400)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const waiter = message.id ? this.pending.get(message.id) : null
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('cdp socket error'))
    })
    return new CdpClient(ws)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
    })
  }
}

async function launchChromeWithCdp(profileDir) {
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--force-prefers-reduced-motion',
      '--window-size=' + VIEWPORT.w + ',' + VIEWPORT.h,
      '--user-data-dir=' + profileDir,
      '--remote-debugging-port=' + CDP_PORT,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')
      if (res.ok) {
        const info = await res.json()
        return { proc, wsUrl: info.webSocketDebuggerUrl, pid: proc.pid }
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(100)
  }

  proc.kill()
  throw new Error('Chrome CDP 没能在 12 秒内就绪')
}

/** 页面内脚本：点开所有懒加载、等图片解码完、回到顶部 */
const SETTLE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bottom = () => Math.min(document.documentElement.scrollHeight, 40000);
  for (let y = 0; y < bottom(); y += 500) {
    window.scrollTo(0, y);
    await wait(40);
  }
  window.scrollTo(0, 0);
  for (let i = 0; i < 60; i++) {
    const pending = Array.from(document.images).filter((im) => !im.complete || im.naturalWidth === 0);
    if (!pending.length) break;
    await wait(150);
  }
  await wait(250);
  return document.images.length;
})()`

async function capturePage(cdp, url, file) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

  try {
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Page.navigate', { url }, sessionId)
    await sleep(700)
    await cdp.send(
      'Runtime.evaluate',
      { expression: SETTLE_SCRIPT, awaitPromise: true, returnByValue: true },
      sessionId
    )
    const shot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId
    )
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {})
  }
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Vue 挂载点 div#app 是新结构引入的外壳，比对时视为透明 */
function stripAppWrapper(signature) {
  const start = signature.indexOf('div#app')
  if (start < 0) return signature

  let depth = 0
  for (let i = start + 1; i < signature.length; i++) {
    const token = signature[i]
    if (token.startsWith('/')) {
      if (depth === 0) {
        if (token !== '/div') return signature
        return signature.slice(0, start).concat(signature.slice(start + 1, i), signature.slice(i + 1))
      }
      depth--
    } else if (!VOID_TAGS.has(token.split('.')[0].split('#')[0])) {
      depth++
    }
  }
  return signature
}

/** 归一化：删注释与脚本，抽出「标签+class」签名与纯文本 */
function normalize(html) {
  const body = html.slice(html.indexOf('<body'))
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  const signature = []
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g
  let m
  while ((m = tagRe.exec(cleaned))) {
    const name = m[2].toLowerCase()
    if (m[1] === '/') {
      signature.push('/' + name)
      continue
    }
    const attr = m[3]
    const cls = /class="([^"]*)"/.exec(attr)
    const id = /id="([^"]*)"/.exec(attr)
    const classes = cls ? cls[1].split(/\s+/).filter(Boolean).sort() : []
    signature.push(name + (id ? '#' + id[1] : '') + (classes.length ? '.' + classes.join('.') : ''))
  }

  let text = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 预报页分数、时间会随取数时刻变化：MASK_DIGITS=1 时把数字抹平只比结构
  if (process.env.MASK_DIGITS === '1') text = text.replace(/[0-9０-９]+/g, '#')

  return { signature: stripAppWrapper(signature), text }
}

function diffLines(a, b, limit = 12) {
  const out = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max && out.length < limit; i++) {
    if (a[i] !== b[i]) out.push('  #' + i + ' legacy=' + a[i] + ' | new=' + b[i])
  }
  return out
}

function pixelDiff(a, b) {
  try {
    const res = run('compare', ['-metric', 'AE', a, b, 'null:'])
    return Number(String(res).trim().replace(/[^0-9.]/g, '')) || 0
  } catch (err) {
    const msg = String(err.stderr || '') + String(err.stdout || '')
    const n = Number((msg.match(/[0-9]+/g) || []).slice(-1)[0])
    return Number.isFinite(n) ? n : -1
  }
}

async function main() {
  rmSync(SHOT_DIR, { recursive: true, force: true })
  mkdirSync(SHOT_DIR, { recursive: true })

  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('先跑 npm run build')
  await prepareLegacy()

  const legacyServer = serve(LEGACY_DIR, LEGACY_PORT)
  const newServer = serve(join(ROOT, 'dist'), NEW_PORT)
  const failures = []

  const cdpProfile = '/tmp/mspa-cdp-profile-' + process.pid
  rmSync(cdpProfile, { recursive: true, force: true })
  const { proc: chromeProc, wsUrl } = await launchChromeWithCdp(cdpProfile)
  const cdp = await CdpClient.connect(wsUrl)

  try {
    await waitFor('http://127.0.0.1:' + LEGACY_PORT + '/index.html')
    await waitFor('http://127.0.0.1:' + NEW_PORT + '/index.html')

    for (const page of pages) {
      const legacyUrl = 'http://127.0.0.1:' + LEGACY_PORT + '/' + page + '.html'
      const newUrl = 'http://127.0.0.1:' + NEW_PORT + '/' + page + '.html'

      const legacy = normalize(dumpDom(legacyUrl))
      const fresh = normalize(dumpDom(newUrl))

      const sigDiff = diffLines(legacy.signature, fresh.signature)
      const textDiff = diffLines([legacy.text], [fresh.text], 4)

      const legacyShot = join(SHOT_DIR, page + '-legacy.png')
      const newShot = join(SHOT_DIR, page + '-new.png')

      let px = -1
      for (let attempt = 0; attempt < SHOT_ATTEMPTS; attempt++) {
        await capturePage(cdp, legacyUrl, legacyShot)
        await capturePage(cdp, newUrl, newShot)
        px = pixelDiff(legacyShot, newShot)
        if (px === 0) break
      }

      const ok = sigDiff.length === 0 && textDiff.length === 0 && px >= 0 && px <= PIXEL_TOLERANCE
      console.log(
        (ok ? 'OK   ' : 'DIFF ') + page.padEnd(9) +
        ' 结构差异=' + sigDiff.length +
        ' 文本差异=' + textDiff.length +
        ' 像素差异=' + px
      )
      if (!ok) {
        failures.push(page)
        if (sigDiff.length) console.log('  结构首个差异:\n' + sigDiff.slice(0, 4).join('\n'))
        if (textDiff.length) console.log('  文本差异:\n' + textDiff.join('\n').slice(0, 1200))
      }
    }
  } finally {
    legacyServer.kill()
    newServer.kill()
    chromeProc.kill()
    await sleep(300)
    try {
      rmSync(cdpProfile, { recursive: true, force: true })
    } catch {
      /* Chrome 还在收尾写 profile，删不掉也无所谓（/tmp 里的临时目录） */
    }
  }

  if (failures.length) {
    console.log('\n不一致页面: ' + failures.join(', '))
    process.exit(1)
  }
  console.log('\n全部页面一致')
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
