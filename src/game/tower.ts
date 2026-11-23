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

/** A tower is a left-edge x position, a material and an hp grid. hp 0 means "no block". */
export interface Tower {
  x: number
  material: MaterialId
  hp: number[][] // hp[row][col]
}

export interface Rect {
  x: number
  y: number // bottom edge (y points up)
  w: number
  h: number
}

export function createTower(x: number, material: Material = WOOD): Tower {
  return {
    x,
    material: material.id,
    hp: Array.from({ length: TOWER_ROWS }, () => Array<number>(TOWER_COLS).fill(material.blockHp)),
  }
}

/** A fresh wooden tower at a random distance: the defender's secret. */
export function randomTower(random: () => number = Math.random): Tower {
  return createTower(Math.round(TOWER_MIN_X + random() * (TOWER_MAX_X - TOWER_MIN_X)))
}

export function materialOf(tower: Tower): Material {
  return MATERIALS[tower.material]
}

/** Total hit points of an undamaged tower of this material. */
export function towerMaxHp(material: Material): number {
  return TOWER_ROWS * TOWER_COLS * material.blockHp
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
  return countBlocks(tower) <= Math.floor(TOWER_ROWS * TOWER_COLS * COLLAPSE_REMAINING_FRACTION)
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
