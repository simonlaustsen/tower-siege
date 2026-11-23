import {
  CANNON_X,
  HIGH_CLEARANCE,
  NEAR_MISS_DISTANCE,
  NEAR_OVER_CLEARANCE,
  PROJECTILE_RADIUS,
  TOWER_HEIGHT,
  TOWER_MAX_X,
  TOWER_MIN_X,
  TOWER_WIDTH,
} from './constants'
import type { FeedbackKind } from './feedback'
import { simulateShot, type ShotInput, type Vec } from './physics'
import { createTower } from './tower'

/**
 * Where the enemy tower can be, worked out from nothing but what this phone is allowed to know:
 * the rules (a tower's left edge is somewhere between TOWER_MIN_X and TOWER_MAX_X), your own shots
 * (physics is deterministic, so you can compute where a shot lands when nothing is in the way) and the
 * qualitative hint each shot earned. It never sees the tower.
 */
export interface TowerEstimate {
  /** The tower's left edge is at least this far from the cannon (same x as shot physics). */
  lo: number
  /** ...and at most this far. */
  hi: number
}

export const initialEstimate = (): TowerEstimate => ({ lo: TOWER_MIN_X, hi: TOWER_MAX_X })

const EMPTY_FIELD = createTower(1e6)

/** A shot's flight over open ground: all you can work out for yourself about where it would come down. */
export interface Flight {
  /** Where it lands when nothing is in its way (the same x the enemy's feedback is measured against). */
  landing: number
  path: Vec[]
}

export function flightOf(input: ShotInput): Flight {
  const { path, impact } = simulateShot(EMPTY_FIELD, input)
  return { landing: impact.x, path }
}

/** Where a shot lands if nothing is in its way. */
export const landingX = (input: ShotInput): number => flightOf(input).landing

/** The path is sampled every few units, so bounds taken from it are widened by this much. */
const SAMPLE_SLACK = 8

/**
 * The x range over which the flight is at a height between `lo` and `hi` (and, if asked, descending). A
 * tower's front edge has to be somewhere in it for the shot to have passed over at that height.
 */
function xWhereAt(path: Vec[], lo: number, hi: number, descending: boolean): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (let i = 1; i < path.length; i++) {
    const p = path[i]
    if (p.x < TOWER_MIN_X - SAMPLE_SLACK || p.y < lo || p.y > hi) continue
    if (descending && p.y >= path[i - 1].y) continue
    min = Math.min(min, p.x)
    max = Math.max(max, p.x)
  }
  return min <= max ? [min - SAMPLE_SLACK, max + SAMPLE_SLACK] : null
}

/**
 * Narrow the estimate with one shot. `landing` is where the shot lands on open ground; `kind` is the hint
 * the enemy phone sent back. Every rule below follows from how `classifyShot` decides, so the real tower
 * always stays inside the estimate (a test checks that against thousands of random shots).
 */
export function narrow(estimate: TowerEstimate, flight: Flight, kind: FeedbackKind): TowerEstimate {
  const { landing, path } = flight
  let { lo, hi } = estimate
  /** Tighten with a range the tower's front edge must lie in. */
  const within = (range: [number, number] | null) => {
    if (!range) return
    lo = Math.max(lo, range[0])
    hi = Math.min(hi, range[1])
  }
  switch (kind) {
    case 'far-short':
      // Landed more than NEAR_MISS_DISTANCE before the tower.
      lo = Math.max(lo, landing + NEAR_MISS_DISTANCE)
      break
    case 'near-short':
      // Landed before the tower, but not by more than NEAR_MISS_DISTANCE.
      lo = Math.max(lo, landing)
      hi = Math.min(hi, landing + NEAR_MISS_DISTANCE)
      break
    case 'pit':
      // Dropped into the tower's footprint.
      lo = Math.max(lo, landing - TOWER_WIDTH)
      hi = Math.min(hi, landing)
      break
    case 'breach':
      // Flew over the tower's footprint and landed beyond it.
      hi = Math.min(hi, landing - TOWER_WIDTH)
      break
    case 'hit':
    case 'destroyed':
    case 'collapse':
      // The ball touched the tower, so it had reached it (give or take the ball's own size)...
      hi = Math.min(hi, landing + PROJECTILE_RADIUS)
      // ...and it was low enough to touch a block when it did, so the tower's far edge is at least that far.
      {
        const low = xWhereAt(path, -Infinity, TOWER_HEIGHT + PROJECTILE_RADIUS, false)
        if (low) lo = Math.max(lo, low[0] - TOWER_WIDTH - PROJECTILE_RADIUS)
      }
      break
    case 'just-over':
      // It passed the front edge only just above the top: the edge is where the flight is that high.
      hi = Math.min(hi, landing)
      within(xWhereAt(path, TOWER_HEIGHT - PROJECTILE_RADIUS, TOWER_HEIGHT + NEAR_OVER_CLEARANCE + 2, false))
      break
    case 'too-far':
      // It passed the front edge on the way down, a fair way above the top.
      hi = Math.min(hi, landing)
      within(xWhereAt(path, TOWER_HEIGHT + NEAR_OVER_CLEARANCE - 2, TOWER_HEIGHT + HIGH_CLEARANCE + 2, true))
      break
    default:
      // Too high: it got past the tower's left edge, still climbing or very high.
      hi = Math.min(hi, landing)
  }
  // A real tower is always inside; this only guards against a rounding hair.
  if (lo > hi) lo = hi = (lo + hi) / 2
  return { lo, hi }
}

/** The ruler on the range finder runs from the cannon to here. */
export const RULER_END = 1000
export const RULER_START = CANNON_X

/** The kind of result a hint describes, for marking your shots on the ruler. */
export function resultOf(kind: FeedbackKind): 'short' | 'over' | 'hit' | 'big' {
  switch (kind) {
    case 'far-short':
    case 'near-short':
    case 'pit':
      return 'short'
    case 'hit':
      return 'hit'
    case 'destroyed':
    case 'collapse':
      return 'big'
    default:
      return 'over'
  }
}
