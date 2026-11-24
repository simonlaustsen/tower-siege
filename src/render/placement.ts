import { ATTACK_OFFSET, BLOCK_SIZE, MY_TOWER_X, TOWER_COLS, TOWER_WIDTH } from '../game/constants'
import type { Vec } from '../game/physics'
import type { Cell, Rect, Tower } from '../game/tower'

/**
 * Where a tower stands on screen, and which way round it is drawn.
 *
 * Your own tower sits at the left, mirrored: the enemy's shots arrive from the right, so the
 * face they hit (column 0 in shot physics) is drawn on the right-hand side.
 */
export interface Placement {
  screenX: number
  mirrored: boolean
}

export const MY_PLACEMENT: Placement = { screenX: MY_TOWER_X, mirrored: true }

/** The enemy tower as shown while peeking: where your shots would reach it, not mirrored. */
export const enemyPlacement = (tower: Tower): Placement => ({ screenX: tower.x + ATTACK_OFFSET, mirrored: false })

/** Converts a shot-physics x to a screen x. */
export type MapX = (x: number) => number

/** Shots you fire: same direction as the physics, just shifted over to your slingshot. */
export const outwardMapX: MapX = (x) => x + ATTACK_OFFSET

/** Enemy shots at your tower: flipped, so the physics' near face lands on your tower's right side. */
export const inwardMapX =
  (tower: Tower): MapX =>
  (x) =>
    MY_TOWER_X + TOWER_WIDTH - (x - tower.x)

export const mapPath = (path: Vec[], mapX: MapX): Vec[] => path.map((p) => ({ x: mapX(p.x), y: p.y }))

/** Column as drawn on screen for a physics column. */
export const displayCol = (placement: Placement, col: number) => (placement.mirrored ? TOWER_COLS - 1 - col : col)

/** Screen rectangle of a block (y points up, like the physics). */
export function cellRect(placement: Placement, cell: Cell): Rect {
  return {
    x: placement.screenX + displayCol(placement, cell.col) * BLOCK_SIZE,
    y: cell.row * BLOCK_SIZE,
    w: BLOCK_SIZE,
    h: BLOCK_SIZE,
  }
}
