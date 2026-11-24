import {
  SLING_X,
  SLING_Y,
  GRAVITY,
  MAX_SIM_STEPS,
  MAX_SPEED,
  PATH_SAMPLE_EVERY,
  PROJECTILE_RADIUS,
  SIM_DT,
  TOWER_COLS,
  TOWER_HEIGHT,
  TOWER_ROWS,
  TOWER_WIDTH,
  WORLD_W,
} from './constants'
import { applyDamage, blockRect, type Cell, type Tower } from './tower'

export interface Vec {
  x: number
  y: number
}

export interface ShotInput {
  angle: number // degrees
  power: number // percent
}

export interface HitInfo {
  cell: Cell
  destroyed: boolean
  collapsed: Cell[]
}

/** Raw facts about the flight, used to derive feedback without leaking tower geometry. */
export interface FlightSummary {
  landedX: number
  /** Projectile was inside the tower's bounding box without touching a block. */
  passedThroughBox: boolean
  /** State when the projectile crossed the tower's near face (x = tower.x). */
  crossing: { y: number; vy: number } | null
}

export interface ShotResult {
  /** Sampled trajectory, first point is the muzzle, last is the impact. */
  path: Vec[]
  impact: Vec
  hit: HitInfo | null
  towerAfter: Tower
  flight: FlightSummary
}

/** Where the ball is released: the fork of the slingshot, whatever the angle. */
export function muzzlePosition(_angleDeg?: number): Vec {
  return { x: SLING_X, y: SLING_Y }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Closest block overlapping the circle, if any. */
function collide(tower: Tower, p: Vec): Cell | null {
  const r = PROJECTILE_RADIUS
  if (p.x + r < tower.x || p.x - r > tower.x + TOWER_WIDTH || p.y - r > TOWER_HEIGHT) return null
  let best: Cell | null = null
  let bestD2 = Infinity
  for (let row = 0; row < TOWER_ROWS; row++) {
    for (let col = 0; col < TOWER_COLS; col++) {
      if (tower.hp[row][col] <= 0) continue
      const b = blockRect(tower, { row, col })
      const dx = p.x - clamp(p.x, b.x, b.x + b.w)
      const dy = p.y - clamp(p.y, b.y, b.y + b.h)
      const d2 = dx * dx + dy * dy
      if (d2 <= r * r && d2 < bestD2) {
        best = { row, col }
        bestD2 = d2
      }
    }
  }
  return best
}

/**
 * Deterministic, fixed-timestep simulation of one shot against one tower.
 * Pure: same inputs always give the same result, so it can run on a host
 * phone and be replayed on a client.
 */
export function simulateShot(tower: Tower, { angle, power }: ShotInput): ShotResult {
  const a = (angle * Math.PI) / 180
  const speed = (power / 100) * MAX_SPEED
  const start = muzzlePosition(angle)
  let x = start.x
  let y = start.y
  let vx = Math.cos(a) * speed
  let vy = Math.sin(a) * speed

  const path: Vec[] = [{ x, y }]
  const flight: FlightSummary = { landedX: x, passedThroughBox: false, crossing: null }
  let hit: HitInfo | null = null
  let towerAfter = tower

  for (let step = 1; step <= MAX_SIM_STEPS; step++) {
    const px = x
    const py = y
    vy -= GRAVITY * SIM_DT
    x += vx * SIM_DT
    y += vy * SIM_DT

    if (flight.crossing === null && px < tower.x && x >= tower.x) {
      const t = (tower.x - px) / (x - px)
      flight.crossing = { y: py + (y - py) * t, vy }
    }

    const cell = collide(tower, { x, y })
    if (cell) {
      const dmg = applyDamage(tower, cell)
      towerAfter = dmg.tower
      hit = { cell, destroyed: dmg.destroyed, collapsed: dmg.collapsed }
      path.push({ x, y })
      break
    }

    if (x >= tower.x && x <= tower.x + TOWER_WIDTH && y >= 0 && y <= TOWER_HEIGHT) {
      flight.passedThroughBox = true
    }

    if (y - PROJECTILE_RADIUS <= 0) {
      y = PROJECTILE_RADIUS
      path.push({ x, y })
      break
    }
    if (x > WORLD_W + 400 || x < -400) {
      path.push({ x, y })
      break
    }
    if (step % PATH_SAMPLE_EVERY === 0) path.push({ x, y })
  }

  const impact = path[path.length - 1]
  flight.landedX = impact.x
  return { path, impact, hit, towerAfter, flight }
}
