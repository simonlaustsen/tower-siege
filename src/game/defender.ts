import { MAX_ANGLE, MAX_POWER, MIN_ANGLE, MIN_POWER } from './constants'
import { classifyShot, type Feedback } from './feedback'
import { simulateShot, type ShotInput, type ShotResult } from './physics'
import { isCollapsed, type Tower } from './tower'

/** Returns the shot if it is a legal command, otherwise null. */
export function validateShotInput(angle: unknown, power: unknown): ShotInput | null {
  if (typeof angle !== 'number' || typeof power !== 'number') return null
  if (!Number.isFinite(angle) || !Number.isFinite(power)) return null
  if (angle < MIN_ANGLE || angle > MAX_ANGLE || power < MIN_POWER || power > MAX_POWER) return null
  return { angle, power }
}

export interface Resolution {
  /** Full details, for the defender's own screen only. Never sent to the attacker. */
  result: ShotResult
  /** The only part the attacker gets to see. */
  feedback: Feedback
  towerDown: boolean
}

/** Owns one player's tower and resolves incoming shots against it. */
export class Defender {
  private current: Tower

  constructor(tower: Tower) {
    this.current = tower
  }

  get tower(): Tower {
    return this.current
  }

  handleFire(input: ShotInput): Resolution {
    const result = simulateShot(this.current, input)
    const feedback = classifyShot(this.current, result)
    this.current = result.towerAfter
    return { result, feedback, towerDown: isCollapsed(this.current) }
  }
}
