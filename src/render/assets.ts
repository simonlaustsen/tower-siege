import { BLOCK_SIZE, WORLD_H, WORLD_W } from '../game/constants'
import type { MaterialId } from '../game/materials'
import { paintBlock, type BlockLook } from './blocks'
import { BG_MARGIN, paintBackground, paintCloud } from './scenery'

export type PuffKind = 'dust' | 'smoke' | 'glow' | 'dirt' | 'fog'

export interface Cloud {
  sprite: HTMLCanvasElement
  w: number
  h: number
  y: number
  x0: number
  speed: number
  alpha: number
}

/** Pre-rendered sprites at one particular device-pixel scale. */
export interface Assets {
  scale: number
  bg: HTMLCanvasElement
  vignette: HTMLCanvasElement
  clouds: Cloud[]
  puffs: Record<PuffKind, HTMLCanvasElement>
  blockSprite: (material: MaterialId, variant: number, look: BlockLook) => HTMLCanvasElement
}

function sprite(wUnits: number, hUnits: number, scale: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(wUnits * scale))
  c.height = Math.max(1, Math.ceil(hUnits * scale))
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  draw(ctx)
  return c
}

const PUFF_COLORS: Record<PuffKind, [number, number, number]> = {
  dust: [232, 220, 196],
  smoke: [78, 78, 88],
  glow: [255, 216, 140],
  dirt: [140, 106, 72],
  fog: [226, 230, 244],
}

function puff([r, g, b]: [number, number, number]) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.55)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)
  return c
}

export function createAssets(scale: number): Assets {
  const bg = sprite(WORLD_W + BG_MARGIN * 2, WORLD_H + BG_MARGIN * 2, scale, (ctx) => {
    ctx.translate(BG_MARGIN, BG_MARGIN)
    paintBackground(ctx)
  })

  const vignette = sprite(WORLD_W, WORLD_H, scale, (ctx) => {
    const g = ctx.createRadialGradient(WORLD_W / 2, WORLD_H * 0.55, WORLD_H * 0.35, WORLD_W / 2, WORLD_H * 0.55, WORLD_W * 0.65)
    g.addColorStop(0, 'rgba(10,8,30,0)')
    g.addColorStop(1, 'rgba(10,8,30,0.5)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, WORLD_W, WORLD_H)
  })

  const cloudDefs = [
    { w: 210, h: 56, y: 70, x0: 60, speed: 5, alpha: 0.85, seed: 1 },
    { w: 150, h: 40, y: 150, x0: 520, speed: 3.5, alpha: 0.7, seed: 2 },
    { w: 260, h: 64, y: 40, x0: 780, speed: 7, alpha: 0.9, seed: 3 },
    { w: 120, h: 32, y: 215, x0: 330, speed: 2.5, alpha: 0.55, seed: 4 },
    { w: 170, h: 44, y: 120, x0: 920, speed: 4.5, alpha: 0.75, seed: 5 },
  ]
  const clouds: Cloud[] = cloudDefs.map((d) => ({
    ...d,
    sprite: sprite(d.w, d.h, scale, (ctx) => paintCloud(ctx, d.w, d.h, d.seed)),
  }))

  const puffs = Object.fromEntries(
    (Object.keys(PUFF_COLORS) as PuffKind[]).map((k) => [k, puff(PUFF_COLORS[k])]),
  ) as Record<PuffKind, HTMLCanvasElement>

  const blocks = new Map<string, HTMLCanvasElement>()
  const blockSprite = (material: MaterialId, variant: number, look: BlockLook) => {
    const key = `${material}:${variant}:${look.damage}:${look.rotten}`
    let s = blocks.get(key)
    if (!s) {
      s = sprite(BLOCK_SIZE, BLOCK_SIZE, scale, (ctx) => paintBlock(ctx, material, variant, look))
      blocks.set(key, s)
    }
    return s
  }

  return { scale, bg, vignette, clouds, puffs, blockSprite }
}
