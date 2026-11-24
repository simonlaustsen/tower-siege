import { MAX_ANGLE, MAX_POWER, MAX_PULL, MIN_ANGLE, MIN_POWER } from './constants'
import type { ShotInput } from './physics'

/**
 * The slingshot: you pull the pouch back from the fork, and the ball flies the opposite way.
 * The direction of the pull sets the angle and its length sets the power.
 *
 * Pull vectors are measured from the pouch to the fork, in world units with y pointing up, so they
 * point the way the ball will go.
 */
export interface Pull {
  dx: number
  dy: number
}

const RAD = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The aim a given pull gives, rounded to whole degrees and percent and kept inside the allowed range. */
export function aimFromPull({ dx, dy }: Pull): ShotInput {
  // Degrees counted up from flat-forward: 90 is straight up, negative is aiming down. Pulled right of the fork
  // (past straight up) is as steep as allowed; dragged above the fork on the far side, the same.
  let degrees = Math.atan2(dy, dx) / RAD
  if (degrees < -170) degrees = MAX_ANGLE
  const angle = clamp(Math.round(degrees), MIN_ANGLE, MAX_ANGLE)
  const power = clamp(Math.round((Math.hypot(dx, dy) / MAX_PULL) * 100), MIN_POWER, MAX_POWER)
  return { angle, power }
}

/** Where the pouch sits (relative to the fork, y up it points back along the pull) for an aim. */
export function pullFromAim({ angle, power }: ShotInput): Pull {
  const length = (power / 100) * MAX_PULL
  return { dx: Math.cos(angle * RAD) * length, dy: Math.sin(angle * RAD) * length }
}

