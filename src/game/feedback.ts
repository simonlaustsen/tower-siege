import { HIGH_CLEARANCE, NEAR_MISS_DISTANCE, NEAR_OVER_CLEARANCE, TOWER_HEIGHT, TOWER_WIDTH } from './constants'
import type { ShotResult } from './physics'
import type { Tower } from './tower'

export type FeedbackKind =
  | 'far-short'
  | 'near-short'
  | 'just-over'
  | 'too-far'
  | 'too-high'
  | 'breach' // sailed over a damaged part and landed beyond the tower
  | 'pit' // dropped into a hole and landed inside the tower's footprint
  | 'hit'
  | 'destroyed'
  | 'collapse'

export interface Feedback {
  kind: FeedbackKind
  title: string
  hint: string
  /** 'miss' = no contact, 'hit' = contact, 'big' = block destroyed / collapse */
  tone: 'miss' | 'hit' | 'big'
}

/**
 * Turn a shot result into attacker-visible feedback.
 * Only qualitative information is returned: never coordinates of the tower.
 */
export function classifyShot(towerBefore: Tower, result: ShotResult): Feedback {
  const { hit, flight } = result

  if (hit) {
    if (hit.collapsed.length > 0) {
      const n = hit.collapsed.length + 1
      return { kind: 'collapse', title: `Collapse! ${n} blocks came down`, hint: 'Keep the pressure on.', tone: 'big' }
    }
    if (hit.destroyed) {
      return { kind: 'destroyed', title: 'Block destroyed!', hint: 'Same shot, or aim for the next block.', tone: 'big' }
    }
    return { kind: 'hit', title: 'Hit! Block damaged', hint: 'Fire the same shot again to break it.', tone: 'hit' }
  }

  if (flight.passedThroughBox) {
    // The ball entered the tower's outline without touching a block. Where it came down
    // says which way to adjust: inside the footprint = too weak, beyond it = too strong.
    return flight.landedX <= towerBefore.x + TOWER_WIDTH
      ? { kind: 'pit', title: 'Dropped into a gap', hint: 'Add a little power.', tone: 'miss' }
      : { kind: 'breach', title: 'Flew through a gap', hint: 'Ease off a little, or aim lower.', tone: 'miss' }
  }

  if (flight.landedX < towerBefore.x) {
    const short = towerBefore.x - flight.landedX
    return short > NEAR_MISS_DISTANCE
      ? { kind: 'far-short', title: 'Far too short', hint: 'Add a lot more power.', tone: 'miss' }
      : { kind: 'near-short', title: 'Slightly short', hint: 'Add a little power.', tone: 'miss' }
  }

  const crossing = flight.crossing
  if (!crossing) return { kind: 'too-far', title: 'Too far', hint: 'Ease off the power.', tone: 'miss' }
  const clearance = crossing.y - TOWER_HEIGHT
  if (clearance < NEAR_OVER_CLEARANCE) {
    return { kind: 'just-over', title: 'Just over the top', hint: 'A touch less power or angle.', tone: 'miss' }
  }
  // Still climbing, or soaring far above the tower: the arc is too lofty.
  if (crossing.vy > 0 || clearance > HIGH_CLEARANCE) {
    return { kind: 'too-high', title: 'Too high', hint: 'Lower the angle.', tone: 'miss' }
  }
  return { kind: 'too-far', title: 'Too far', hint: 'Ease off the power.', tone: 'miss' }
}
