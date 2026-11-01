/**
 * 最小 WebSocket 客户端（仅用于 CDP，支持客户端→服务端的文本帧）。
 *
 * 为什么手写：本机 Node 20 没有全局 WebSocket，仓库也没装 undici / ws。
 * CDP 只需要「发 JSON 文本帧 + 收服务端帧」，不必实现完整 RFC 6455：
 *   · 只做客户端角色，且不分片（CDP 消息都在单帧内）；
 *   · 帧长可能超过 65535，必须支持 64 位长度（payload 常到几 MB，如截图）；
 *   · 服务端帧可能被分片（大截图），这里累积 continuation 帧。
 *
 * 不支持：扩展、子协议、压缩、掩码以外的控制帧细节（ping 简单回 pong）。
 */
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { connect } from 'node:net'

export class MiniWebSocket extends EventEmitter {
  constructor() {
    super()
    this.buf = Buffer.alloc(0)
    this.fragments = []
    this.socket = null
    this.open = false
  }

  connect(wsUrl) {
    const u = new URL(wsUrl)
    const key = randomBytes(16).toString('base64')
    const host = u.host
    const path = u.pathname + (u.search || '')

    return new Promise((resolve, reject) => {
      const sock = connect({ host: u.hostname, port: Number(u.port || 80) }, () => {
        sock.write(
          `GET ${path} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n'
        )
      })
      this.socket = sock
      sock.on('error', (e) => { this.emit('error', e); reject(e) })

      let handshaken = false
      sock.on('data', (chunk) => {
        if (!handshaken) {
          this.buf = Buffer.concat([this.buf, chunk])
          const idx = this.buf.indexOf('\r\n\r\n')
          if (idx === -1) return
          const head = this.buf.subarray(0, idx).toString('latin1')
          if (!/^HTTP\/1\.1 101/.test(head)) {
            // 有的实现对非 101 也继续读，这里直接失败更早暴露问题
            if (/^HTTP\/1\.1 \d+/.test(head)) {
              reject(new Error('WebSocket 握手失败: ' + head.split('\r\n')[0]))
              sock.destroy()
              return
            }
          }
          this.buf = this.buf.subarray(idx + 4)
          handshaken = true
          this.open = true
          resolve()
          // 握手响应后可能已经带着数据帧
          if (this.buf.length) this._drain()
          return
        }
        this.buf = Buffer.concat([this.buf, chunk])
        this._drain()
      })

      sock.on('close', () => {
        this.open = false
        this.emit('close')
      })
    })
  }

  _drain() {
    for (;;) {
      const b = this.buf
      if (b.length < 2) return
      const fin = (b[0] & 0x80) !== 0
      const opcode = b[0] & 0x0f
      const masked = (b[1] & 0x80) !== 0
      let len = b[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (b.length < off + 2) return
        len = b.readUInt16BE(off); off += 2
      } else if (len === 127) {
        if (b.length < off + 8) return
        const hi = b.readUInt32BE(off)
        const lo = b.readUInt32BE(off + 4)
        len = hi * 2 ** 32 + lo
        off += 8
      }
      let mask = null
      if (masked) {
        if (b.length < off + 4) return
        mask = b.subarray(off, off + 4); off += 4
      }
      if (b.length < off + len) return
      let payload = b.subarray(off, off + len)
      if (mask) {
        const out = Buffer.allocUnsafe(len)
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]
        payload = out
      }
      this.buf = b.subarray(off + len)

      switch (opcode) {
        case 0x0: // continuation
          this.fragments.push(payload)
          if (fin) {
            const full = Buffer.concat(this.fragments)
            this.fragments = []
            this.emit('message', full.toString('utf8'))
          }
          break
        case 0x1: // text
        case 0x2: // binary
          if (fin) {
            this.emit('message', payload.toString('utf8'))
          } else {
            this.fragments = [payload]
          }
          break
        case 0x8: // close
          this.open = false
          this.emit('close')
          break
        case 0x9: // ping → pong
          this._writeFrame(0xa, payload)
          break
        default:
          break
      }
    }
  }

  _writeFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return
    const mask = randomBytes(4)
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.alloc(2)
      header[1] = 0x80 | len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 0x80 | 127
      header.writeUInt32BE(Math.floor(len / 2 ** 32), 2)
      header.writeUInt32BE(len % 2 ** 32, 6)
    }
    header[0] = 0x80 | opcode
    const masked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  send(text) {
    this._writeFrame(0x1, Buffer.from(text, 'utf8'))
  }

  close() {
    try {
      if (this.open) this._writeFrame(0x8, Buffer.alloc(0))
    } catch { /* ignore */ }
    try { this.socket?.destroy() } catch { /* ignore */ }
    this.open = false
  }
}
