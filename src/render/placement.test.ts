import { describe, expect, it } from 'vitest'
import { previewFlight } from '../game/attackerView'
import {
  ATTACK_OFFSET,
  BLOCK_SIZE,
  CANNON_SCREEN_X,
  FOG_SCREEN_X,
  MY_TOWER_X,
  PROJECTILE_RADIUS,
  TOWER_MAX_X,
  TOWER_MIN_X,
  TOWER_WIDTH,
} from '../game/constants'
import { muzzlePosition, simulateShot } from '../game/physics'
import { createTower } from '../game/tower'
import { cellRect, enemyPlacement, inwardMapX, mapPath, MY_PLACEMENT, outwardMapX } from './placement'

describe('screen layout', () => {
  it('puts your tower and your cannon next to each other, with the fog beyond', () => {
    const towerRight = MY_TOWER_X + TOWER_WIDTH
    expect(MY_TOWER_X).toBeGreaterThanOrEqual(0)
    expect(CANNON_SCREEN_X - towerRight).toBeGreaterThan(40) // room to breathe...
    expect(CANNON_SCREEN_X - towerRight).toBeLessThan(140) // ...but clearly side by side
    expect(FOG_SCREEN_X).toBeGreaterThan(CANNON_SCREEN_X + 150) // visible flight before the fog
  })

  it('keeps the peeked enemy tower on screen', () => {
    for (const x of [TOWER_MIN_X, TOWER_MAX_X]) {
      const p = enemyPlacement(createTower(x))
      expect(p.screenX + TOWER_WIDTH).toBeLessThanOrEqual(1000)
    }
  })
})

describe('your shots', () => {
  it('leave from the muzzle of the cannon drawn on screen', () => {
    const { path } = previewFlight({ angle: 45, power: 70 })
    const first = mapPath(path, outwardMapX)[0]
    const muzzle = muzzlePosition(45)
    expect(first.x).toBeCloseTo(CANNON_SCREEN_X + (muzzle.x - (CANNON_SCREEN_X - ATTACK_OFFSET)))
    expect(first.y).toBeCloseTo(muzzle.y)
  })

  it('vanish into the fog at the fog line on screen', () => {
    const { path, landsInView } = previewFlight({ angle: 45, power: 80 })
    expect(landsInView).toBe(false)
    const screen = mapPath(path, outwardMapX)
    expect(screen[screen.length - 1].x).toBeCloseTo(FOG_SCREEN_X)
  })
})

describe('enemy shots at your tower (mirrored)', () => {
  it('land on the block the physics says was hit, as drawn on screen', () => {
    let checked = 0
    for (const towerX of [TOWER_MIN_X, 650, 700, 750, TOWER_MAX_X]) {
      const tower = createTower(towerX)
      for (let angle = 25; angle <= 70; angle += 3) {
        for (let power = 55; power <= 100; power += 3) {
          const result = simulateShot(tower, { angle, power })
          if (!result.hit) continue
          const map = inwardMapX(tower)
          const rect = cellRect(MY_PLACEMENT, result.hit.cell)
          const x = map(result.impact.x)
          const r = PROJECTILE_RADIUS + 0.5
          expect(x).toBeGreaterThanOrEqual(rect.x - r)
          expect(x).toBeLessThanOrEqual(rect.x + rect.w + r)
          expect(result.impact.y).toBeGreaterThanOrEqual(rect.y - r)
          expect(result.impact.y).toBeLessThanOrEqual(rect.y + rect.h + r)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('draw the face the enemy hits (physics column 0) on the right-hand side', () => {
    const near = cellRect(MY_PLACEMENT, { row: 0, col: 0 })
    const far = cellRect(MY_PLACEMENT, { row: 0, col: 2 })
    expect(near.x).toBe(MY_TOWER_X + TOWER_WIDTH - BLOCK_SIZE)
    expect(far.x).toBe(MY_TOWER_X)
  })

  it('arrive from the fog, travelling towards your tower', () => {
    const tower = createTower(700)
    const result = simulateShot(tower, { angle: 45, power: 74 })
    const screen = mapPath(result.path, inwardMapX(tower))
    expect(screen[0].x).toBeGreaterThan(FOG_SCREEN_X) // starts hidden in the fog
    expect(screen[screen.length - 1].x).toBeLessThan(screen[0].x) // and heads left
  })

  it('fall short of your tower to its right, never inside it', () => {
    const tower = createTower(700)
    const result = simulateShot(tower, { angle: 45, power: 40 })
    expect(result.hit).toBeNull()
    const landed = inwardMapX(tower)(result.impact.x)
    expect(landed).toBeGreaterThan(MY_TOWER_X + TOWER_WIDTH)
  })
})
