import type { Link } from './link'
import type { FireMessage, Message, ResultMessage } from './protocol'

interface Pending {
  msg: FireMessage
  resolve: (r: ResultMessage) => void
  reject: (e: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * The attacking side: fire a shot, await the defender's feedback.
 *
 * The link can come and go. A shot that has not been answered stays pending while there is
 * no link and is sent again, with the same id, when a new one is attached. The defender
 * recognises the id and replays its answer instead of applying the shot twice.
 */
export class AttackerSession {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private link: Link | null = null
  private off: (() => void) | null = null

  constructor(
    link: Link | null,
    private timeoutMs = 10_000,
    /** Called when a shot goes unanswered for too long on a link that looks alive. */
    private onTimeout: () => void = () => {},
  ) {
    this.attach(link)
  }

  /** Switch to a new link (or null for none), re-sending anything still unanswered. */
  attach(link: Link | null) {
    this.off?.()
    this.off = null
    this.link = link
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.timer = undefined
    }
    if (!link) return
    this.off = link.onMessage((m) => this.handle(m))
    for (const p of this.pending.values()) this.transmit(p)
  }

  fire(angle: number, power: number): Promise<ResultMessage> {
    if (!this.link) return Promise.reject(new Error('Connection lost'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const p: Pending = { msg: { type: 'fire', id, angle, power }, resolve, reject }
      this.pending.set(id, p)
      this.transmit(p)
    })
  }

  private transmit(p: Pending) {
    p.timer = setTimeout(() => {
      p.timer = undefined
      this.onTimeout()
    }, this.timeoutMs)
    this.link?.send(p.msg)
  }

  private handle(msg: Message) {
    if (msg.type !== 'result' && msg.type !== 'rejected') return
    const p = this.pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(msg.id)
    if (msg.type === 'result') p.resolve(msg)
    else p.reject(new Error(`Shot rejected: ${msg.reason}`))
  }

  dispose({ closeLink = true }: { closeLink?: boolean } = {}) {
    this.off?.()
    this.off = null
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Match closed'))
    }
    this.pending.clear()
    if (closeLink) this.link?.close()
    this.link = null
  }
}
