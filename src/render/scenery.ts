import { GROUND_MARGIN, WORLD_H, WORLD_W } from '../game/constants'
import { mulberry32 } from './rng'

export const BG_MARGIN = 20 // extra world units on every side so screen shake never shows edges
const GY = WORLD_H - GROUND_MARGIN

const ridge = (x: number, base: number, a1: number, f1: number, a2: number, f2: number, ph: number) =>
  base + a1 * Math.sin(x * f1 + ph) + a2 * Math.sin(x * f2 + ph * 1.7)

function paintHills(ctx: CanvasRenderingContext2D) {
  const layers = [
    { base: 120, a1: 30, f1: 1 / 170, a2: 12, f2: 1 / 55, ph: 0.4, top: '#9a6490', bottom: '#c0728d' },
    { base: 78, a1: 26, f1: 1 / 110, a2: 10, f2: 1 / 38, ph: 2, top: '#6a4d80', bottom: '#8a5a82' },
    { base: 42, a1: 18, f1: 1 / 75, a2: 8, f2: 1 / 29, ph: 4.1, top: '#383a66', bottom: '#4a3f68' },
  ]
  layers.forEach((l, li) => {
    const g = ctx.createLinearGradient(0, GY - l.base - 50, 0, GY)
    g.addColorStop(0, l.top)
    g.addColorStop(1, l.bottom)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(-BG_MARGIN, GY + 10)
    for (let x = -BG_MARGIN; x <= WORLD_W + BG_MARGIN; x += 8) {
      ctx.lineTo(x, GY - ridge(x, l.base, l.a1, l.f1, l.a2, l.f2, l.ph))
    }
    ctx.lineTo(WORLD_W + BG_MARGIN, GY + 10)
    ctx.fill()
    // warm rim light on the ridge line, strongest toward the sun on the left
    ctx.strokeStyle = `rgba(255,190,130,${0.35 - li * 0.08})`
    ctx.lineWidth = 1.4
    ctx.beginPath()
    for (let x = -BG_MARGIN; x <= WORLD_W + BG_MARGIN; x += 8) {
      const y = GY - ridge(x, l.base, l.a1, l.f1, l.a2, l.f2, l.ph) + 0.7
      x === -BG_MARGIN ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  })

  // pine silhouettes along the nearest ridge
  const rng = mulberry32(99)
  const near = layers[2]
  ctx.fillStyle = '#262849'
  for (let x = 170; x < WORLD_W + 10; x += 28 + rng() * 40) {
    const base = GY - ridge(x, near.base, near.a1, near.f1, near.a2, near.f2, near.ph) + 2
    const h = 20 + rng() * 20
    const w = 6 + rng() * 4
    for (let k = 0; k < 3; k++) {
      const ty = base - h * (0.18 + k * 0.28)
      const tw = w * (1.5 - k * 0.38)
      ctx.beginPath()
      ctx.moveTo(x - tw, ty + h * 0.34)
      ctx.lineTo(x, ty - h * 0.3)
      ctx.lineTo(x + tw, ty + h * 0.34)
      ctx.fill()
    }
    ctx.fillRect(x - 1, base - 3, 2, 4)
  }
}

function paintGround(ctx: CanvasRenderingContext2D) {
  const rng = mulberry32(7)
  const W = WORLD_W + BG_MARGIN * 2

  // dirt
  const dirt = ctx.createLinearGradient(0, GY, 0, WORLD_H + BG_MARGIN)
  dirt.addColorStop(0, '#80603d')
  dirt.addColorStop(1, '#3e2b1c')
  ctx.fillStyle = dirt
  ctx.fillRect(-BG_MARGIN, GY, W, WORLD_H - GY + BG_MARGIN)
  ctx.strokeStyle = 'rgba(30,18,8,0.18)'
  ctx.lineWidth = 1.5
  for (let l = 0; l < 3; l++) {
    ctx.beginPath()
    for (let x = -BG_MARGIN; x <= WORLD_W + BG_MARGIN; x += 12) {
      const y = GY + 20 + l * 12 + Math.sin(x / 40 + l * 2) * 2
      x === -BG_MARGIN ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(50,34,20,0.55)' : 'rgba(170,135,95,0.4)'
    ctx.beginPath()
    ctx.ellipse(rng() * W - BG_MARGIN, GY + 14 + rng() * (WORLD_H - GY), 0.8 + rng() * 2.6, 0.6 + rng() * 1.6, rng(), 0, Math.PI * 2)
    ctx.fill()
  }

  // distance markers
  ctx.fillStyle = 'rgba(255,240,210,0.5)'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (let x = 200; x < WORLD_W; x += 200) {
    ctx.fillRect(x - 1, GY + 12, 2, 8)
    ctx.fillText(String(x), x, GY + 38)
  }

  // grass strip
  const grass = ctx.createLinearGradient(0, GY - 2, 0, GY + 13)
  grass.addColorStop(0, '#78ab4a')
  grass.addColorStop(1, '#4a7a30')
  ctx.fillStyle = grass
  ctx.fillRect(-BG_MARGIN, GY, W, 13)
  const greens = ['#6a9e3f', '#7fb34e', '#5a8d36', '#8ec25a', '#4f8030']
  for (let x = -BG_MARGIN; x < WORLD_W + BG_MARGIN; x += 1.8) {
    const h = 3 + rng() * 6.5
    const lean = (rng() - 0.5) * 3
    ctx.fillStyle = greens[Math.floor(rng() * greens.length)]
    ctx.beginPath()
    ctx.moveTo(x - 1, GY + 2)
    ctx.lineTo(x + lean, GY - h)
    ctx.lineTo(x + 1.1, GY + 2)
    ctx.fill()
  }
  // little flowers and stones
  for (let i = 0; i < 26; i++) {
    const x = 160 + rng() * (WORLD_W - 140)
    ctx.fillStyle = ['#ffd166', '#f4a6c0', '#ffffff'][Math.floor(rng() * 3)]
    ctx.beginPath()
    ctx.arc(x, GY - 2 - rng() * 4, 1.1, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 9; i++) {
    const x = 170 + rng() * (WORLD_W - 170)
    const r = 2 + rng() * 3.5
    ctx.fillStyle = '#7d7c86'
    ctx.beginPath()
    ctx.ellipse(x, GY + 1, r, r * 0.65, 0, Math.PI, 0)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,225,180,0.4)'
    ctx.fillRect(x - r * 0.6, GY - r * 0.55, r * 0.7, 1)
  }
}

function paintBushes(ctx: CanvasRenderingContext2D) {
  const rng = mulberry32(31)
  // (none on the far left: that is where your tower and cannon stand)
  for (const x of [455, 520, 905, 965]) {
    for (let k = 0; k < 4; k++) {
      const bx = x + (k - 1.5) * 9 + rng() * 4
      const r = 8 + rng() * 6
      ctx.fillStyle = '#345b2b'
      ctx.beginPath()
      ctx.arc(bx, GY - r * 0.4, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(150,200,90,0.45)'
      ctx.beginPath()
      ctx.arc(bx - r * 0.3, GY - r * 0.75, r * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Static scenery: sky, stars, sun, hills, ground. Drawn in world units, margin included. */
export function paintBackground(ctx: CanvasRenderingContext2D) {
  const rng = mulberry32(2024)
  const W = WORLD_W + BG_MARGIN * 2

  const sky = ctx.createLinearGradient(0, -BG_MARGIN, 0, GY)
  sky.addColorStop(0, '#111a40')
  sky.addColorStop(0.38, '#46397a')
  sky.addColorStop(0.62, '#c4566f')
  sky.addColorStop(0.82, '#ef8a5f')
  sky.addColorStop(1, '#f7c88c')
  ctx.fillStyle = sky
  ctx.fillRect(-BG_MARGIN, -BG_MARGIN, W, GY + BG_MARGIN + 2)

  // stars
  for (let i = 0; i < 70; i++) {
    const y = rng() * GY * 0.42
    ctx.fillStyle = `rgba(255,250,235,${0.2 + rng() * 0.6 * (1 - y / (GY * 0.45))})`
    const s = 0.6 + rng() * 1.2
    ctx.fillRect(rng() * WORLD_W, y, s, s)
  }

  // low sun with a wide glow
  const sx = 310
  const sy = GY - 172
  const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 300)
  glow.addColorStop(0, 'rgba(255,214,150,0.75)')
  glow.addColorStop(0.35, 'rgba(255,160,110,0.28)')
  glow.addColorStop(1, 'rgba(255,140,100,0)')
  ctx.fillStyle = glow
  ctx.fillRect(sx - 300, sy - 300, 600, 600)
  const disc = ctx.createRadialGradient(sx, sy, 4, sx, sy, 44)
  disc.addColorStop(0, '#fffbe6')
  disc.addColorStop(1, '#ffd89a')
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(sx, sy, 44, 0, Math.PI * 2)
  ctx.fill()

  paintHills(ctx)
  paintBushes(ctx)
  paintGround(ctx)
}

/** A soft cloud lit orange underneath, purple on top. */
export function paintCloud(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const rng = mulberry32(seed)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#9a78b0')
  g.addColorStop(0.55, '#e29a92')
  g.addColorStop(1, '#ffbf92')
  ctx.fillStyle = g
  const n = 7
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const r = Math.min(h * 0.5, h * (0.26 + 0.2 * Math.sin(Math.PI * t) + rng() * 0.04))
    ctx.beginPath()
    ctx.arc(r + t * (w - 2 * r), h - r, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillRect(h * 0.3, h * 0.72, w - h * 0.6, h * 0.28)
}
