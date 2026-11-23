import { describe, expect, it } from 'vitest'
import { createTower } from '../game/tower'
import { createLoopbackPair } from './link'
import { Peer } from './peer'
import type { Message } from './protocol'

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
const hpSum = (p: Peer) => p.tower.hp.flat().reduce((s, v) => s + v, 0)

/** Two peers; A fires first. Returns the link ends too so a test can break them. */
function pair(latencyMs = 0, timeoutMs = 500) {
  const [la, lb] = createLoopbackPair(latencyMs)
  const a = new Peer(la, createTower(700), true, timeoutMs)
  const b = new Peer(lb, createTower(750), false, timeoutMs)
  return { a, b, la, lb }
}

describe('losing and regaining the connection', () => {
  it('both sides notice a dropped link, and again when it comes back', async () => {
    const { a, b, la } = pair()
    const seen: string[] = []
    a.onConnection((c) => seen.push(`a:${c}`))
    b.onConnection((c) => seen.push(`b:${c}`))
    la.close()
    await tick()
    expect(a.connected).toBe(false)
    expect(b.connected).toBe(false)
    const [na, nb] = createLoopbackPair(0)
    a.attachLink(na)
    b.attachLink(nb)
    expect(seen.sort()).toEqual(['a:false', 'a:true', 'b:false', 'b:true'])
  })

  it('carries on after a reconnect with the game exactly as it was', async () => {
    const { a, b, la } = pair()
    await a.fire(38, 84)
    const aBefore = hpSum(a)
    const bBefore = hpSum(b)
    la.close()
    await tick()
    await expect(b.fire(45, 50)).rejects.toThrow(/Connection lost/) // can't fire into the void
    expect(b.myTurn).toBe(true) // ...and that did not use up the turn

    const [na, nb] = createLoopbackPair(0)
    a.attachLink(na)
    b.attachLink(nb)
    expect(hpSum(a)).toBe(aBefore)
    expect(hpSum(b)).toBe(bBefore)
    await b.fire(45, 50) // B's turn, as before the drop
    await a.fire(38, 84)
    expect(a.over).toBeNull()
  })

  it('re-sends an unanswered shot and gets an answer once reconnected', async () => {
    const [la] = createLoopbackPair(0)
    const a = new Peer(la, createTower(700), true, 20) // nobody on the far end
    const pending = a.fire(38, 84)
    await tick(60)
    expect(a.connected).toBe(false)

    const [na, nb] = createLoopbackPair(0)
    const b = new Peer(nb, createTower(750), false)
    a.attachLink(na)
    const reply = await pending
    expect(reply.feedback.kind).toBe('hit')
    expect(b.myTurn).toBe(true)
  })

  it('applies a shot once even if its answer is lost and the shot is sent again', async () => {
    const { a, b, la } = pair(20)
    const arrivals: number[] = []
    b.onIncoming(() => arrivals.push(1))

    const pending = a.fire(38, 84)
    await tick(30) // the shot has reached B and been resolved; B's answer is on its way back
    const hpAfterFirst = hpSum(b)
    expect(hpAfterFirst).toBeLessThan(18 * 2)
    la.close() // ...and the answer is lost
    await tick(60)
    expect(a.connected).toBe(false)

    const [na, nb] = createLoopbackPair(0)
    b.attachLink(nb)
    a.attachLink(na) // A sends the same shot again
    const reply = await pending
    expect(reply.feedback.kind).toBe('hit')
    expect(hpSum(b)).toBe(hpAfterFirst) // not applied a second time
    expect(arrivals).toHaveLength(1) // and B's screen was not told twice
  })

  it('answers every repeat of a shot with the very same reply, applying it only once', async () => {
    // A bare link stands in for the attacker, so the same fire message can be sent over and over.
    const [raw, lb] = createLoopbackPair(0)
    const defender = new Peer(lb, createTower(750), false)
    const replies: Message[] = []
    raw.onMessage((m) => replies.push(m))

    const fire: Message = { type: 'fire', id: 3, angle: 38, power: 84 }
    raw.send(fire)
    await tick()
    const hpAfterOnce = hpSum(defender)
    expect(hpAfterOnce).toBeLessThan(18 * 2) // it did land

    raw.send(fire)
    raw.send(fire)
    await tick()
    expect(replies).toHaveLength(3)
    expect(replies[1]).toEqual(replies[0])
    expect(replies[2]).toEqual(replies[0])
    expect(hpSum(defender)).toBe(hpAfterOnce)
  })

  it('hands shots that arrive before anyone is listening to the first listener', async () => {
    const { a, b } = pair()
    await a.fire(38, 84) // fired at B while B's screen has not subscribed yet
    const got: number[] = []
    b.onIncoming(({ input }) => got.push(input.angle)) // subscribes late
    expect(got).toEqual([38])
    b.onIncoming(({ input }) => got.push(input.angle)) // a second late listener gets nothing extra
    expect(got).toEqual([38])
  })

  it('can be disposed without closing the link, for a rematch on the same connection', async () => {
    const [la, lb] = createLoopbackPair(0)
    const a1 = new Peer(la, createTower(700), true)
    const b1 = new Peer(lb, createTower(750), false)
    await a1.fire(45, 50)
    a1.dispose({ keepLink: true })
    b1.dispose({ keepLink: true })

    const a2 = new Peer(la, createTower(650), true)
    const b2 = new Peer(lb, createTower(720), false)
    const reply = await a2.fire(45, 50) // the link still works
    expect(reply.type).toBe('result')
    expect(b2.myTurn).toBe(true)
  })

  it('does not report a lost connection when a peer is disposed on purpose', async () => {
    const [la, lb] = createLoopbackPair(0)
    const a = new Peer(la, createTower(700), true)
    const b = new Peer(lb, createTower(750), false)
    const seen: boolean[] = []
    a.onConnection((c) => seen.push(c))
    a.dispose()
    await tick()
    expect(seen).toEqual([])
    expect(b.connected).toBe(false) // the far side does find out
  })
})
