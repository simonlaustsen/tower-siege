import { describe, expect, it } from 'vitest'
import { createTower } from '../game/tower'
import { isMessage, type ResultMessage } from './protocol'

const result = (reveal: unknown): unknown => ({
  type: 'result',
  id: 1,
  feedback: { kind: 'hit', title: 'Hit!', hint: 'Again.', tone: 'hit' },
  reveal,
  towerDown: false,
})

describe('result message', () => {
  it('accepts a tower snapshot', () => {
    const msg: ResultMessage = result(createTower(700)) as ResultMessage
    expect(isMessage(msg)).toBe(true)
  })

  it('refuses a result without a snapshot, or with a malformed one', () => {
    const tower = createTower(700)
    expect(isMessage(result(undefined))).toBe(false)
    expect(isMessage(result({ ...tower, material: 'gold' }))).toBe(false)
    expect(isMessage(result({ ...tower, x: Infinity }))).toBe(false)
    expect(isMessage(result({ ...tower, hp: tower.hp.slice(1) }))).toBe(false)
    expect(isMessage(result({ ...tower, maxHp: [[1]] }))).toBe(false)
    expect(isMessage(result({ ...tower, hp: tower.hp.map((row) => row.map(() => 'x')) }))).toBe(false)
  })
})
