import { BLOCK_SIZE as S } from '../game/constants'
import { chipFor, crack, shapePath } from './blockShape'
import type { BlockLook } from './blocks'
import { mulberry32 } from './rng'

/**
 * A timber-frame bay: thick posts and rails around a recessed infill panel, sometimes braced. Stacked
 * and side by side they read as a wooden frame rather than a wall of crates. A "rotten" bay (a soft
 * spot) has weathered grey beams, moss and splits, so its owner can see where the tower is weak.
 */

/** Beam colours: [light, dark]. */
const BEAMS: [string, string][] = [
  ['#c9965b', '#a06f3c'],
  ['#bf8b52', '#966734'],
  ['#d0a064', '#a97a44'],
  ['#b88249', '#8f6030'],
  ['#c4925a', '#9b6b3b'],
  ['#cc9c60', '#a47340'],
]
export const WOOD_VARIANTS = BEAMS.length
const ROTTEN_BEAM: [string, string] = ['#a39a88', '#776f60']

/** What fills the panel between the beams: dark boards, or pale daub. */
const INFILL: ('boards' | 'daub')[] = ['boards', 'daub', 'boards', 'boards', 'daub', 'boards']
/** Diagonal bracing: none, one way, the other way, or crossed. */
const BRACE: ('none' | 'up' | 'down' | 'cross')[] = ['none', 'cross', 'up', 'none', 'down', 'none']

const POST = 5.6 // width of each side post
const RAIL = 6.2 // height of the top rail
const SILL = 3.2 // height of the lower rail (the next bay's top rail sits right under it)

function peg(ctx: CanvasRenderingContext2D, x: number, y: number, r = 1.25) {
  ctx.fillStyle = '#2d1c0f'
  ctx.beginPath()
  ctx.arc(x, y, r + 0.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#d7ad74'
  ctx.beginPath()
  ctx.arc(x - 0.2, y - 0.2, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,240,210,0.7)'
  ctx.fillRect(x - 0.8, y - 0.9, 0.7, 0.5)
}

/** One beam, with grain, a lit upper-left edge and a shaded lower-right edge. */
function beam(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: [string, string],
  vertical: boolean,
) {
  const g = vertical ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, tone[0])
  g.addColorStop(1, tone[1])
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)

  ctx.strokeStyle = 'rgba(60,34,12,0.3)'
  ctx.lineWidth = 0.55
  const lines = vertical ? 2 : 3
  for (let i = 0; i < lines; i++) {
    ctx.beginPath()
    if (vertical) {
      const gx = x + 1.2 + rng() * (w - 2.4)
      ctx.moveTo(gx, y)
      ctx.quadraticCurveTo(gx + (rng() - 0.5) * 1.6, y + h / 2, gx + (rng() - 0.5), y + h)
    } else {
      const gy = y + 1 + rng() * (h - 2)
      ctx.moveTo(x, gy)
      ctx.quadraticCurveTo(x + w / 2, gy + (rng() - 0.5) * 1.6, x + w, gy + (rng() - 0.5))
    }
    ctx.stroke()
  }
  if (rng() < 0.4) {
    // a knot
    const kx = vertical ? x + w / 2 : x + 5 + rng() * (w - 10)
    const ky = vertical ? y + 5 + rng() * (h - 10) : y + h / 2
    ctx.fillStyle = 'rgba(70,40,15,0.55)'
    ctx.beginPath()
    ctx.ellipse(kx, ky, vertical ? 1.5 : 2, vertical ? 2 : 1.4, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // lit edge on the sun side, shade on the other
  ctx.fillStyle = 'rgba(255,236,190,0.5)'
  vertical ? ctx.fillRect(x, y, 0.9, h) : ctx.fillRect(x, y, w, 0.9)
  ctx.fillStyle = 'rgba(30,16,6,0.4)'
  vertical ? ctx.fillRect(x + w - 0.9, y, 0.9, h) : ctx.fillRect(x, y + h - 0.9, w, 0.9)
}

function infill(ctx: CanvasRenderingContext2D, rng: () => number, kind: 'boards' | 'daub', rotten: boolean) {
  const x0 = POST
  const x1 = S - POST
  const y0 = RAIL
  const y1 = S - SILL
  if (kind === 'daub' && !rotten) {
    ctx.fillStyle = '#d3bf98'
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    ctx.strokeStyle = 'rgba(120,95,60,0.35)'
    ctx.lineWidth = 0.5
    for (let i = 0; i < 6; i++) {
      const x = x0 + rng() * (x1 - x0)
      const y = y0 + rng() * (y1 - y0)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 3 + rng() * 3, y + (rng() - 0.5) * 2)
      ctx.stroke()
    }
  } else {
    ctx.fillStyle = rotten ? '#4a3d2e' : '#5d3d22'
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    ctx.fillStyle = rotten ? 'rgba(160,150,130,0.18)' : 'rgba(210,160,100,0.22)'
    for (let x = x0 + 1; x < x1; x += 4.6) ctx.fillRect(x, y0, 2.2, y1 - y0)
    ctx.fillStyle = 'rgba(15,8,2,0.5)'
    for (let x = x0 + 3.2; x < x1; x += 4.6) ctx.fillRect(x, y0, 0.7, y1 - y0)
  }
  // the panel sits behind the beams: shade under the top rail and beside the left post
  const shade = ctx.createLinearGradient(0, y0, 0, y0 + 5)
  shade.addColorStop(0, 'rgba(20,10,4,0.5)')
  shade.addColorStop(1, 'rgba(20,10,4,0)')
  ctx.fillStyle = shade
  ctx.fillRect(x0, y0, x1 - x0, 5)
}

