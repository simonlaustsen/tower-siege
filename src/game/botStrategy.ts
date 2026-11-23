import { MAX_ANGLE, MAX_POWER, MIN_ANGLE, MIN_POWER } from './constants'
import type { FeedbackKind } from './feedback'
import type { ShotInput } from './physics'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const SHORT: FeedbackKind[] = ['far-short', 'near-short', 'pit']
const OVER: FeedbackKind[] = ['just-over', 'breach', 'too-far']

/**
 * Plays the way a person does: it only knows its own past shots and the
 * qualitative feedback each one got.
 *
 * At a fixed angle it brackets the power between "too short" and "too far"
 * (like a binary search). If the bracket closes without a hit, the angle is
 * the problem, so it picks a new one. Whenever a block is destroyed the
 * tower's shape has changed, so the old bracket is forgotten.
 */
export class ShotPlanner {
  private angle: number
  private power: number
  /** Highest power seen to fall short / lowest seen to go over, at the current angle. */
  private shortAt = 0
  private overAt = Infinity

  constructor(private random: () => number = Math.random) {
    this.angle = Math.round(38 + this.random() * 14)
    this.power = Math.round(55 + this.random() * 35)
  }

  next(): ShotInput {
    return { angle: this.angle, power: this.power }
  }

  /** Feed back the result of the shot returned by the last `next()` call. */
  learn(kind: FeedbackKind) {
    const p = this.power

    if (kind === 'too-high') {
      // The arc itself is too lofty: flatten it.
      this.changeAngle(this.angle - (4 + Math.round(this.random() * 3)))
    } else if (SHORT.includes(kind)) {
      this.shortAt = Math.max(this.shortAt, p)
      this.power = this.nextPower(p + (kind === 'far-short' ? 9 : kind === 'pit' ? 2 : 3))
    } else if (OVER.includes(kind)) {
      this.overAt = Math.min(this.overAt, p)
      this.power = this.nextPower(p - (kind === 'too-far' ? 6 : 2))
    } else if (kind === 'destroyed' || kind === 'collapse') {
      this.shortAt = 0 // the tower has a new shape: start the search afresh
      this.overAt = Infinity
    } // 'hit': same spot, same shot

    this.power = clamp(Math.round(this.power), MIN_POWER, MAX_POWER)
    this.angle = clamp(Math.round(this.angle), MIN_ANGLE, MAX_ANGLE)

    const bracketClosed = this.overAt - this.shortAt <= 1
    const outOfPower =
      (this.power >= MAX_POWER && SHORT.includes(kind)) || (this.power <= MIN_POWER && OVER.includes(kind))
    if (bracketClosed || outOfPower) {
      // No power at this angle gets a hit: try another angle.
      const toward45 = (45 - this.angle) * 0.4
      this.changeAngle(this.angle + (this.random() < 0.5 ? -1 : 1) * (3 + this.random() * 4) + (outOfPower ? toward45 : 0))
    }
  }

  /** Aim to land between the known short and over powers, else follow the plain step. */
  private nextPower(plain: number): number {
    if (Number.isFinite(this.overAt) && this.shortAt > 0) return (this.shortAt + this.overAt) / 2
    return plain
  }

  /** Switch angle, keeping the same landing distance by rescaling power (range ~ v^2 sin 2a). */
  private changeAngle(target: number) {
    const next = clamp(Math.round(target), MIN_ANGLE, MAX_ANGLE)
    if (next !== this.angle) {
      const ratio = Math.sin((2 * this.angle * Math.PI) / 180) / Math.sin((2 * next * Math.PI) / 180)
      this.power = clamp(Math.round(this.power * Math.sqrt(ratio)), MIN_POWER, MAX_POWER)
      this.angle = next
    }
    this.shortAt = 0
    this.overAt = Infinity
  }
}
