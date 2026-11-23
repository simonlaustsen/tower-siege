import {
  BLOCK_SIZE,
  COLLAPSE_REMAINING_FRACTION,
  TOWER_COLS,
  TOWER_MAX_X,
  TOWER_MIN_X,
  TOWER_ROWS,
} from './constants'
import { MATERIALS, WOOD, type Material, type MaterialId } from './materials'

export interface Cell {
  row: number // 0 = bottom
  col: number // 0 = left
}

/**
 * A tower is a left-edge x position, a material and two grids: the hit points each block has now, and the
 * hit points it started with (0 = there never was a block there). A block that started weaker than the
 * material's norm is a "soft spot": a rotten beam that gives way at once.
 */
export interface Tower {
  x: number
  material: MaterialId
  hp: number[][] // hp[row][col]
  maxHp: number[][]
}

export interface Rect {
  x: number
  y: number // bottom edge (y points up)
  w: number
  h: number
}

/** A solid, full tower: every cell filled and equally strong. (The game itself uses `generateTower`.) */
export function createTower(x: number, material: Material = WOOD): Tower {
  const grid = () => Array.from({ length: TOWER_ROWS }, () => Array<number>(TOWER_COLS).fill(material.blockHp))
  return { x, material: material.id, hp: grid(), maxHp: grid() }
}

/** Share of ground-floor cells left open (a gap to walk through). */
const GROUND_GAP_CHANCE = 0.12
/** Share of the upper cells left open: the "windows" that make it a frame rather than a wall. */
const WINDOW_CHANCE = 0.3
/** A frame with fewer blocks than this is rebuilt: it would fall to a single shot. */
const MIN_BLOCKS = 10
/** Rotten beams per tower. */
const SOFT_SPOTS = 2
/** A soft spot's hit points. */
const SOFT_HP = 1

/**
 * A random timber frame: open bays here and there, every beam held up from the ground, and a couple of
 * rotten beams placed (mostly) where a lot rests on them, so that hitting one brings a good part of the
 * tower down. Nobody but its owner ever sees any of this.
 */
export function generateTower(x: number, random: () => number = Math.random, material: Material = WOOD): Tower {
  const toHp = (g: boolean[][]) => g.map((r) => r.map((v) => (v ? material.blockHp : 0)))

  let frame: boolean[][] | null = null
  for (let attempt = 0; attempt < 60 && !frame; attempt++) {
    const g = Array.from({ length: TOWER_ROWS }, (_, row) =>
      Array.from({ length: TOWER_COLS }, () => random() >= (row === 0 ? GROUND_GAP_CHANCE : WINDOW_CHANCE)),
    )
    // Beams that nothing holds up are not part of the tower.
    for (const c of findUnsupported(toHp(g))) g[c.row][c.col] = false
    const count = g.flat().filter(Boolean).length
    const standsOnTwo = g[0].filter(Boolean).length >= 2
    if (count >= MIN_BLOCKS && standsOnTwo && g[TOWER_ROWS - 1].some(Boolean)) frame = g
  }
  frame ??= Array.from({ length: TOWER_ROWS }, () => Array<boolean>(TOWER_COLS).fill(true))

  const hp = toHp(frame)

  // Pick the rotten beams, favouring the ones with the most resting on them.
  const total = hp.flat().filter((v) => v > 0).length
  const maxResting = Math.floor(total * (1 - COLLAPSE_REMAINING_FRACTION)) - 2
  const candidates: { cell: Cell; weight: number }[] = []
  forEachBlock({ hp } as Tower, (cell) => {
    const without = hp.map((r) => [...r])
    without[cell.row][cell.col] = 0
    const resting = findUnsupported(without).length
    // A rotten beam alone must not be able to end the game: what falls with it stays below the collapse line.
    if (resting <= maxResting) candidates.push({ cell, weight: 1 + resting * resting })
  })
  for (let n = 0; n < SOFT_SPOTS && candidates.length > 0; n++) {
    let pick = random() * candidates.reduce((sum, c) => sum + c.weight, 0)
    let i = 0
    while (i < candidates.length - 1 && (pick -= candidates[i].weight) > 0) i++
    const [{ cell }] = candidates.splice(i, 1)
    hp[cell.row][cell.col] = SOFT_HP
  }

  return { x, material: material.id, hp, maxHp: hp.map((r) => [...r]) }
}