/** Paint one timber-frame bay into a BLOCK_SIZE x BLOCK_SIZE area (world units). */
export function paintWoodBlock(ctx: CanvasRenderingContext2D, variant: number, look: BlockLook) {
  const { damage, rotten } = look
  const rng = mulberry32(variant * 131 + damage * 17 + (rotten ? 29 : 3) + 5)
  const tone = rotten ? ROTTEN_BEAM : BEAMS[variant]
  const chip = chipFor(variant, damage === 2)

  ctx.save()
  shapePath(ctx, chip)
  ctx.clip()

  // dark behind everything, so gaps between pieces read as depth
  ctx.fillStyle = '#2a170a'
  ctx.fillRect(0, 0, S, S)

  infill(ctx, rng, INFILL[variant], rotten)

  // braces run corner to corner of the panel, under the posts and rails
  const brace = rotten && BRACE[variant] === 'none' ? 'down' : BRACE[variant]
  if (brace !== 'none') {
    const diagonals: [number, number, number, number][] = []
    if (brace === 'cross' || brace === 'up') diagonals.push([POST, S - SILL, S - POST, RAIL])
    if (brace === 'cross' || brace === 'down') diagonals.push([POST, RAIL, S - POST, S - SILL])
    for (const [ax, ay, bx, by] of diagonals) {
      for (const [color, w, off] of [['rgba(30,16,6,0.6)', 5.4, 0.6], [tone[1], 4.2, 0], [tone[0], 1.4, -0.8]] as const) {
        ctx.strokeStyle = color
        ctx.lineWidth = w
        ctx.lineCap = 'butt'
        ctx.beginPath()
        ctx.moveTo(ax + off, ay + off)
        ctx.lineTo(bx + off, by + off)
        ctx.stroke()
      }
    }
  }

  // the frame: top rail, lower rail, two posts
  beam(ctx, rng, 0, 0, S, RAIL, tone, false)
  beam(ctx, rng, 0, S - SILL, S, SILL, tone, false)
  beam(ctx, rng, 0, 0, POST, S, tone, true)
  beam(ctx, rng, S - POST, 0, POST, S, tone, true)

  // pegs where the beams meet
  for (const [px, py] of [[POST / 2, RAIL / 2 + 0.4], [S - POST / 2, RAIL / 2 + 0.4], [POST / 2, S - SILL / 2 - 4], [S - POST / 2, S - SILL / 2 - 4]]) {
    peg(ctx, px, py)
  }

  if (rotten) {
    // moss along the top, a split down one post, and a sagging dark knot-hole
    ctx.fillStyle = 'rgba(96,132,62,0.85)'
    for (let i = 0; i < 4; i++) {
      const mx = 3 + rng() * (S - 6)
      ctx.beginPath()
      ctx.ellipse(mx, 0.8 + rng() * 2, 2 + rng() * 2.4, 1.2 + rng(), 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(130,168,84,0.7)'
    ctx.fillRect(4 + rng() * 18, 0.4, 3, 1)
    crack(ctx, rng, POST / 2 + (rng() < 0.5 ? 0 : S - POST), 4, 0.05, 1, 22, 'rgba(25,14,6,0.9)')
    crack(ctx, rng, 3 + rng() * (S - 6), 1, 0.2, 0.95, 5, 'rgba(25,14,6,0.8)')
    ctx.fillStyle = 'rgba(25,14,6,0.7)'
    ctx.beginPath()
    ctx.ellipse(S / 2 + (rng() - 0.5) * 8, S - SILL - 5, 2.6, 1.8, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  // shading that holds the bay together: lit upper left, shaded lower right
  ctx.fillStyle = 'rgba(255,232,185,0.35)'
  ctx.fillRect(0, 0, S, 1.2)
  ctx.fillRect(0, 0, 1.1, S)
  ctx.fillStyle = 'rgba(30,16,6,0.32)'
  ctx.fillRect(0, S - 1.4, S, 1.4)
  ctx.fillRect(S - 1.2, 0, 1.2, S)

  if (damage >= 1) {
    ctx.fillStyle = damage === 2 ? 'rgba(60,30,10,0.26)' : 'rgba(60,30,10,0.14)'
    ctx.fillRect(0, 0, S, S)
    // splits running along the beams
    const a = crack(ctx, rng, 2 + rng() * (S - 4), 0, 0.12, 1, 14 + rng() * 6, 'rgba(25,14,6,0.9)')
    if (damage === 2) crack(ctx, rng, a[0], a[1], 0.9, 0.2, 12, 'rgba(25,14,6,0.9)')
  }

  if (damage === 2) {
    // a snapped rail: a jagged gap with pale splinters along the break
    const cut = 9 + rng() * 8
    const edge: [number, number][] = [
      [cut, 0],
      [cut + 2.6, RAIL * 0.35],
      [cut + 0.6, RAIL * 0.7],
      [cut + 3.2, RAIL + 1],
      [cut + 1.2, RAIL + 4.5],
    ]
    ctx.fillStyle = '#1f1006'
    ctx.beginPath()
    ctx.moveTo(edge[0][0], edge[0][1])
    for (const [x, y] of edge.slice(1)) ctx.lineTo(x, y)
    ctx.lineTo(cut + 10, RAIL + 4.5)
    ctx.lineTo(cut + 10, 0)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(245,215,160,0.85)'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()
    // a hanging splinter of the rail
    ctx.fillStyle = tone[1]
    ctx.beginPath()
    ctx.moveTo(cut + 10, RAIL * 0.4)
    ctx.lineTo(cut + 15, RAIL + 7)
    ctx.lineTo(cut + 12, RAIL + 7.5)
    ctx.lineTo(cut + 8, RAIL * 0.9)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()

  shapePath(ctx, chip)
  ctx.strokeStyle = 'rgba(35,18,6,0.75)'
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  ctx.stroke()
}
