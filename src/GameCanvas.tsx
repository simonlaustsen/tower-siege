import { useEffect, useRef } from 'react'
import {
  BLOCK_SIZE,
  FOG_SCREEN_X,
  GROUND_MARGIN,
  PROJECTILE_RADIUS,
  TOWER_COLS,
  TOWER_WIDTH,
  WORLD_H,
  WORLD_W,
} from './game/constants'
import type { ShotResult, Vec } from './game/physics'
import { forEachBlock, materialOf, type Cell, type Tower } from './game/tower'
import { createAssets, type Assets } from './render/assets'
import { blockVariants } from './render/blocks'
import { drawCannon } from './render/cannon'
import { cellRect, displayCol, enemyPlacement, MY_PLACEMENT, type MapX, type Placement } from './render/placement'
import {
  chunks,
  drawParticles,
  dustPlume,
  fallingBlock,
  flightSmoke,
  muzzleBlast,
  rand,
  sparks,
  updateParticles,
  type Particle,
} from './render/particles'
import { BG_MARGIN } from './render/scenery'
import { hash3 } from './render/rng'

/** Full knowledge of what a shot does to a tower that is visible on screen. */
export interface ShotDetail {
  result: ShotResult
  towerBefore: Tower
  /** Where that tower is drawn, and which way round. */
  placement: Placement
  /** Converts the physics' x to the screen's x for this shot. */
  mapX: MapX
}

/** A shot as the canvas animates it: only what this screen is allowed to know. */
export interface ActiveShot {
  id: number
  /** 'out': you fired it, from your cannon. 'in': the enemy fired it, out of the fog at your tower. */
  dir: 'out' | 'in'
  /** Trajectory in screen coordinates. A shot of yours that reaches the fog stops at the fog line. */
  path: Vec[]
  /** The ball lands on open ground in plain view (no detail available). */
  groundLanding: boolean
  /** Impact details, only for towers that are visible: your own, or the enemy's while peeking. */
  detail: ShotDetail | null
}

interface Props {
  /** Your own tower. Always shown, next to your cannon. */
  myTower: Tower
  /** The enemy tower, shown only while peeking (dev). Otherwise null: it is hidden in the fog. */
  enemyTower: Tower | null
  /** Barrel angle of your cannon. */
  angle: number
  shot: ActiveShot | null
  onShotEnd: (id: number) => void
}

const PLAYBACK_SPEED = 1.7 // x real-time; sim path is sampled at 120 Hz
const PATH_HZ = 120
const GY = WORLD_H - GROUND_MARGIN
const MAX_DECALS = 6

