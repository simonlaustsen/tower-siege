import type { MaterialId } from '../game/materials'
import { paintWoodBlock, WOOD_VARIANTS } from './wood'

/** How a block should be drawn, beyond its position-based variant. */
export interface BlockLook {
  /** 0 as new, 1 it has taken a hit, 2 it is one hit from breaking. */
  damage: 0 | 1 | 2
  /** A rotten beam (a soft spot): it was weaker than the rest from the start. */
  rotten: boolean
}

interface BlockPainter {
  /** How many different looks the material has (picked per block by position). */
  variants: number
  /** Paint one block. */
  paint: (ctx: CanvasRenderingContext2D, variant: number, look: BlockLook) => void
}

/** One painter per material. To add stone: write the material, then register `paintStoneBlock` (stone.ts) here. */
const PAINTERS: Record<MaterialId, BlockPainter> = {
  wood: { variants: WOOD_VARIANTS, paint: paintWoodBlock },
}

export const blockVariants = (material: MaterialId) => PAINTERS[material].variants

export function paintBlock(ctx: CanvasRenderingContext2D, material: MaterialId, variant: number, look: BlockLook) {
  const painter = PAINTERS[material]
  painter.paint(ctx, variant % painter.variants, look)
}
