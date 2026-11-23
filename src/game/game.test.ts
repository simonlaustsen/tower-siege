import { describe, expect, it } from 'vitest'
import { GRAVITY, MAX_SPEED, TOWER_COLS, TOWER_MAX_X, TOWER_MIN_X, TOWER_ROWS } from './constants'
import { classifyShot } from './feedback'
import { WOOD } from './materials'
import { muzzlePosition, simulateShot } from './physics'
import { applyDamage, countBlocks, createTower, isCollapsed } from './tower'

const FAR_TOWER_X = 800

describe('physics', () => {
  it('is deterministic', () => {
    const t = createTower(FAR_TOWER_X)
    expect(simulateShot(t, { angle: 40, power: 80 })).toEqual(simulateShot(t, { angle: 40, power: 80 }))
  })

  it('lands near the analytic range for a ground-level 45° shot', () => {
    const t = createTower(5000) // out of the way
    const r = simulateShot(t, { angle: 45, power: 60 })
    const v = 0.6 * MAX_SPEED
    const m = muzzlePosition(45)
    // Launched from a raised muzzle, so range is slightly longer than v²/g.
    const flat = (v * v) / GRAVITY
    expect(r.impact.x - m.x).toBeGreaterThan(flat * 0.98)
    expect(r.impact.x - m.x).toBeLessThan(flat * 1.15)
  })

  it('damages, then destroys a block with repeated identical shots', () => {
    let tower = createTower(FAR_TOWER_X)
    const shot = { angle: 38, power: 84 }
    const first = simulateShot(tower, shot)
    expect(first.hit).not.toBeNull()
    expect(first.hit!.destroyed).toBe(false)
    expect(classifyShot(tower, first).kind).toBe('hit')
    const { row, col } = first.hit!.cell
    tower = first.towerAfter
    expect(tower.hp[row][col]).toBe(WOOD.blockHp - 1)
    // Sound beams take several hits; the same shot keeps landing on the same block until it breaks.
    for (let n = 2; n < WOOD.blockHp; n++) {
      const again = simulateShot(tower, shot)
      expect(again.hit!.destroyed).toBe(false)
      tower = again.towerAfter
    }
    expect(simulateShot(tower, shot).hit!.destroyed).toBe(true)
  })

})

describe('tower structure', () => {
  it('collapses everything above a severed row, and nothing below', () => {
    const tower = createTower(0)
    // Leave only one weak block in row 3.
    const hp = tower.hp.map((r) => [...r])
    for (let c = 1; c < TOWER_COLS; c++) hp[3][c] = 0
    hp[3][0] = 1
    const result = applyDamage({ ...tower, hp }, { row: 3, col: 0 })
    expect(result.destroyed).toBe(true)
    expect(result.collapsed).toHaveLength((TOWER_ROWS - 4) * TOWER_COLS)
    expect(countBlocks(result.tower)).toBe(3 * TOWER_COLS)
  })

  it('reports collapse when few blocks remain', () => {
    const t = createTower(0)
    expect(isCollapsed(t)).toBe(false)
    const hp = t.hp.map((r, i) => (i === 0 ? r.map(() => 1) : r.map(() => 0)))
    expect(isCollapsed({ ...t, hp })).toBe(true)
  })
})

describe('gap feedback', () => {
  /** A tower with a pocket dug out of the bottom-left and the top row shaved off. */
  const damaged = () => {
    const t = createTower(700)
    const hp = t.hp.map((r) => [...r])
    for (let r = 0; r <= 4; r++) hp[r][0] = 0 // pocket
    for (let r = 0; r <= 1; r++) hp[r][1] = 0
    for (let c = 0; c < TOWER_COLS; c++) hp[TOWER_ROWS - 1][c] = 0 // shaved top
    return { ...t, hp }
  }

  it('tells "dropped into a gap" (needs power) from "flew through" (needs less)', () => {
    const tower = damaged()
    const byKind = new Map<string, number[]>()
    for (let power = 50; power <= 100; power += 0.5) {
      const r = simulateShot(tower, { angle: 45, power })
      const kind = classifyShot(tower, r).kind
      byKind.set(kind, [...(byKind.get(kind) ?? []), power])
    }
    const pit = byKind.get('pit')
    const breach = byKind.get('breach')
    expect(pit, 'pit never occurred').toBeDefined()
    expect(breach, 'breach never occurred').toBeDefined()
    // A pit means too weak, so it sits at lower power than a breach (too strong).
    expect(Math.max(...pit!)).toBeLessThan(Math.min(...breach!))
  })
})

describe('feedback', () => {
  const tower = createTower(FAR_TOWER_X)
  const kind = (angle: number, power: number) => classifyShot(tower, simulateShot(tower, { angle, power })).kind

  it('says far-short for weak shots', () => expect(kind(45, 30)).toBe('far-short'))
  it('says too-high for a powerful 45° lob that soars over a nearer tower', () => {
    const near = createTower(620)
    expect(classifyShot(near, simulateShot(near, { angle: 45, power: 100 })).kind).toBe('too-high')
  })
  it('never reports a hit for a short shot', () => {
    expect(simulateShot(tower, { angle: 45, power: 50 }).hit).toBeNull()
  })
  it('can produce every feedback kind across tower positions', () => {
    const seen = new Set<string>()
    for (const x of [TOWER_MIN_X, 700, TOWER_MAX_X]) {
      const t = createTower(x)
      for (let angle = 10; angle <= 80; angle += 1) {
        for (let power = 10; power <= 100; power += 0.5) {
          seen.add(classifyShot(t, simulateShot(t, { angle, power })).kind)
        }
      }
    }
    // (the gap kinds need a damaged tower: see 'gap feedback')
    for (const k of ['far-short', 'near-short', 'just-over', 'too-far', 'too-high', 'hit']) {
      expect(seen, `missing ${k}`).toContain(k)
    }
  })
})
