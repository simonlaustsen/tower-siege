import { BLOCK_SIZE as S } from '../game/constants'

/** Shared building blocks for every material's block painter. */

/** Gap left around each block so neighbours read as separate pieces. */
export const INSET = 0.6

export interface Chip {
  corner: number // 0 TL, 1 TR, 2 BR, 3 BL
  size: number
}

/** Damaged blocks lose a jagged corner; which one depends on the variant. */
export function chipFor(variant: number, damaged: boolean): Chip | null {
  return damaged ? { corner: variant % 4, size: 7 + (variant % 3) } : null
}

/** Block outline: a rounded square, or a polygon with one jagged chipped corner. */
export function shapePath(ctx: CanvasRenderingContext2D, chip: Chip | null) {
  const lo = INSET
  const hi = S - INSET
  ctx.beginPath()
  if (!chip) {
    ctx.roundRect(lo, lo, hi - lo, hi - lo, 2.4)
    return
  }
  const corners: [number, number][] = [[lo, lo], [hi, lo], [hi, hi], [lo, hi]]
  corners.forEach(([cx, cy], i) => {
    if (i !== chip.corner) {
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
      return
    }
    const [px, py] = corners[(i + 3) % 4]
    const [nx, ny] = corners[(i + 1) % 4]
    const dp = Math.hypot(px - cx, py - cy)
    const dn = Math.hypot(nx - cx, ny - cy)
    const ux = (px - cx) / dp
    const uy = (py - cy) / dp
    const vx = (nx - cx) / dn
    const vy = (ny - cy) / dn
    const c = chip.size
    const pts: [number, number][] = [
      [cx + ux * c, cy + uy * c],
      [cx + (ux + vx) * c * 0.38, cy + (uy + vy) * c * 0.38],
      [cx + (ux * 0.3 + vx) * c * 0.8, cy + (uy * 0.3 + vy) * c * 0.8],
      [cx + vx * c * 0.9, cy + vy * c * 0.9],
    ]
    if (i === 0) ctx.moveTo(pts[0][0], pts[0][1])
    else ctx.lineTo(pts[0][0], pts[0][1])
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1])
  })
  ctx.closePath()
}

/** A jagged crack; returns a point near its middle so branches can start there. */
export function crack(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  len: number,
  dark = 'rgba(24,16,10,0.85)',
): [number, number] {
  const pts: [number, number][] = [[x, y]]
  const steps = 5
  for (let i = 1; i <= steps; i++) {
    x += dx * (len / steps) + (rng() - 0.5) * 5
    y += dy * (len / steps) + (rng() - 0.5) * 5
    pts.push([x, y])
  }
  for (const [color, off, w] of [['rgba(255,255,255,0.22)', 0.8, 1], [dark, 0, 1.15]] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + off, py + off) : ctx.moveTo(px + off, py + off)))
    ctx.stroke()
  }
  return pts[Math.floor(steps / 2)]
}
