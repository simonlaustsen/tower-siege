import { BLOCK_SIZE } from '../game/constants'
import type { Assets, PuffKind } from './assets'

export type ParticleKind = PuffKind | 'spark' | 'chunk' | 'block'

export interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  /** Radius for puffs, scale for chunks. */
  size: number
  /** Puff radius growth per second. */
  grow: number
  rot: number
  vr: number
  drag: number
  /** Downward acceleration; negative makes smoke rise. */
  grav: number
  alpha: number
  color: string
  pts?: number[]
  sprite?: HTMLCanvasElement
  bounce: boolean
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]

const STONE = ['#8f959e', '#7d838c', '#a0a6ae', '#6f757d', '#9a948c']
const WOOD = ['#c99458', '#b98650', '#a9774a', '#8c5f38', '#d9ad70']
const EARTH =['#6b4f32', '#8a6a48', '#5b8c3a', '#7a5d3c']

function make(kind: ParticleKind, o: Partial<Particle> & { x: number; y: number; life: number }): Particle {
  return {
    kind, vx: 0, vy: 0, maxLife: o.life, size: 4, grow: 0, rot: 0, vr: 0, drag: 0, grav: 0,
    alpha: 1, color: '#fff', bounce: false, ...o,
  }
}

/** A long thin shard, like a splinter of timber. */
function splinter(): number[] {
  const w = rand(0.16, 0.3)
  return [-1, -w, rand(0.7, 1), -w * rand(0.3, 1), 1, w, -rand(0.7, 1), w * rand(0.3, 1)]
}

function polygon(radius: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + rand(-0.45, 0.45)
    const r = radius * rand(0.55, 1)
    out.push(Math.cos(a) * r, Math.sin(a) * r)
  }
  return out
}

export function muzzleBlast(out: Particle[], x: number, y: number, angle: number) {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  out.push(make('glow', { x, y, life: 0.14, size: 14, grow: 150, alpha: 1 }))
  for (let i = 0; i < 12; i++) {
    const s = rand(220, 520)
    const a = angle + rand(-0.28, 0.28)
    out.push(make('spark', { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.15, 0.35), drag: 3, grav: 500 }))
  }
  for (let i = 0; i < 12; i++) {
    const s = rand(30, 200)
    const a = angle + rand(-0.5, 0.5)
    out.push(
      make(i % 3 === 0 ? 'dust' : 'smoke', {
        x: x + dx * rand(0, 10), y: y + dy * rand(0, 10),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.9, 1.7), size: rand(6, 11), grow: rand(18, 34), drag: 1.8, grav: -18, alpha: 0.7,
      }),
    )
  }
}

export function flightSmoke(out: Particle[], x: number, y: number) {
  out.push(
    make('smoke', {
      x, y, vx: rand(-8, 8), vy: rand(-4, 14), life: rand(0.45, 0.8),
      size: rand(2.5, 4), grow: rand(8, 14), grav: -10, alpha: 0.5,
    }),
  )
}

export function dustPlume(out: Particle[], x: number, y: number, n: number, size: number, kind: PuffKind = 'dust') {
  for (let i = 0; i < n; i++) {
    out.push(
      make(kind, {
        x: x + rand(-8, 8), y: y + rand(-6, 6), vx: rand(-70, 70), vy: rand(10, 90),
        life: rand(0.7, 1.5), size: size * rand(0.7, 1.2), grow: rand(14, 30), drag: 1.6, grav: -14, alpha: 0.75,
      }),
    )
  }
}

export function sparks(out: Particle[], x: number, y: number, n: number) {
  out.push(make('glow', { x, y, life: 0.2, size: 10, grow: 140 }))
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2)
    const s = rand(120, 380)
    out.push(make('spark', { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 60, life: rand(0.2, 0.5), drag: 2.5, grav: 700 }))
  }
}

export type DebrisKind = 'stone' | 'wood' | 'earth'

const PALETTES: Record<DebrisKind, string[]> = { stone: STONE, wood: WOOD, earth: EARTH }

