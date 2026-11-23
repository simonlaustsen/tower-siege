import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../render/rng'
import { TOWER_COLS, TOWER_ROWS } from './constants'
import { WOOD } from './materials'
import {
  applyDamage,
  countBlocks,
  createTower,
  damageLevel,
  findUnsupported,
  forEachBlock,
  generateTower,
  initialBlocks,
  isCollapsed,
  isSoft,
  randomTower,
  type Cell,
  type Tower,
} from './tower'

const towers = (n: number) => Array.from({ length: n }, (_, i) => generateTower(700, mulberry32(i + 1)))
const cells = (t: Tower) => {
  const out: Cell[] = []
  forEachBlock(t, (c) => out.push(c))
  return out
}

describe('generated towers', () => {
  it('are built like a timber frame: always standing, never a trivial stump', () => {
    for (const t of towers(300)) {
      expect(findUnsupported(t.hp)).toEqual([]) // every beam is held up from the ground
      expect(countBlocks(t)).toBeGreaterThanOrEqual(10)
      expect(t.hp[0].filter((v) => v > 0).length).toBeGreaterThanOrEqual(2)
      expect(t.hp[TOWER_ROWS - 1].some((v) => v > 0)).toBe(true) // it still reaches the full height
      expect(t.hp).toEqual(t.maxHp) // brand new
      expect(isCollapsed(t)).toBe(false)
    }
  })

  it('are different every time, with open bays and not just solid walls', () => {
    const all = towers(100)
    const shapes = new Set(all.map((t) => t.hp.map((r) => r.map((v) => (v > 0 ? 1 : 0)).join('')).join('/')))
    expect(shapes.size).toBeGreaterThan(40)
    const gaps = all.map((t) => TOWER_ROWS * TOWER_COLS - countBlocks(t))
    expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeGreaterThan(2.5) // a frame, not a wall
  })

  it('can be rebuilt from a seed (so tests and replays are repeatable)', () => {
    expect(generateTower(650, mulberry32(9))).toEqual(generateTower(650, mulberry32(9)))
  })

  it('have rotten beams that are weaker than the rest', () => {
    for (const t of towers(200)) {
      const soft = cells(t).filter((c) => isSoft(t, c))
      expect(soft.length).toBe(2)
      for (const c of soft) expect(t.hp[c.row][c.col]).toBeLessThan(WOOD.blockHp)
      for (const c of cells(t).filter((c) => !isSoft(t, c))) expect(t.hp[c.row][c.col]).toBe(WOOD.blockHp)
    }
  })

  it('never let one rotten beam end the game on its own', () => {
    for (const t of towers(500)) {
      for (const c of cells(t).filter((c) => isSoft(t, c))) {
        const { tower } = applyDamage(t, c, 1)
        expect(isCollapsed(tower), `soft beam at ${c.row},${c.col}`).toBe(false)
      }
    }
  })

  it('lose far more per hit when the hit lands on a rotten beam', () => {
    // Breaking a beam takes its hit points' worth of hits; the beam and everything resting on it goes.
    let soft = 0
    let sound = 0
    let nSoft = 0
    let nSound = 0
    for (const t of towers(300)) {
      for (const c of cells(t)) {
        const hits = t.hp[c.row][c.col]
        const lost = 1 + applyDamage(t, c, hits).collapsed.length
        if (isSoft(t, c)) {
          soft += lost / hits
          nSoft++
        } else {
          sound += lost / hits
          nSound++
        }
      }
    }
    expect(soft / nSoft).toBeGreaterThan(2.5 * (sound / nSound))
  })

  it('can be told how battered they are', () => {
    const t = createTower(700)
    const cell = { row: 0, col: 0 }
    expect(damageLevel(t, cell)).toBe(0)
    const once = applyDamage(t, cell).tower
    expect(damageLevel(once, cell)).toBe(1)
    const twice = applyDamage(once, cell).tower
    expect(damageLevel(twice, cell)).toBe(2) // one hit from breaking
  })

  it('count their own starting size when deciding they have collapsed', () => {
    const t = randomTower(mulberry32(3))
    const start = initialBlocks(t)
    expect(start).toBeLessThan(TOWER_ROWS * TOWER_COLS + 1)
    let hp = t.hp.map((r) => [...r])
    let n = start
    forEachBlock(t, (c) => {
      if (n > Math.floor(start / 2)) {
        hp[c.row][c.col] = 0
        n--
      }
    })
    hp = hp.map((r) => [...r])
    expect(isCollapsed({ ...t, hp })).toBe(true)
  })
})
