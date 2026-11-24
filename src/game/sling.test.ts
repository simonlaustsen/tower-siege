import { describe, expect, it } from 'vitest'
import { MAX_ANGLE, MAX_POWER, MAX_PULL, MIN_ANGLE, MIN_POWER } from './constants'
import { aimFromPull, pullFromAim } from './sling'

describe('slingshot aiming', () => {
  it('turns a pull back into the aim it came from', () => {
    for (let angle = MIN_ANGLE; angle <= MAX_ANGLE; angle += 7) {
      for (let power = MIN_POWER; power <= MAX_POWER; power += 9) {
        expect(aimFromPull(pullFromAim({ angle, power }))).toEqual({ angle, power })
      }
    }
  })

  it('pulling down and back lobs the ball up and forward', () => {
    // pouch pulled to the lower left of the fork: pull vector points up and right
    const aim = aimFromPull({ dx: 40, dy: 40 })
    expect(aim.angle).toBe(45)
    expect(aim.power).toBe(Math.round((Math.hypot(40, 40) / MAX_PULL) * 100))
  })

  it('a longer pull is more power, up to a limit', () => {
    expect(aimFromPull({ dx: 20, dy: 20 }).power).toBeLessThan(aimFromPull({ dx: 40, dy: 40 }).power)
    expect(aimFromPull({ dx: 400, dy: 400 }).power).toBe(MAX_POWER)
    expect(aimFromPull({ dx: 1, dy: 0 }).power).toBe(MIN_POWER)
  })

  it('keeps the angle inside the allowed range wherever the finger goes', () => {
    for (let dx = -200; dx <= 200; dx += 25) {
      for (let dy = -200; dy <= 200; dy += 25) {
        const { angle, power } = aimFromPull({ dx, dy })
        expect(angle).toBeGreaterThanOrEqual(MIN_ANGLE)
        expect(angle).toBeLessThanOrEqual(MAX_ANGLE)
        expect(power).toBeGreaterThanOrEqual(MIN_POWER)
        expect(power).toBeLessThanOrEqual(MAX_POWER)
      }
    }
    expect(aimFromPull({ dx: 0, dy: 60 }).angle).toBe(MAX_ANGLE) // pulled straight down: straight up
    expect(aimFromPull({ dx: -60, dy: 10 }).angle).toBe(MAX_ANGLE) // pulled right of the fork: no further than straight up
    expect(aimFromPull({ dx: -60, dy: -3 }).angle).toBe(MAX_ANGLE)
    expect(aimFromPull({ dx: 10, dy: -60 }).angle).toBe(MIN_ANGLE) // dragged high above the fork: as steep a dive as allowed
  })

  it('pulling the pouch above the fork aims the ball downwards', () => {
    const aim = aimFromPull({ dx: 40, dy: -40 })
    expect(aim.angle).toBe(-45)
  })
})
