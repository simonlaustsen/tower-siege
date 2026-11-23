import type { Message } from './protocol'

/**
 * A message pipe to the other player. The WebRTC data channel implements this
 * same interface (see rtcLink.ts), so game code never needs to know what is underneath.
 */
export interface Link {
  send(msg: Message): void
  /** Returns an unsubscribe function. */
  onMessage(handler: (msg: Message) => void): () => void
  /** Called once when the connection goes away, whoever ended it. Returns an unsubscribe function. */
  onClose(handler: () => void): () => void
  close(): void
}

class LoopbackEnd implements Link {
  peer!: LoopbackEnd
  private handlers = new Set<(msg: Message) => void>()
  private closeHandlers = new Set<() => void>()
  closed = false

  constructor(private latencyMs: number) {}

  send(msg: Message) {
    if (this.closed) return
    // Clone like a real wire would: guarantees no object is ever shared between "phones".
    const copy = structuredClone(msg)
    setTimeout(() => {
      if (this.peer.closed) return
      this.peer.handlers.forEach((h) => h(copy))
    }, this.latencyMs)
  }

  onMessage(handler: (msg: Message) => void) {
    this.handlers.add(handler)
    return () => void this.handlers.delete(handler)
  }

  onClose(handler: () => void) {
    this.closeHandlers.add(handler)
    return () => void this.closeHandlers.delete(handler)
  }

  /** Ends the connection for both ends, like a data channel closing. */
  close() {
    if (this.closed) return
    this.shutdown()
    setTimeout(() => this.peer.shutdown(), this.latencyMs)
  }

  private shutdown() {
    if (this.closed && this.closeHandlers.size === 0) return
    this.closed = true
    this.handlers.clear()
    const handlers = [...this.closeHandlers]
    this.closeHandlers.clear()
    handlers.forEach((h) => h())
  }
}

/** Two connected in-memory ends, with simulated network latency. */
export function createLoopbackPair(latencyMs = 0): [Link, Link] {
  const a = new LoopbackEnd(latencyMs)
  const b = new LoopbackEnd(latencyMs)
  a.peer = b
  b.peer = a
  return [a, b]
}
