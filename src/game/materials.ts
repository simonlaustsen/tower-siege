/**
 * What a tower is built from. Each material is a bundle of gameplay numbers here
 * plus its own artwork in `src/render` (keyed by `id`). Wood is the first version;
 * stone and others can be added without touching the shot, feedback or network code.
 */
export type MaterialId = 'wood'

export interface Material {
  id: MaterialId
  name: string
  /** Hits a block can take before it breaks. */
  blockHp: number
}

export const WOOD: Material = { id: 'wood', name: 'Wood', blockHp: 3 }

export const MATERIALS: Record<MaterialId, Material> = { wood: WOOD }
