import { describe, expect, it } from 'vitest'
import { previewFlight } from '../game/attackerView'
import { ShotPlanner } from '../game/botStrategy'
import { FOG_X } from '../game/constants'
import { Defender } from '../game/defender'
import { simulateShot } from '../game/physics'
import { createTower } from '../game/tower'
import { WOOD } from '../game/materials'
import { createLoopbackPair } from './link'
import { Peer } from './peer'
import type { Message } from './protocol'

/** Two peers on a zero-latency link; A fires first. */
function pair(towerA = 700, towerB = 750) {
  const [la, lb] = createLoopbackPair(0)
  const a = new Peer(la, createTower(towerA), true, 500)
  const b = new Peer(lb, createTower(towerB), false, 500)
  return { a, b, la, lb }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

describe('loopback link', () => {
  it('delivers copies, never shared references', async () => {
    const [a, b] = createLoopbackPair(0)
    const sent: Message = { type: 'fire', id: 1, angle: 40, power: 60 }
    const got = new Promise<Message>((res) => b.onMessage(res))
    a.send(sent)
    const received = await got
    expect(received).toEqual(sent)
    expect(received).not.toBe(sent)
  })

  it('drops messages after close', async () => {
    const [a, b] = createLoopbackPair(0)
    let n = 0
    b.onMessage(() => n++)
    a.close()
    a.send({ type: 'fire', id: 1, angle: 40, power: 60 })
    await tick()
    expect(n).toBe(0)
  })
})

describe('peers', () => {
  it('returns the same feedback the defender computes locally', async () => {
    const { a } = pair()
    const direct = new Defender(createTower(750)).handleFire({ angle: 38, power: 84 })
    const reply = await a.fire(38, 84)
    expect(reply.feedback).toEqual(direct.feedback)
    expect(reply.towerDown).toBe(direct.towerDown)
  })

  it('leaks nothing about the tower in a reply', async () => {
    const { a } = pair()
    const reply = await a.fire(38, 84)
    expect(Object.keys(reply).sort()).toEqual(['feedback', 'id', 'towerDown', 'type'])
    const wire = JSON.stringify(reply)
    for (const secret of ['hp', 'path', 'impact', '750', 'towerAfter']) expect(wire).not.toContain(secret)
  })

  it('only lets you fire on your turn, and alternates', async () => {
    const { a, b } = pair()
    await expect(b.fire(45, 50)).rejects.toThrow(/not your turn/)
    await a.fire(45, 50)
    await expect(a.fire(45, 50)).rejects.toThrow(/not your turn/)
    expect(b.myTurn).toBe(true)
    await b.fire(45, 50)
    expect(a.myTurn).toBe(true)
    await a.fire(45, 50)
  })

  it('rejects a fire message that arrives out of turn', async () => {
    const { a, lb } = pair()
    const replies: Message[] = []
    lb.onMessage((m) => replies.push(m))
    // A is on turn, so B (a cheater or a bug) may not fire at it.
    lb.send({ type: 'fire', id: 99, angle: 45, power: 50 })
    await tick()
    expect(replies).toEqual([{ type: 'rejected', id: 99, reason: 'it is not your turn to fire' }])
    expect(a.tower.hp.flat().every((v) => v === WOOD.blockHp)).toBe(true) // untouched
  })

  it('rejects illegal commands without using up the turn', async () => {
    const { a } = pair()
    await expect(a.fire(200, 50)).rejects.toThrow(/rejected/)
    await expect(a.fire(45, Number.NaN)).rejects.toThrow(/rejected/)
    expect(a.myTurn).toBe(true)
    await a.fire(45, 50)
  })

  it('notifies the defender of incoming shots, with full details', async () => {
    const { a, b } = pair()
    const seen: number[] = []
    b.onIncoming(({ input, resolution }) => seen.push(input.angle, resolution.result.path.length))
    await a.fire(38, 84)
    expect(seen[0]).toBe(38)
    expect(seen[1]).toBeGreaterThan(2)
    expect(b.myTurn).toBe(true)
  })

  it('goes offline, rather than failing, when the other phone is silent', async () => {
    const [la] = createLoopbackPair(0)
    const lonely = new Peer(la, createTower(700), true, 20)
    const states: boolean[] = []
    lonely.onConnection((c) => states.push(c))
    void lonely.fire(45, 50).catch(() => {}) // stays pending: it will be re-sent after a reconnect
    await tick(60)
    expect(lonely.connected).toBe(false)
    expect(states).toEqual([false])
    await expect(lonely.fire(45, 50)).rejects.toThrow(/not your turn/) // the first shot still holds the turn
  })

  it('ends the game when a tower collapses', async () => {
    const { a, b } = pair(700, 750)
    const planner = new ShotPlanner(() => 0.5)
    let wins = false
    for (let i = 0; i < 400 && !wins; i++) {
      const s = planner.next()
      const reply = await a.fire(s.angle, s.power)
      planner.learn(reply.feedback.kind)
      if (reply.towerDown) wins = true
      else await b.fire(45, 10) // B's shots always drop short
    }
    expect(wins).toBe(true)
    expect(a.over).toBe('won')
    expect(b.over).toBe('lost')
    await expect(a.fire(45, 50)).rejects.toThrow(/over/)
  })
})

describe('attacker preview (no knowledge of the tower)', () => {
  it('never shows anything beyond the fog line', () => {
    for (const [angle, power] of [[45, 70], [30, 100], [70, 60], [15, 40]]) {
      const { path } = previewFlight({ angle, power })
      expect(Math.max(...path.map((p) => p.x))).toBeLessThanOrEqual(FOG_X + 1e-9)
    }
  })

  it('matches the real flight wherever the tower is', () => {
    for (const towerX of [600, 700, 780]) {
      const tower = createTower(towerX)
      for (const [angle, power] of [[45, 70], [35, 90], [55, 80]]) {
        const real = simulateShot(tower, { angle, power }).path
        const seen = previewFlight({ angle, power }).path
        // all but the interpolated last point are exactly the real trajectory
        for (let i = 0; i < seen.length - 1; i++) expect(seen[i]).toEqual(real[i])
      }
    }
  })

  it('shows a ground landing only when it happens in plain view', () => {
    expect(previewFlight({ angle: 45, power: 20 }).landsInView).toBe(true)
    expect(previewFlight({ angle: 45, power: 80 }).landsInView).toBe(false)
  })
})
