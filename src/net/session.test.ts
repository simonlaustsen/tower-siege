import { describe, expect, it } from 'vitest'
import { countBlocks, initialBlocks } from '../game/tower'
import { createLoopbackPair } from './link'
import { LocalSession, RemoteSession } from './session'

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

async function connected(latencyMs = 0) {
  const [a, b] = createLoopbackPair(latencyMs)
  const host = new RemoteSession(a, 'host')
  const guest = new RemoteSession(b, 'guest')
  await guest.ready
  return { host, guest, a, b }
}

describe('starting an online game', () => {
  it('sets both phones up with opposite turns and separate towers', async () => {
    const { host, guest } = await connected()
    expect(host.me.myTurn).not.toBe(guest.me.myTurn)
    expect(host.me.tower).not.toBe(guest.me.tower)
    expect(host.kind).toBe('remote')
    expect(host.role).toBe('host')
    expect(guest.role).toBe('guest')
  })

  it('lets the two phones play each other, turn about', async () => {
    const { host, guest } = await connected()
    const [first, second] = host.me.myTurn ? [host, guest] : [guest, host]
    const r1 = await first.me.fire(38, 84)
    expect(r1.type).toBe('result')
    expect(second.me.myTurn).toBe(true)
    await second.me.fire(45, 40)
    expect(first.me.myTurn).toBe(true)
  })

  it('tells the guest if the host speaks a different protocol version', async () => {
    const [raw, b] = createLoopbackPair(0)
    const guest = new RemoteSession(b, 'guest')
    raw.send({ type: 'hello', version: 99, youGoFirst: true })
    await expect(guest.ready).rejects.toThrow(/different version/)
  })

  it('fails the guest quickly if the connection dies before the game begins', async () => {
    const [raw, b] = createLoopbackPair(0)
    const guest = new RemoteSession(b, 'guest')
    raw.close()
    await expect(guest.ready).rejects.toThrow(/lost before the game began/)
  })
})

describe('rematch', () => {
  it('starts only when both players ask, with fresh towers', async () => {
    const { host, guest } = await connected()
    const [first, second] = host.me.myTurn ? [host, guest] : [guest, host]
    await first.me.fire(38, 84)
    const oldHost = host.me
    const oldGuest = guest.me
    let starts = 0
    host.onNewGame(() => starts++)
    guest.onNewGame(() => starts++)

    host.newGame()
    await tick()
    expect(starts).toBe(0) // one player asking is not enough
    expect(host.me).toBe(oldHost)

    guest.newGame()
    await tick()
    expect(starts).toBe(2)
    expect(host.me).not.toBe(oldHost)
    expect(guest.me).not.toBe(oldGuest)
    for (const { tower } of [host.me, guest.me]) {
      expect(tower.hp).toEqual(tower.maxHp) // untouched
      expect(countBlocks(tower)).toBe(initialBlocks(tower))
      expect(countBlocks(tower)).toBeGreaterThanOrEqual(10)
    }
    expect(host.me.myTurn).not.toBe(guest.me.myTurn)
    void second
  })

  it('works on the same connection, game after game', async () => {
    const { host, guest } = await connected()
    for (let game = 0; game < 3; game++) {
      const [first, second] = host.me.myTurn ? [host, guest] : [guest, host]
      await first.me.fire(45, 50)
      await second.me.fire(45, 50)
      host.newGame()
      guest.newGame()
      await tick()
      expect(host.connected && guest.connected).toBe(true)
    }
  })
})

describe('reconnecting', () => {
  it('carries on after the link drops and is replaced, with the game as it was', async () => {
    const { host, guest, a } = await connected()
    const [first, second] = host.me.myTurn ? [host, guest] : [guest, host]
    await first.me.fire(38, 84)
    const hpBefore = [host, guest].map((s) => s.me.tower.hp.flat().join(''))
    const drops: boolean[] = []
    host.onConnection((c) => drops.push(c))

    a.close()
    await tick()
    expect(host.connected).toBe(false)
    expect(guest.connected).toBe(false)

    const [na, nb] = createLoopbackPair(0)
    host.reconnect(na)
    guest.reconnect(nb)
    expect(host.connected && guest.connected).toBe(true)
    expect(drops).toEqual([false, true])
    expect([host, guest].map((s) => s.me.tower.hp.flat().join(''))).toEqual(hpBefore)
    await second.me.fire(45, 50) // the turn order carried over
    expect(first.me.myTurn).toBe(true)
  })

  it('finishes a shot that was in the air when the connection dropped', async () => {
    const { host, guest, a } = await connected(15)
    const [first, second] = host.me.myTurn ? [host, guest] : [guest, host]
    const pending = first.me.fire(38, 84)
    await tick(20) // the shot has landed; the reply is still on its way
    const hp = second.me.tower.hp.flat().reduce((s, v) => s + v, 0)
    a.close()
    await tick(50)

    const [na, nb] = createLoopbackPair(0)
    host.reconnect(na)
    guest.reconnect(nb)
    const reply = await pending
    expect(reply.type).toBe('result')
    expect(second.me.tower.hp.flat().reduce((s, v) => s + v, 0)).toBe(hp) // applied exactly once
  })

  it('remembers a rematch request across a reconnect', async () => {
    const { host, guest, a } = await connected()
    host.newGame()
    a.close()
    await tick()
    const old = guest.me
    const [na, nb] = createLoopbackPair(0)
    host.reconnect(na)
    guest.reconnect(nb)
    guest.newGame() // the host's earlier request was remembered: this completes it
    await tick()
    expect(guest.me).not.toBe(old)
  })
})

describe('playing the computer', () => {
  it('has the same shape as an online session', () => {
    const s = new LocalSession()
    expect(s.kind).toBe('local')
    expect(s.connected).toBe(true)
    expect(s.me.myTurn).toBe(true)
    expect(s.debugEnemyTower!().hp).toHaveLength(6)
    const before = s.me
    let started = 0
    s.onNewGame(() => started++)
    s.newGame()
    expect(started).toBe(1)
    expect(s.me).not.toBe(before)
    s.close()
  })
})