/** A fresh wooden tower at a random distance, built at random: the defender's secret. */
export function randomTower(random: () => number = Math.random): Tower {
  return generateTower(Math.round(TOWER_MIN_X + random() * (TOWER_MAX_X - TOWER_MIN_X)), random)
}

export function materialOf(tower: Tower): Material {
  return MATERIALS[tower.material]
}

/** How many blocks the tower started with. */
export function initialBlocks(tower: Tower): number {
  return tower.maxHp.flat().filter((v) => v > 0).length
}

/** Total hit points of the tower when new. */
export function totalMaxHp(tower: Tower): number {
  return tower.maxHp.flat().reduce((sum, v) => sum + v, 0)
}

/** A rotten beam: weaker than the material's norm from the start. */
export function isSoft(tower: Tower, { row, col }: Cell): boolean {
  const start = tower.maxHp[row][col]
  return start > 0 && start < materialOf(tower).blockHp
}

/** How battered a block looks: 0 as new, 1 it has taken a hit, 2 it is on its last legs. */
export type DamageLevel = 0 | 1 | 2

export function damageLevel(tower: Tower, { row, col }: Cell): DamageLevel {
  const hp = tower.hp[row][col]
  const start = tower.maxHp[row][col]
  if (hp >= start) return 0
  return hp <= 1 ? 2 : 1
}

export function blockRect(tower: Tower, { row, col }: Cell): Rect {
  return { x: tower.x + col * BLOCK_SIZE, y: row * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }
}

export function forEachBlock(tower: Tower, fn: (cell: Cell, hp: number) => void): void {
  tower.hp.forEach((rowHp, row) =>
    rowHp.forEach((hp, col) => {
      if (hp > 0) fn({ row, col }, hp)
    }),
  )
}

export function countBlocks(tower: Tower): number {
  let n = 0
  forEachBlock(tower, () => n++)
  return n
}

export function isCollapsed(tower: Tower): boolean {
  return countBlocks(tower) <= Math.floor(initialBlocks(tower) * COLLAPSE_REMAINING_FRACTION)
}

/** Blocks not connected (via 4-neighbour block chains) to the ground row. */
export function findUnsupported(hp: number[][]): Cell[] {
  const supported = hp.map((r) => r.map(() => false))
  const stack: Cell[] = []
  for (let col = 0; col < TOWER_COLS; col++) {
    if (hp[0][col] > 0) {
      supported[0][col] = true
      stack.push({ row: 0, col })
    }
  }
  while (stack.length) {
    const { row, col } = stack.pop()!
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = row + dr
      const c = col + dc
      if (r < 0 || r >= TOWER_ROWS || c < 0 || c >= TOWER_COLS) continue
      if (hp[r][c] > 0 && !supported[r][c]) {
        supported[r][c] = true
        stack.push({ row: r, col: c })
      }
    }
  }
  const out: Cell[] = []
  hp.forEach((rowHp, row) =>
    rowHp.forEach((v, col) => {
      if (v > 0 && !supported[row][col]) out.push({ row, col })
    }),
  )
  return out
}

export interface DamageResult {
  tower: Tower
  destroyed: boolean
  /** Blocks that lost their support and fell as a consequence. */
  collapsed: Cell[]
}

export function applyDamage(tower: Tower, cell: Cell, damage = 1): DamageResult {
  const hp = tower.hp.map((r) => [...r])
  hp[cell.row][cell.col] = Math.max(0, hp[cell.row][cell.col] - damage)
  const destroyed = hp[cell.row][cell.col] === 0
  const collapsed = destroyed ? findUnsupported(hp) : []
  for (const c of collapsed) hp[c.row][c.col] = 0
  return { tower: { ...tower, hp }, destroyed, collapsed }
}