export function chunks(out: Particle[], x: number, y: number, n: number, colors: DebrisKind, power = 1) {
  const palette = PALETTES[colors]
  for (let i = 0; i < n; i++) {
    out.push(
      make('chunk', {
        x: x + rand(-10, 10), y: y + rand(-10, 10),
        vx: rand(-130, 130) * power, vy: rand(60, 320) * power,
        life: rand(1.1, 2.2), size: rand(2.2, 5.2), rot: rand(0, Math.PI), vr: rand(-9, 9),
        grav: 800, bounce: true, color: pick(palette), pts: colors === 'wood' ? splinter() : polygon(1),
      }),
    )
  }
}

/** A whole block tumbling down, as when the tower loses support. */
export function fallingBlock(out: Particle[], cx: number, cy: number, sprite: HTMLCanvasElement) {
  out.push(
    make('block', {
      x: cx, y: cy, vx: rand(-80, 80), vy: rand(20, 140),
      life: rand(3, 4.5), size: 1, rot: 0, vr: rand(-3.5, 3.5), grav: 760, bounce: true, sprite,
    }),
  )
}

export function updateParticles(list: Particle[], dt: number): Particle[] {
  let n = 0
  for (const p of list) {
    p.life -= dt
    if (p.life <= 0) continue
    p.vx *= Math.exp(-p.drag * dt)
    p.vy *= Math.exp(-p.drag * dt)
    p.vy -= p.grav * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.rot += p.vr * dt
    if (p.bounce) {
      const floor = p.kind === 'block' ? BLOCK_SIZE / 2 : 1.5
      if (p.y < floor) {
        p.y = floor
        p.vy = p.vy < -40 ? -p.vy * 0.28 : 0
        p.vx *= 0.55
        p.vr *= 0.55
      }
    }
    list[n++] = p
  }
  list.length = n
  return list
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  list: Particle[],
  gy: number,
  maxX: number,
) {
  const age = (p: Particle) => p.maxLife - p.life
  const puff = (p: Particle) => {
    const k = p.life / p.maxLife
    const r = p.size + p.grow * age(p)
    ctx.globalAlpha = Math.max(0, p.alpha * k * Math.min(1, (1 - k) * 10))
    ctx.drawImage(assets.puffs[p.kind as PuffKind], p.x - r, gy - p.y - r, r * 2, r * 2)
  }

  // soft puffs first, so debris tumbles in front of the smoke
  for (const p of list) {
    if (p.x > maxX) continue
    if (p.kind === 'dust' || p.kind === 'smoke' || p.kind === 'dirt') puff(p)
  }
  for (const p of list) {
    if (p.x > maxX) continue
    ctx.globalAlpha = Math.min(1, p.life / 0.4)
    if (p.kind === 'chunk' && p.pts) {
      ctx.save()
      ctx.translate(p.x, gy - p.y)
      ctx.rotate(p.rot)
      ctx.scale(p.size, p.size)
      ctx.beginPath()
      for (let i = 0; i < 8; i += 2) i ? ctx.lineTo(p.pts[i], p.pts[i + 1]) : ctx.moveTo(p.pts[i], p.pts[i + 1])
      ctx.closePath()
      ctx.fillStyle = p.color
      ctx.fill()
      ctx.lineWidth = 0.25
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.stroke()
      ctx.restore()
    } else if (p.kind === 'block' && p.sprite) {
      ctx.save()
      ctx.translate(p.x, gy - p.y)
      ctx.rotate(-p.rot)
      ctx.drawImage(p.sprite, -BLOCK_SIZE / 2, -BLOCK_SIZE / 2, BLOCK_SIZE, BLOCK_SIZE)
      ctx.restore()
    }
  }

  // additive light: glows and sparks
  ctx.globalCompositeOperation = 'lighter'
  for (const p of list) {
    if (p.x > maxX) continue
    if (p.kind === 'glow') puff(p)
    else if (p.kind === 'spark') {
      ctx.globalAlpha = Math.min(1, p.life / 0.15)
      ctx.strokeStyle = '#ffc46b'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(p.x, gy - p.y)
      ctx.lineTo(p.x - p.vx * 0.035, gy - p.y + p.vy * 0.035)
      ctx.stroke()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}
