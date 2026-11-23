import type { MaterialId } from '../game/materials'
import { paintWoodBlock, WOOD_VARIANTS } from './wood'

interface BlockPainter {
  /** How many different looks the material has (picked per block by position). */
  variants: number
  /** Paint one block; `damaged` means it has lost hit points. */
  paint: (ctx: CanvasRenderingContext2D, variant: number, damaged: boolean) => void
}

/** One painter per material. To add stone: write the material, then register `paintStoneBlock` (stone.ts) here. */
const PAINTERS: Record<MaterialId, BlockPainter> = {
  wood: { variants: WOOD_VARIANTS, paint: paintWoodBlock },
}

export const blockVariants = (material: MaterialId) => PAINTERS[material].variants

export function paintBlock(ctx: CanvasRenderingContext2D, material: MaterialId, variant: number, damaged: boolean) {
  const painter = PAINTERS[material]
  painter.paint(ctx, variant % painter.variants, damaged)
}