/** Canvas renderer. Owns animation state (projectile, particles); game state comes via props. */
export function GameCanvas({ myTower, enemyTower, angle, shot, onShotEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Latest props, readable from the long-lived animation loop.
  const live = useRef({ myTower, enemyTower, angle, onShotEnd })
  live.current = { myTower, enemyTower, angle, onShotEnd }

  const anim = useRef({
    shot: null as { active: ActiveShot; startedAt: number } | null,
    // Your shots and the enemy's are remembered separately so they can be drawn in different colours.
    trails: { out: [] as Vec[][], in: [] as Vec[][] },
    decals: { out: [] as number[], in: [] as number[] }, // x of scorch marks on the ground
    particles: [] as Particle[],
    shake: 0,
    recoil: 0,
  })

  // Begin a new shot animation when a new shot arrives.
  useEffect(() => {
    if (!shot) return
    const a = anim.current
    a.shot = { active: shot, startedAt: performance.now() }
    if (shot.dir === 'out') {
      // Your cannon fires. (The enemy's cannon is out in the fog, so its shots just emerge.)
      a.recoil = 14
      const [muzzle, next] = shot.path
      muzzleBlast(a.particles, muzzle.x, muzzle.y, Math.atan2(next.y - muzzle.y, next.x - muzzle.x))
    }
  }, [shot])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let assets: Assets | null = null

    /** Beyond this screen x nothing may be seen: the fog, unless the enemy tower is being peeked at. */
    const visibleLimit = () => (live.current.enemyTower ? Infinity : FOG_SCREEN_X)

    const variantOf = (t: Tower, cell: Cell) => hash3(t.x, cell.row, cell.col) % blockVariants(t.material)

    const causedCollapse = (r: ShotResult) => (r.hit?.collapsed.length ?? 0) > 0

    /** Dirt, dust and a scorch mark where a ball lands on open ground. */
    const groundImpact = (x: number, y: number, dir: 'out' | 'in') => {
      const a = anim.current
      chunks(a.particles, x, y + 2, 9, 'earth', 0.9)
      dustPlume(a.particles, x, y, 8, 12, 'dirt')
      dustPlume(a.particles, x, y, 3, 14)
      const decals = a.decals[dir]
      decals.push(x)
      if (decals.length > MAX_DECALS) decals.shift()
    }

    const finishShot = (active: ActiveShot) => {
      const a = anim.current
      const { detail, dir } = active
      const limit = visibleLimit()

      if (assets && detail) {
        const { result, towerBefore: tower, placement, mapX } = detail
        const ix = mapX(result.impact.x)
        const iy = result.impact.y
        const onScreen = ix <= limit && ix > -40
        if (onScreen) {
          if (result.hit) {
            const { cell, destroyed, collapsed } = result.hit
            const r = cellRect(placement, cell)
            const cx = r.x + r.w / 2
            const cy = r.y + r.h / 2
            sparks(a.particles, ix, iy, destroyed ? 18 : 12)
            dustPlume(a.particles, cx, cy, destroyed ? 8 : 4, destroyed ? 15 : 10)
            chunks(a.particles, cx, cy, destroyed ? 16 : 6, tower.material, destroyed ? 1.2 : 0.8)
            for (const c of collapsed) {
              const b = cellRect(placement, c)
              const hp = tower.hp[c.row][c.col]
              fallingBlock(
                a.particles,
                b.x + b.w / 2,
                b.y + b.h / 2,
                assets.blockSprite(tower.material, variantOf(tower, c), hp < materialOf(tower).blockHp),
              )
              dustPlume(a.particles, b.x + b.w / 2, b.y + b.h / 2, 1, 14)
            }
            if (collapsed.length) dustPlume(a.particles, placement.screenX + TOWER_WIDTH / 2, 18, 16, 24)
          } else {
            groundImpact(ix, iy, dir)
          }
        }
        if (result.hit) {
          a.shake = causedCollapse(result) ? 16 : result.hit.destroyed ? 9 : 5
        }
      } else if (assets && active.groundLanding) {
        const end = active.path[active.path.length - 1]
        groundImpact(end.x, end.y, dir)
      }
      // Remember the trail for review (the fog hides anything beyond the fog line).
      const trails = a.trails[dir]
      trails.push(active.path)
      if (trails.length > 4) trails.shift()
      a.shot = null
      live.current.onShotEnd(active.id)
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000
      const a = anim.current
      const { myTower, enemyTower, angle } = live.current
      const maxX = visibleLimit()

      // --- size canvas to its CSS box and (re)build sprites for this scale ---
      const cssW = canvas.clientWidth
      if (cssW === 0) return
      const cssH = Math.round((cssW * WORLD_H) / WORLD_W)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      const scale = (cssW / WORLD_W) * dpr
      if (!assets || Math.abs(assets.scale - scale) / scale > 0.02) assets = createAssets(scale)

      // --- advance projectile ---
      let projectile: Vec | null = null
      let pathIndex = 0
      if (a.shot) {
        const path = a.shot.active.path
        // The frame timestamp can predate `startedAt` by a hair, so never go below the first point.
        pathIndex = Math.max(0, Math.floor(((now - a.shot.startedAt) / 1000) * PATH_HZ * PLAYBACK_SPEED))
        if (pathIndex >= path.length - 1) {
          finishShot(a.shot.active)
        } else {
          projectile = path[pathIndex]
          if (projectile.x <= maxX) flightSmoke(a.particles, projectile.x, projectile.y)
        }
      }

      updateParticles(a.particles, dt)
      a.shake = Math.max(0, a.shake - dt * 40)
      a.recoil *= Math.exp(-dt * 6)
      if (a.recoil < 0.05) a.recoil = 0

      // --- scene ---
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.save()
      if (a.shake > 0) ctx.translate(rand(-a.shake, a.shake) * 0.5, rand(-a.shake, a.shake) * 0.5)

      ctx.drawImage(assets.bg, -BG_MARGIN, -BG_MARGIN, WORLD_W + BG_MARGIN * 2, WORLD_H + BG_MARGIN * 2)

      for (const c of assets.clouds) {
        const span = WORLD_W + c.w + 80
        const x = ((c.x0 + t * c.speed) % span) - c.w
        ctx.globalAlpha = c.alpha
        ctx.drawImage(c.sprite, x, c.y, c.w, c.h)
      }
      ctx.globalAlpha = 1

      // scorch marks where shots landed
      for (const x of [...a.decals.out, ...a.decals.in]) {
        if (x > maxX) continue
        ctx.fillStyle = 'rgba(25,15,8,0.38)'
        ctx.beginPath()
        ctx.ellipse(x, GY + 4, 15, 3.4, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(25,15,8,0.3)'
        ctx.beginPath()
        ctx.ellipse(x, GY + 4, 7, 2, 0, 0, Math.PI * 2)
        ctx.fill()
      }

      // your own tower is always on screen; the enemy's only while peeking, else fog
      drawTower(ctx, assets, myTower, MY_PLACEMENT, t)
      if (enemyTower) drawTower(ctx, assets, enemyTower, enemyPlacement(enemyTower), t)
      else drawFog(ctx, assets, t)

      // previous trails (review): yours in white, the enemy's in orange
      for (const [dir, color] of [['out', '255,255,255'], ['in', '255,170,110']] as const) {
        const trails = a.trails[dir]
        trails.forEach((trail, i) => {
          ctx.fillStyle = `rgba(${color},${0.22 + 0.1 * (i / Math.max(1, trails.length))})`
          for (let k = 0; k < trail.length; k += 6) {
            const p = trail[k]
            if (p.x > maxX) continue // enemy shots begin out in the fog
            ctx.beginPath()
            ctx.arc(p.x, GY - p.y, 1.8, 0, Math.PI * 2)
            ctx.fill()
          }
        })
      }

      drawCannon(ctx, assets, { angleDeg: angle, recoil: a.recoil, time: t })

      // projectile
      if (projectile && a.shot && projectile.x <= maxX) {
        const path = a.shot.active.path
        ctx.lineCap = 'round'
        for (let k = Math.max(1, pathIndex - 24); k <= pathIndex; k++) {
          if (path[k - 1].x > maxX) continue
          const f = (k - (pathIndex - 24)) / 24
          ctx.strokeStyle = `rgba(255,236,190,${0.4 * f})`
          ctx.lineWidth = 1 + 3 * f
          ctx.beginPath()
          ctx.moveTo(path[k - 1].x, GY - path[k - 1].y)
          ctx.lineTo(path[k].x, GY - path[k].y)
          ctx.stroke()
        }
        const px = projectile.x
        const py = GY - projectile.y
        const ball = ctx.createRadialGradient(px - 2, py - 2, 0.5, px, py, PROJECTILE_RADIUS)
        ball.addColorStop(0, '#8a92a6')
        ball.addColorStop(0.45, '#2a2d38')
        ball.addColorStop(1, '#0c0d12')
        ctx.fillStyle = ball
        ctx.beginPath()
        ctx.arc(px, py, PROJECTILE_RADIUS, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,200,130,0.5)'
        ctx.beginPath()
        ctx.arc(px + 2.4, py + 2.4, 1.6, 0, Math.PI * 2)
        ctx.fill()
      }

      drawParticles(ctx, assets, a.particles, GY, maxX)
      ctx.restore()

      ctx.drawImage(assets.vignette, 0, 0, WORLD_W, WORLD_H)
    }

    const drawTower = (c: CanvasRenderingContext2D, as: Assets, tw: Tower, placement: Placement, t: number) => {
      // long dusk shadow stretching away from the low sun, towards the cannon
      let top = 0
      forEachBlock(tw, (cell) => (top = Math.max(top, (cell.row + 1) * BLOCK_SIZE)))
      if (top > 0) {
        const len = top * 1.1
        const x0 = placement.screenX
        const sh = c.createLinearGradient(x0, 0, x0 + TOWER_WIDTH + len, 0)
        sh.addColorStop(0, 'rgba(20,12,35,0.45)')
        sh.addColorStop(1, 'rgba(20,12,35,0)')
        c.fillStyle = sh
        c.beginPath()
        c.moveTo(x0, GY)
        c.lineTo(x0 + TOWER_WIDTH, GY)
        c.lineTo(x0 + TOWER_WIDTH + len, GY + 7)
        c.lineTo(x0 + 6, GY + 9)
        c.fill()
      }

      forEachBlock(tw, (cell, hp) => {
        const r = cellRect(placement, cell)
        c.drawImage(as.blockSprite(tw.material, variantOf(tw, cell), hp < materialOf(tw).blockHp), r.x, GY - r.y - r.h, r.w, r.h)
      })

      // pennant on the highest block of the middle column
      const mid = Math.floor(TOWER_COLS / 2)
      let flagRow = -1
      tw.hp.forEach((row, i) => row[mid] > 0 && (flagRow = i))
      if (flagRow >= 0) {
        const bx = placement.screenX + displayCol(placement, mid) * BLOCK_SIZE + BLOCK_SIZE / 2
        const by = GY - (flagRow + 1) * BLOCK_SIZE
        c.fillStyle = '#3b2f2a'
        c.fillRect(bx - 0.8, by - 26, 1.6, 26)
        c.fillStyle = '#d64545'
        c.beginPath()
        c.moveTo(bx + 0.8, by - 26)
        for (let i = 0; i <= 8; i++) c.lineTo(bx + 0.8 + i * 2.2, by - 23 + Math.sin(t * 6 + i * 0.7) * 1.8 * (i / 8))
        c.lineTo(bx + 0.8, by - 14)
        c.fill()
        c.fillStyle = 'rgba(255,220,180,0.35)'
        c.fillRect(bx + 0.8, by - 26, 14, 1.2)
      }
    }

    const drawFog = (c: CanvasRenderingContext2D, as: Assets, t: number) => {
      const fog = c.createLinearGradient(FOG_SCREEN_X - 60, 0, FOG_SCREEN_X + 80, 0)
      fog.addColorStop(0, 'rgba(210,215,230,0)')
      fog.addColorStop(0.5, 'rgba(210,215,230,0.94)')
      fog.addColorStop(1, 'rgba(225,228,240,0.98)')
      c.fillStyle = fog
      c.fillRect(FOG_SCREEN_X - 60, 0, WORLD_W - FOG_SCREEN_X + 60, GY + 14)
      // drifting banks of mist
      for (let i = 0; i < 16; i++) {
        const r = 70 + ((i * 37) % 70)
        const x = FOG_SCREEN_X + 30 + ((i * 131) % (WORLD_W - FOG_SCREEN_X)) + Math.sin(t * 0.25 + i) * 30
        const y = 60 + ((i * 53) % (GY - 60)) + Math.cos(t * 0.2 + i * 2) * 10
        c.globalAlpha = 0.55
        c.drawImage(as.puffs.fog, x - r, y - r, r * 2, r * 2)
      }
      c.globalAlpha = 1
      c.fillStyle = 'rgba(40,50,80,0.6)'
      c.font = '700 24px system-ui, sans-serif'
      c.textAlign = 'center'
      c.fillText('Enemy tower hidden in the fog', (FOG_SCREEN_X + WORLD_W) / 2 + 10, GY - 260)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Battlefield" />
}
