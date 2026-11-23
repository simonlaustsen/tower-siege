import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RtcLink, type ChannelLike, type ConnectionLike } from './rtcLink'
import type { Message } from './protocol'

/** Two fake data channels wired back to back, with a switch to cut the wire silently. */
class FakeChannel implements ChannelLike {
  readyState = 'open'
  other!: FakeChannel
  wireCut = false
  sent: string[] = []
  private listeners: Record<string, ((e: any) => void)[]> = { message: [], close: [], error: [] }

  send(data: string) {
    if (this.readyState !== 'open') throw new Error('InvalidStateError')
    this.sent.push(data)
    if (!this.wireCut) this.other.emit('message', { data })
  }
  close() {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.emit('close', undefined)
    if (!this.wireCut) this.other.remoteClosed()
  }
  remoteClosed() {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.emit('close', undefined)
  }
  addEventListener(type: string, listener: (e: any) => void) {
    this.listeners[type].push(listener)
  }
  emit(type: string, e: unknown) {
    this.listeners[type].forEach((l) => l(e))
  }
}

function channels() {
  const a = new FakeChannel()
  const b = new FakeChannel()
  a.other = b
  b.other = a
  return { a, b }
}

const fire: Message = { type: 'fire', id: 1, angle: 45, power: 60 }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('RtcLink', () => {
  it('carries game messages both ways', () => {
    const { a, b } = channels()
    const la = new RtcLink(a)
    const lb = new RtcLink(b)
    const got: Message[] = []
    lb.onMessage((m) => got.push(m))
    la.send(fire)
    expect(got).toEqual([fire])
    const back: Message[] = []
    la.onMessage((m) => back.push(m))
    lb.send({ type: 'rematch' })
    expect(back).toEqual([{ type: 'rematch' }])
  })

  it('holds messages that arrive before anyone listens, then delivers them in order to every listener', async () => {
    const { a, b } = channels()
    const lb = new RtcLink(b)
    a.send(JSON.stringify({ type: 'hello', version: 1, youGoFirst: true }))
    a.send(JSON.stringify(fire)) // arrives straight after, still with nobody listening
    const first: string[] = []
    const second: string[] = []
    lb.onMessage((m) => first.push(m.type)) // two parts of the app subscribe in the same step...
    lb.onMessage((m) => second.push(m.type))
    expect(first).toEqual([]) // ...so delivery waits a moment for both
    await Promise.resolve()
    expect(first).toEqual(['hello', 'fire'])
    expect(second).toEqual(['hello', 'fire'])
    a.send(JSON.stringify({ type: 'rematch' })) // later messages are delivered straight away
    expect(first).toEqual(['hello', 'fire', 'rematch'])
  })

  it('does not hoard messages for a listener that never comes', () => {
    const { a, b } = channels()
    new RtcLink(b)
    for (let i = 0; i < 500; i++) a.send(JSON.stringify(fire))
    // nothing to assert beyond "no crash, no runaway memory": the cap is internal
    expect(a.sent).toHaveLength(500)
  })

  it('ignores anything that is not a valid game message', () => {
    const { a, b } = channels()
    const lb = new RtcLink(b)
    const got: Message[] = []
    lb.onMessage((m) => got.push(m))
    for (const junk of [
      'not json',
      '{"type":"fire","id":"x","angle":1,"power":2}', // id is not a number
      '{"type":"launch-missiles"}',
      '{"type":"result","id":1,"feedback":{"kind":"hit"},"towerDown":false}', // incomplete feedback
      '[]',
      'null',
      'x'.repeat(10_000), // oversized
      new ArrayBuffer(8) as unknown as string, // binary
    ]) {
      expect(() => a.send(junk)).not.toThrow()
    }
    expect(got).toEqual([])
    a.send(JSON.stringify(fire)) // and it still works afterwards
    expect(got).toEqual([fire])
  })

  it('sends keep-alives, which are not shown to the game', () => {
    const { a, b } = channels()
    new RtcLink(a, undefined, { heartbeatMs: 1000, deadAfterMs: 5000 })
    const lb = new RtcLink(b, undefined, { heartbeatMs: 1000, deadAfterMs: 5000 })
    const got: Message[] = []
    lb.onMessage((m) => got.push(m))
    vi.advanceTimersByTime(3500)
    expect(a.sent.filter((s) => s.includes('ping')).length).toBeGreaterThanOrEqual(3)
    expect(got).toEqual([])
  })

  it('stays alive while the other side keeps answering', () => {
    const { a, b } = channels()
    const la = new RtcLink(a, undefined, { heartbeatMs: 1000, deadAfterMs: 4000 })
    new RtcLink(b, undefined, { heartbeatMs: 1000, deadAfterMs: 4000 })
    let closed = 0
    la.onClose(() => closed++)
    vi.advanceTimersByTime(60_000)
    expect(closed).toBe(0)
  })

  it('declares the link dead when the other side goes silent', () => {
    const { a, b } = channels()
    const la = new RtcLink(a, undefined, { heartbeatMs: 1000, deadAfterMs: 4000 })
    new RtcLink(b, undefined, { heartbeatMs: 1000, deadAfterMs: 4000 })
    let closed = 0
    la.onClose(() => closed++)
    vi.advanceTimersByTime(1500)
    a.wireCut = true // a phone walks out of Wi-Fi range: no close event, just silence
    b.wireCut = true
    vi.advanceTimersByTime(3000)
    expect(closed).toBe(0) // not yet
    vi.advanceTimersByTime(3000)
    expect(closed).toBe(1)
    expect(a.readyState).toBe('closed') // and the dead channel is released
    vi.advanceTimersByTime(60_000)
    expect(closed).toBe(1) // reported once only
  })

  it('reports a closed channel once, from either side', () => {
    const { a, b } = channels()
    const la = new RtcLink(a)
    const lb = new RtcLink(b)
    const seen: string[] = []
    la.onClose(() => seen.push('a'))
    lb.onClose(() => seen.push('b'))
    a.close()
    expect(seen.sort()).toEqual(['a', 'b'])
    a.close()
    expect(seen).toHaveLength(2)
  })

  it('closes the channel and the connection when closed on purpose, without sending after', () => {
    const { a } = channels()
    let connectionClosed = false
    const connection: ConnectionLike = {
      connectionState: 'connected',
      close: () => void (connectionClosed = true),
      addEventListener: () => {},
    }
    const la = new RtcLink(a, connection)
    let closed = 0
    la.onClose(() => closed++)
    la.close()
    expect(a.readyState).toBe('closed')
    expect(connectionClosed).toBe(true)
    expect(closed).toBe(1)
    expect(() => la.send(fire)).not.toThrow()
    expect(a.sent).toEqual([])
  })

  it('treats a failed connection as the end of the link', () => {
    const { a } = channels()
    let onChange: () => void = () => {}
    const connection = {
      connectionState: 'connected',
      close: () => {},
      addEventListener: (_: string, l: () => void) => void (onChange = l),
    }
    const la = new RtcLink(a, connection)
    let closed = 0
    la.onClose(() => closed++)
    connection.connectionState = 'disconnected' // can recover: wait
    onChange()
    expect(closed).toBe(0)
    connection.connectionState = 'failed'
    onChange()
    expect(closed).toBe(1)
  })

  it('survives a channel that throws on send', () => {
    const { a } = channels()
    const la = new RtcLink(a)
    let closed = 0
    la.onClose(() => closed++)
    a.readyState = 'open'
    a.send = () => {
      throw new Error('boom')
    }
    expect(() => la.send(fire)).not.toThrow()
    expect(closed).toBe(1)
  })
})
