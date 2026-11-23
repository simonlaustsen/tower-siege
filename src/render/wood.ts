import { BLOCK_SIZE as S } from '../game/constants'
import { chipFor, crack, shapePath } from './blockShape'
import { mulberry32 } from './rng'

/** Plank colours: [light top, dark bottom]. Index 3 is weathered grey-brown, 4 is dark oak. */
const TONES: [string, string][] = [
  ['#d9ad70', '#bd8b54'],
  ['#cf9f62', '#ac7c49'],
  ['#c3925b', '#9f7042'],
  ['#bcab8f', '#928169'],
  ['#ab7a4b', '#875a34'],
  ['#d2a569', '#b6844e'],
]
export const WOOD_VARIANTS = TONES.length
/** Variants with a diagonal X brace, so the tower reads as timber framing. */
const BRACED = [false, false, true, false, true, false]

const POST = 4.4 // width of the vertical corner posts
const PLANK = 10 // height of one plank, three per block
const SEAM = 0.95

function nail(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#2b1d12'
  ctx.beginPath()
  ctx.arc(x, y, 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,235,200,0.55)'
  ctx.fillRect(x - 0.6, y - 0.6, 0.6, 0.6)
}

/** Paint one timber-frame block into a BLOCK_SIZE x BLOCK_SIZE area (world units). */
export function paintWoodBlock(ctx: CanvasRenderingContext2D, variant: number, damaged: boolean) {
  const rng = mulberry32(variant * 131 + (damaged ? 17 : 3) + 5)
  const [light, dark] = TONES[variant]
  const chip = chipFor(variant, damaged)

  ctx.save()
  shapePath(ctx, chip)
  ctx.clip()

  // dark gaps between the boards show through where seams are left
  ctx.fillStyle = '#42260f'
  ctx.fillRect(0, 0, S, S)

  // three horizontal planks with grain, a butt joint and sometimes a knot
  for (let i = 0; i < 3; i++) {
    const y0 = i * PLANK
    const h = PLANK - SEAM
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h)
    g.addColorStop(0, light)
    g.addColorStop(1, dark)
    ctx.fillStyle = g
    ctx.fillRect(0, y0, S, h)

    ctx.strokeStyle = 'rgba(70,40,15,0.24)'
    ctx.lineWidth = 0.6
    for (let k = 0; k < 3; k++) {
      const y = y0 + 1.6 + rng() * (h - 3)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.quadraticCurveTo(S / 2, y + (rng() - 0.5) * 2.2, S, y + (rng() - 0.5) * 1.6)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,238,195,0.3)'
    ctx.fillRect(0, y0, S, 1.1)

    const joint = 7 + rng() * 16
    ctx.fillStyle = 'rgba(40,22,10,0.55)'
    ctx.fillRect(joint, y0, 0.9, h)
    ctx.fillStyle = 'rgba(255,225,170,0.22)'
    ctx.fillRect(joint + 0.9, y0, 0.6, h)

    if (rng() < 0.45) {
      const kx = 6 + rng() * (S - 12)
      const ky = y0 + h / 2
      ctx.fillStyle = 'rgba(80,45,18,0.6)'
      ctx.beginPath()
      ctx.ellipse(kx, ky, 2.3, 1.7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(45,25,10,0.55)'
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.ellipse(kx, ky, 1.2, 0.8, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // diagonal bracing
  if (BRACED[variant]) {
    for (const [x0, x1] of [[POST, S - POST], [S - POST, POST]]) {
      for (const [color, w, off] of [['rgba(35,18,8,0.55)', 4.6, 0], ['#8e6139', 3.2, 0], ['rgba(255,220,160,0.4)', 0.9, -0.7]] as const) {
        ctx.strokeStyle = color
        ctx.lineWidth = w
        ctx.beginPath()
        ctx.moveTo(x0 + off, 1.5 + off)
        ctx.lineTo(x1 + off, S - 1.5 + off)
        ctx.stroke()
      }
    }
  }

  // corner posts with nails
  const left = ctx.createLinearGradient(0, 0, POST, 0)
  left.addColorStop(0, '#aa7340')
  left.addColorStop(1, '#7d5129')
  ctx.fillStyle = left
  ctx.fillRect(0, 0, POST, S)
  const right = ctx.createLinearGradient(S - POST, 0, S, 0)
  right.addColorStop(0, '#7d5129')
  right.addColorStop(1, '#5e3a1d')
  ctx.fillStyle = right
  ctx.fillRect(S - POST, 0, POST, S)
  ctx.fillStyle = 'rgba(30,16,6,0.4)'
  ctx.fillRect(POST, 0, 0.8, S)
  ctx.fillRect(S - POST - 0.8, 0, 0.8, S)
  for (const y of [5, S - 5]) {
    nail(ctx, POST / 2, y)
    nail(ctx, S - POST / 2, y)
  }

  // sun-side bevel (light from the upper left)
  ctx.fillStyle = 'rgba(255,232,185,0.5)'
  ctx.fillRect(0, 0, S, 1.8)
  ctx.fillStyle = 'rgba(255,225,170,0.3)'
  ctx.fillRect(0, 0, 1.4, S)
  ctx.fillStyle = 'rgba(30,16,6,0.35)'
  ctx.fillRect(0, S - 2.2, S, 2.2)
  ctx.fillStyle = 'rgba(30,16,6,0.28)'
  ctx.fillRect(S - 1.6, 0, 1.6, S)

  if (damaged) {
    ctx.fillStyle = 'rgba(60,30,10,0.2)'
    ctx.fillRect(0, 0, S, S)

    // a snapped plank end: jagged hole with pale splinters along the break
    const row = 1 + Math.floor(rng() * 2) // middle or top plank
    const y0 = row * PLANK
    const cut = 12 + rng() * 6
    const edge: [number, number][] = [
      [cut, y0],
      [cut + 3, y0 + 2.6],
      [cut + 0.8, y0 + 4.6],
      [cut + 4.2, y0 + 6.6],
      [cut + 1.6, y0 + PLANK - SEAM],
    ]
    ctx.fillStyle = '#2a170a'
    ctx.beginPath()
    ctx.moveTo(edge[0][0], edge[0][1])
    for (const [x, y] of edge.slice(1)) ctx.lineTo(x, y)
    ctx.lineTo(S, y0 + PLANK - SEAM)
    ctx.lineTo(S, y0)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(240,205,150,0.8)'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()

    // splits running along the grain
    const mid = crack(ctx, rng, 3 + rng() * 8, 0, 0.35, 1, 22, 'rgba(30,16,6,0.9)')
    crack(ctx, rng, mid[0], mid[1], 0.95, 0.15, 12, 'rgba(30,16,6,0.9)')
  }
  ctx.restore()

  shapePath(ctx, chip)
  ctx.strokeStyle = 'rgba(40,22,8,0.7)'
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  ctx.stroke()
}
