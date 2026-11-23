import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../render/rng'
import { ShotPlanner } from './botStrategy'
import { MAX_ANGLE, MAX_POWER, MIN_ANGLE, MIN_POWER, TOWER_MAX_X, TOWER_MIN_X } from './constants'
import { Defender } from './defender'
import { generateTower } from './tower'

/** Shots the planner needs to bring a tower down, learning only from feedback. */
function shotsToWin(seed: number, towerX: number, cap = 300): number {
  const planner = new ShotPlanner(mulberry32(seed))
  const defender = new Defender(generateTower(towerX, mulberry32(seed * 7 + 1)))
  for (let n = 1; n <= cap; n++) {
    const { feedback, towerDown } = defender.handleFire(planner.next())
    if (towerDown) return n
    planner.learn(feedback.kind)
  }
  return Infinity
}

describe('ShotPlanner', () => {
  it('always proposes legal shots', () => {
    const planner = new ShotPlanner(mulberry32(1))
    const kinds = ['far-short', 'near-short', 'just-over', 'too-far', 'too-high', 'breach', 'pit', 'hit', 'destroyed', 'collapse'] as const
    for (let i = 0; i < 500; i++) {
      const s = planner.next()
      expect(s.angle).toBeGreaterThanOrEqual(MIN_ANGLE)
      expect(s.angle).toBeLessThanOrEqual(MAX_ANGLE)
      expect(s.power).toBeGreaterThanOrEqual(MIN_POWER)
      expect(s.power).toBeLessThanOrEqual(MAX_POWER)
      planner.learn(kinds[i % kinds.length])
    }
  })

  it('brings a tower down in a short, predictable number of shots', () => {
    const results: number[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const x = TOWER_MIN_X + ((TOWER_MAX_X - TOWER_MIN_X) * (seed % 8)) / 7
      results.push(shotsToWin(seed, Math.round(x)))
    }
    const sorted = [...results].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log('shots to win: min', sorted[0], 'median', median, 'max', sorted[sorted.length - 1])
    // Balance targets (see constants.ts): ~18 shots, with little luck involved.
    expect(sorted[sorted.length - 1]).toBeLessThan(40)
    expect(median).toBeGreaterThanOrEqual(12)
    expect(median).toBeLessThanOrEqual(26)
  })

  it('makes for short, fair duels between equal players', () => {
    const duels = 200
    let firstWins = 0
    let rounds = 0
    for (let g = 1; g <= duels; g++) {
      const r = mulberry32(g * 97)
      const pick = () => Math.round(TOWER_MIN_X + r() * (TOWER_MAX_X - TOWER_MIN_X))
      const pa = new ShotPlanner(mulberry32(g * 13))
      const pb = new ShotPlanner(mulberry32(g * 17))
      const da = new Defender(generateTower(pick(), r))
      const db = new Defender(generateTower(pick(), r))
      for (let n = 1; n <= 400; n++) {
        const a = db.handleFire(pa.next())
        if (a.towerDown) {
          firstWins++
          rounds += n
          break
        }
        pa.learn(a.feedback.kind)
        const b = da.handleFire(pb.next())
        if (b.towerDown) {
          rounds += n
          break
        }
        pb.learn(b.feedback.kind)
      }
    }
    const avgRounds = rounds / duels
    const firstShare = firstWins / duels
    console.log('duels: average rounds', avgRounds.toFixed(1), 'first mover wins', Math.round(firstShare * 100) + '%')
    expect(avgRounds).toBeLessThan(20) // roughly 4-5 minutes of play
    expect(firstShare).toBeGreaterThan(0.42) // going first is not a huge edge...
    expect(firstShare).toBeLessThan(0.65) // ...nor a handicap
  })
})
