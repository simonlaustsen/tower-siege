import { describe, expect, it } from 'vitest'
import { TOWER_MAX_X, TOWER_MIN_X, TOWER_WIDTH } from './constants'
import { classifyShot } from './feedback'
import { simulateShot } from './physics'
import { flightOf, initialEstimate, narrow, type Flight } from './rangeFinder'
import { createTower } from './tower'

/** A small deterministic random source, so a failure can be reproduced. */
function lcg(seed: number) {
  let s = seed
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
}

/** A flight known only by where it lands, for the cases that don't use its shape. */
const flat = (landing: number): Flight => ({ landing, path: [] })

describe('range finder', () => {
  it('starts with the range the rules allow', () => {
    expect(initialEstimate()).toEqual({ lo: TOWER_MIN_X, hi: TOWER_MAX_X })
  })

  it('never rules out where the real tower is, whatever the shots and hints', () => {
    const rnd = lcg(7)
    let narrowed = 0
    for (let game = 0; game < 300; game++) {
      const x = TOWER_MIN_X + Math.floor(rnd() * (TOWER_MAX_X - TOWER_MIN_X + 1))
      let tower = createTower(x)
      let estimate = initialEstimate()
      for (let shot = 0; shot < 25; shot++) {
        const input = { angle: 10 + Math.floor(rnd() * 71), power: 10 + Math.floor(rnd() * 91) }
        const result = simulateShot(tower, input)
        const { kind } = classifyShot(tower, result)
        estimate = narrow(estimate, flightOf(input), kind)
        expect(estimate.lo, `x=${x} ${JSON.stringify(input)} ${kind}`).toBeLessThanOrEqual(x + 1e-9)
        expect(estimate.hi, `x=${x} ${JSON.stringify(input)} ${kind}`).toBeGreaterThanOrEqual(x - 1e-9)
        tower = result.towerAfter
      }
      if (estimate.hi - estimate.lo < TOWER_MAX_X - TOWER_MIN_X) narrowed++
    }
    // ...and it is genuinely useful: most games end up with a tighter estimate than the rules alone.
    expect(narrowed).toBeGreaterThan(250)
  })

  it('closes in on the tower as shots land short and long', () => {
    const x = 700
    let estimate = initialEstimate()
    estimate = narrow(estimate, flat(520), 'far-short') // landed > 110 short
    expect(estimate.lo).toBeGreaterThan(TOWER_MIN_X)
    estimate = narrow(estimate, flat(760), 'too-high') // landed beyond the tower
    expect(estimate.hi).toBeLessThanOrEqual(760)
    expect(estimate.lo).toBeLessThanOrEqual(x)
    expect(estimate.hi).toBeGreaterThanOrEqual(x)
  })

  it('treats a breach as passing the whole tower', () => {
    expect(narrow(initialEstimate(), flat(740), 'breach').hi).toBe(740 - TOWER_WIDTH)
  })

  it('never produces an upside-down range', () => {
    const e = narrow({ lo: 700, hi: 710 }, flat(400), 'too-high')
    expect(e.lo).toBeLessThanOrEqual(e.hi)
  })
})
