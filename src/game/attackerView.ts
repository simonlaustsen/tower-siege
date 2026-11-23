import { FOG_X } from './constants'
import { simulateShot, type ShotInput, type Vec } from './physics'
import { createTower } from './tower'

/** A tower so far away it can never be touched: what the attacker "knows" is out there. */
const EMPTY_FIELD = createTower(1e6)

export interface FlightPreview {
  /** Trajectory the attacker's screen may show: it ends at the fog line or at a visible landing. */
  path: Vec[]
  /** The ball hits the ground in plain view, before the fog. */
  landsInView: boolean
}

/**
 * What the attacker can work out for itself, without knowing anything about the
 * enemy tower. Physics is deterministic and every tower stands beyond the fog, so
 * the visible part of the flight is identical whatever the tower looks like.
 */
export function previewFlight(input: ShotInput): FlightPreview {
  const { path, impact } = simulateShot(EMPTY_FIELD, input)
  if (impact.x < FOG_X) return { path, landsInView: true }

  const visible: Vec[] = []
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    if (p.x <= FOG_X) {
      visible.push(p)
      continue
    }
    const prev = path[i - 1]
    const t = (FOG_X - prev.x) / (p.x - prev.x)
    visible.push({ x: FOG_X, y: prev.y + (p.y - prev.y) * t })
    break
  }
  return { path: visible, landsInView: false }
}
