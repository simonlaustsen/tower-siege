import type { Link } from './link'
import { parseFrame, type Message } from './protocol'

/** The few things of an RTCDataChannel we use, so a fake can stand in for it in tests. */
export interface ChannelLike {
  readonly readyState: string
  send(data: string): void
  close(): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  addEventListener(type: 'close' | 'error', listener: () => void): void
}

/** The few things of an RTCPeerConnection we use. */
export interface ConnectionLike {
  readonly connectionState: string
  close(): void
  addEventListener(type: 'connectionstatechange', listener: () => void): void
}

/** How many messages to hold for a listener that has not turned up yet. */
const MAX_EARLY = 50

export interface RtcLinkOptions {
  /** How often to send a keep-alive. */
  heartbeatMs?: number
  /** Treat the link as dead after this long without hearing anything. */
  deadAfterMs?: number
}

/**
 * A `Link` over a WebRTC data channel.
 *
 * Browsers take a long time (tens of seconds) to notice that a phone has gone away, so a small
 * heartbeat runs both ways: if nothing at all arrives for a few seconds, the link is declared dead
 * and the game can offer a reconnect straight away.
 */
export class RtcLink implements Link {
  private handlers = new Set<(msg: Message) => void>()
  private closeHandlers = new Set<() => void>()
  private early: Message[] = []
  private ended = false
  private lastHeard = Date.now()
  private timer: ReturnType<typeof setInterval>

  constructor(
    private channel: ChannelLike,
    private connection?: ConnectionLike,
    { heartbeatMs = 2000, deadAfterMs = 8000 }: RtcLinkOptions = {},
  ) {
    channel.addEventListener('message', (e) => this.receive(e.data))
    channel.addEventListener('close', () => this.end())
    channel.addEventListener('error', () => this.end())
    connection?.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') this.end()
    })
    this.timer = setInterval(() => {
      if (Date.now() - this.lastHeard > deadAfterMs) return this.end()
      this.write('{"type":"ping"}')
    }, heartbeatMs)
  }

  send(msg: Message) {
    this.write(JSON.stringify(msg))
  }

  onMessage(handler: (msg: Message) => void) {
    this.handlers.add(handler)
    // The other phone may have spoken before anyone here was listening: hand those messages over, but
    // a moment later, so everything that subscribes in the same step gets to hear them too.
    if (this.early.length > 0) queueMicrotask(() => this.flushEarly())
    return () => void this.handlers.delete(handler)
  }

  private flushEarly() {
    while (this.early.length > 0 && this.handlers.size > 0 && !this.ended) {
      const msg = this.early.shift()!
      this.handlers.forEach((h) => h(msg))
    }
  }

  onClose(handler: () => void) {
    this.closeHandlers.add(handler)
    return () => void this.closeHandlers.delete(handler)
  }

  close() {
    this.end()
  }

  private write(text: string) {
    if (this.ended || this.channel.readyState !== 'open') return
    try {
      this.channel.send(text)
    } catch {
      this.end()
    }
  }

  private receive(data: unknown) {
    if (this.ended) return
    this.lastHeard = Date.now()
    const frame = parseFrame(data)
    if (frame.kind !== 'message') return // pings only prove the other side is alive; junk is ignored
    if (this.handlers.size === 0 || this.early.length > 0) {
      if (this.early.length < MAX_EARLY) this.early.push(frame.message)
      if (this.handlers.size > 0) queueMicrotask(() => this.flushEarly())
      return
    }
    this.handlers.forEach((h) => h(frame.message))
  }

  private end() {
    if (this.ended) return
    this.ended = true
    clearInterval(this.timer)
    const handlers = [...this.closeHandlers]
    this.handlers.clear()
    this.closeHandlers.clear()
    try {
      this.channel.close()
      this.connection?.close()
    } catch {
      // already closed
    }
    handlers.forEach((h) => h())
  }
}
