import { BLOCK_SIZE as S } from '../game/constants'
import { chipFor, crack, shapePath } from './blockShape'
import { mulberry32 } from './rng'

/**
 * Stone blocks. Not wired up yet: wood is the first material. Register this painter in
 * `blocks.ts` when a 'stone' material is added to `game/materials.ts`.
 */

/** Stone looks: [light, dark] gradient colours. The last two are mossy. */
const TONES: [string, string][] = [
  ['#a4aab3', '#838993'],
  ['#aaa299', '#8a8279'],
  ['#98a3ae', '#78828d'],
  ['#aaaaa6', '#888884'],
  ['#9ca89f', '#7b877f'],
  ['#a6a198', '#867f77'],
]
export const STONE_VARIANTS = TONES.length
const MOSSY = [false, false, false, false, true, true]

export function paintStoneBlock(ctx: CanvasRenderingContext2D, variant: number, damaged: boolean) {
  const rng = mulberry32(variant * 977 + (damaged ? 31 : 62) + 7)
  const [light, dark] = TONES[variant]
  const chip = chipFor(variant, damaged)

  ctx.save()
  shapePath(ctx, chip)
  ctx.clip()

  const g = ctx.createLinearGradient(0, 0, S, S)
  g.addColorStop(0, light)
  g.addColorStop(1, dark)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  if (damaged) {
    ctx.fillStyle = 'rgba(50,30,15,0.2)'
    ctx.fillRect(0, 0, S, S)
  }

  // speckled grain
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rng() < 0.5 ? `rgba(20,20,40,${0.06 + rng() * 0.12})` : `rgba(255,250,235,${0.05 + rng() * 0.12})`
    const s = 0.5 + rng() * 1.4
    ctx.fillRect(rng() * S, rng() * S, s, s)
  }
  // faint strata
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 0.8
  for (let i = 0; i < 2; i++) {
    const y = 7 + rng() * 17
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(S, y + (rng() - 0.5) * 4)
    ctx.stroke()
  }

  // sun-side bevel (light from the upper left)
  ctx.fillStyle = 'rgba(255,232,190,0.55)'
  ctx.fillRect(0, 0, S, 2.2)
  ctx.fillStyle = 'rgba(255,225,180,0.32)'
  ctx.fillRect(0, 0, 1.7, S)
  ctx.fillStyle = 'rgba(25,18,45,0.3)'
  ctx.fillRect(0, S - 2.6, S, 2.6)
  ctx.fillStyle = 'rgba(25,18,45,0.22)'
  ctx.fillRect(S - 1.9, 0, 1.9, S)

  if (MOSSY[variant]) {
    ctx.fillStyle = '#5b8b33'
    for (let x = 0.5; x < S - 2; ) {
      const w = 3 + rng() * 5
      ctx.beginPath()
      ctx.ellipse(x + w / 2, 1.2, w / 2, 2 + rng() * 3.5, 0, 0, Math.PI)
      ctx.fill()
      x += w * 0.8
    }
    ctx.fillStyle = '#86b84f'
    ctx.fillRect(0, 0, S, 1.3)
    ctx.fillStyle = '#4d7a2a'
    for (let i = 0; i < 2; i++) ctx.fillRect(3 + rng() * (S - 8), 2, 1.6, 5 + rng() * 6)
  }

  if (damaged) {
    const mid = crack(ctx, rng, 6 + rng() * 14, 0, 0.25, 1, 22)
    crack(ctx, rng, mid[0], mid[1], 0.9, 0.3, 11)
    crack(ctx, rng, S, 8 + rng() * 10, -1, 0.5, 14)
    ctx.fillStyle = 'rgba(30,22,16,0.7)'
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.arc(4 + rng() * (S - 8), 4 + rng() * (S - 8), 0.7 + rng() * 1.1, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  shapePath(ctx, chip)
  ctx.strokeStyle = 'rgba(28,22,44,0.6)'
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  ctx.stroke()
}
