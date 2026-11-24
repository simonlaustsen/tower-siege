import { useEffect, useRef } from 'react'
import {
  BLOCK_SIZE,
  VIEW_EDGE_SCREEN_X,
  VIEW_W,
  GROUND_MARGIN,
  MY_TOWER_X,
  PROJECTILE_RADIUS,
  TOWER_WIDTH,
  WORLD_H,
  WORLD_W,
} from './game/constants'
import { MATERIALS, type MaterialId } from './game/materials'
import type { ShotResult, Vec } from './game/physics'
import { TEAMS, type Team } from './game/teams'
import { damageLevel, forEachBlock, isSoft, type Cell, type Tower } from './game/tower'
import { createAssets, type Assets } from './render/assets'
import { blockVariants, type BlockLook } from './render/blocks'
import { drawAimLine, drawSlingshot, pouchPoint, SLING_ANCHOR } from './render/slingshot'
import { aimFromPull } from './game/sling'
import { cellRect, displayCol, enemyPlacement, MY_PLACEMENT, type MapX, type Placement } from './render/placement'
import {
  chunks,
  drawParticles,
  dustPlume,
  fallingBlock,
  flightSmoke,
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
  /** 'out': you fired it, from your slingshot. 'in': the enemy fired it, in from the right edge at your tower. */
  dir: 'out' | 'in'
  /** Trajectory in screen coordinates. A shot of yours that leaves the screen stops at its right edge. */
  path: Vec[]
  /** The ball lands on open ground in plain view (no detail available). */
  groundLanding: boolean
  /** Impact details, only for towers that are visible: your own, or the enemy's while peeking or revealed. */
  detail: ShotDetail | null
  /**
   * The flight is not complete yet: only its first part is known (up to the fog) until the defender's reply
   * arrives. The ball waits at the end of what is known. Whoever completes it updates `path`, `detail`,
   * `groundLanding` and `reveal` in place and clears this.
   */
  open?: boolean
  /** The enemy's side (a snapshot sent with the reply) is shown for the length of this shot, and then gone again. */
  reveal?: boolean
}

interface Props {
  /** Your own tower. Always shown, next to your slingshot. */
  myTower: Tower
  /** The enemy tower, shown only while peeking (dev). Otherwise null: it only exists on their phone. */
  enemyTower: Tower | null
  /** The aim you have set: how far and in which direction the slingshot is pulled back. */
  angle: number
  power: number
  /** It is your turn: the ball sits in the pouch and can be pulled. */
  canAim: boolean
  /** An aim has been set (by dragging or the steppers): the pouch is held back. Otherwise it rests at the fork. */
  aimed: boolean
  /** The player pulled the pouch to a new aim. */
  onAim: (angle: number, power: number) => void
  /** The pouch was let go at this aim: fire. `null` when it was put back at the fork (cancel). */
  onRelease: (aim: { angle: number; power: number } | null) => void
  /** Your colour, and the enemy's. */
  myTeam: Team
  enemyTeam: Team
  shot: ActiveShot | null
  onShotEnd: (id: number) => void
}

const PLAYBACK_SPEED = 1.7 // x real-time; sim path is sampled at 120 Hz
const PATH_HZ = 120
const GY = WORLD_H - GROUND_MARGIN
const MAX_DECALS = 6
/** Camera: one gentle zoom for the whole shot, from launch to the moment after the impact. */
const CAM_ZOOM = 1.14
/** How long (ms) the camera lingers on an impact before easing home. */
const IMPACT_HOLD_MS = 1100
/** Exponential easing rates (per second) for the camera's zoom and position. */
const CAM_ZOOM_RATE = 3
const CAM_POS_RATE = 10
/** How fast (per second) the camera's reach opens up to the enemy's half when it is revealed, and closes again. */
const CAM_REACH_RATE = 8
/** How long (ms) the revealed side stays after the impact before the fog closes over it again. */
const REVEAL_LINGER_MS = IMPACT_HOLD_MS + 300
/** The revealed tower starts to appear when the ball is this close (world units) to the fog line. */
const REVEAL_LEAD_IN = 150
/** Where the camera looks for an incoming shot: around your tower and slingshot. */
const TOWER_FOCUS_X = 170
/** The camera looks this many path samples (120 per second of flight) ahead of the ball, so the view is where it is going. */
const CAM_LOOKAHEAD = 36
/** How close (world units) a press must be to the pouch or fork to pick it up. */
const GRAB_RADIUS = 70
/** Letting go with the pouch closer to the fork than this (world units) is a cancel, not a shot. */
const CANCEL_PULL = 14

/** Canvas renderer. Owns animation state (projectile, particles); game state comes via props. */
export function GameCanvas({ myTower, enemyTower, angle, power, canAim, aimed, onAim, onRelease, myTeam, enemyTeam, shot, onShotEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Latest props, readable from the long-lived animation loop.
  const live = useRef({ myTower, enemyTower, angle, power, canAim, aimed, onAim, onRelease, myTeam, enemyTeam, onShotEnd })
  live.current = { myTower, enemyTower, angle, power, canAim, aimed, onAim, onRelease, myTeam, enemyTeam, onShotEnd }

  const anim = useRef({
    /** `elapsed` is seconds of real playback time. */
    shot: null as { active: ActiveShot; elapsed: number } | null,
    // Your shots and the enemy's are remembered separately so they can be drawn in different colours.
    trails: { out: [] as Vec[][], in: [] as Vec[][] },
    decals: { out: [] as number[], in: [] as number[] }, // x of scorch marks on the ground
    particles: [] as Particle[],
    shake: 0,
    /** How far the pouch is drawn back: 1 at full aim, 0 relaxed. Snaps to 0 on release. */
    pull: 0,
    released: false,
    dragging: false,
    viewW: VIEW_W,
    /**
     * The camera: zoom and the world point at the middle of the screen, eased towards a target each frame.
     * x0/y0 is the resulting top-left of the view, kept so pointer positions can be mapped back to the world.
     * `reach` is how far right the camera may look: the fog edge, widening (smoothly) to the whole world only
     * while the enemy's side is revealed. It must never jump, or the view would jump with it.
     */
    cam: { z: 1, cx: VIEW_W / 2, cy: WORLD_H / 2, x0: 0, y0: 0, reach: VIEW_W },
    /** After a shot lands, the camera lingers here (screen coordinates) until the time (ms) runs out. */
    hold: null as { x: number; y: number; until: number } | null,
    /**
     * The enemy's side, shown only while one of your shots is reaching it: their tower (as it stood, then as it
     * is left) and slingshot fade in as the ball nears the fog, and out again after the impact.
     */
    reveal: null as { tower: Tower; placement: Placement; fade: number; until: number } | null,
  })

  // Begin a new shot animation when a new shot arrives.
  useEffect(() => {
    if (!shot) return
    const a = anim.current
    a.shot = { active: shot, elapsed: 0 }
    a.hold = null
    if (shot.dir === 'in') a.reveal = null // the fog is back for good before the enemy fires
    if (shot.dir === 'out') {
      // The pouch is let go. (The enemy's slingshot is off screen, so its shots just arrive.)
      a.pull = Math.min(a.pull, 1)
      a.released = true
      const [release] = shot.path
      dustPlume(a.particles, release.x, release.y, 3, 10)
    }
  }, [shot])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let assets: Assets | null = null

    /** Beyond this screen x nothing may be seen: the edge of the screen, unless the enemy tower is being peeked at. */
    const visibleLimit = () => (live.current.enemyTower || anim.current.reveal ? Infinity : VIEW_EDGE_SCREEN_X)

    const variantOf = (t: Tower, cell: Cell) => hash3(t.x, cell.row, cell.col) % blockVariants(t.material)
    const lookOf = (t: Tower, cell: Cell): BlockLook => ({ damage: damageLevel(t, cell), rotten: isSoft(t, cell) })

    /**
     * Block sprites are made the first time they are drawn. The enemy's tower is only ever drawn during a reveal, so
     * without this every look of every block would be painted in the one frame it appears. Do it up front, a few at a time.
     */
    let warmTimer: ReturnType<typeof setTimeout> | undefined
    const warmBlocks = (as: Assets) => {
      clearTimeout(warmTimer)
      const jobs: [MaterialId, number, BlockLook][] = []
      for (const material of Object.keys(MATERIALS) as MaterialId[])
        for (let v = 0; v < blockVariants(material); v++)
          for (const damage of [0, 1, 2] as const) for (const rotten of [false, true]) jobs.push([material, v, { damage, rotten }])
      const step = () => {
        if (as !== assets) return // the sprites were rebuilt at another scale meanwhile
        for (let i = 0; i < 3 && jobs.length; i++) as.blockSprite(...jobs.shift()!)
        if (jobs.length) warmTimer = setTimeout(step, 24)
      }
      warmTimer = setTimeout(step, 24)
    }

    const causedCollapse = (r: ShotResult) => (r.hit?.collapsed.length ?? 0) > 0

    /** Dirt, dust and a scorch mark where a ball lands on open ground. */
    const groundImpact = (x: number, y: number, dir: 'out' | 'in') => {
      const a = anim.current
      chunks(a.particles, x, y + 2, 9, 'earth', 0.9)
      dustPlume(a.particles, x, y, 8, 12, 'dirt')
      dustPlume(a.particles, x, y, 3, 14)
      // A scorch mark out in the enemy's half would outlast the reveal and give away where it was.
      if (x > VIEW_EDGE_SCREEN_X && !live.current.enemyTower) return
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
              fallingBlock(
                a.particles,
                b.x + b.w / 2,
                b.y + b.h / 2,
                assets.blockSprite(tower.material, variantOf(tower, c), lookOf(tower, c)),
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
      // Remember the trail for review (nothing past the right edge is shown).
      const trails = a.trails[dir]
      trails.push(live.current.enemyTower ? active.path : active.path.filter((p) => p.x <= VIEW_EDGE_SCREEN_X))
      if (trails.length > 4) trails.shift()
      // Linger on where it landed (but never beyond the visible edge).
      const end = active.path[active.path.length - 1]
      const at = detail ? { x: detail.mapX(detail.result.impact.x), y: detail.result.impact.y } : end
      a.hold = { x: Math.min(at.x, limit), y: GY - at.y, until: performance.now() + IMPACT_HOLD_MS }
      if (active.reveal && a.reveal && detail) {
        a.reveal.tower = detail.result.towerAfter // blocks that broke are gone
        a.reveal.until = performance.now() + REVEAL_LINGER_MS
      }
      a.shot = null
      live.current.onShotEnd(active.id)
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000
      const a = anim.current
      const { myTower, enemyTower, angle, power, canAim, aimed, myTeam, enemyTeam } = live.current
      const act = a.shot?.active
      if (act?.reveal && act.detail && !a.reveal) {
        const tower = act.detail.towerBefore
        a.reveal = { tower, placement: enemyPlacement(tower), fade: 0, until: Infinity }
      }
      const maxX = visibleLimit()

      // --- size canvas to its CSS box and (re)build sprites for this scale ---
      // The screen shows just your side (your tower and slingshot); peeking at the enemy needs the whole field.
      const viewW = enemyTower ? WORLD_W : VIEW_W
      a.viewW = viewW
      const ratio = `${viewW} / ${WORLD_H}`
      if (canvas.style.aspectRatio !== ratio) canvas.style.aspectRatio = ratio
      const cssW = canvas.clientWidth
      if (cssW === 0) return
      const cssH = Math.round((cssW * WORLD_H) / viewW)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      const scale = (cssW / viewW) * dpr
      if (!assets || Math.abs(assets.scale - scale) / scale > 0.02) {
        assets = createAssets(scale)
        warmBlocks(assets)
      }

      // --- advance projectile ---
      let projectile: Vec | null = null
      let pathIndex = 0
      if (a.shot) {
        const path = a.shot.active.path
        a.shot.elapsed += dt
        pathIndex = Math.max(0, Math.floor(a.shot.elapsed * PATH_HZ * PLAYBACK_SPEED))
        if (pathIndex >= path.length - 1 && a.shot.active.open) {
          // The rest of the flight is still on its way from the other phone: wait at the end of what is known.
          pathIndex = path.length - 1
          a.shot.elapsed = pathIndex / (PATH_HZ * PLAYBACK_SPEED)
          projectile = path[pathIndex]
        } else if (pathIndex >= path.length - 1) {
          finishShot(a.shot.active)
        } else {
          projectile = path[pathIndex]
          if (projectile.x <= maxX) flightSmoke(a.particles, projectile.x, projectile.y)
        }
      }

      updateParticles(a.particles, dt)
      a.shake = Math.max(0, a.shake - dt * 40)
      // The pouch rests at the fork until you pull it, springs forward when released, and eases back if you let it go.
      if (a.released) {
        a.pull = Math.max(0, a.pull - dt * 14)
        if (a.pull === 0) a.released = false
      } else if (canAim && (a.dragging || aimed)) a.pull = a.dragging ? 1 : Math.min(1, a.pull + dt * 6)
      else a.pull = Math.max(0, a.pull - dt * 8)

      // --- the enemy's side: appears as the ball nears the fog, goes again once the impact has had its moment ---
      const rv = a.reveal
      if (rv) {
        const arriving = !!projectile && projectile.x > VIEW_EDGE_SCREEN_X - REVEAL_LEAD_IN
        const showing = a.shot ? arriving : now < rv.until
        rv.fade += ((showing ? 1 : 0) - rv.fade) * (1 - Math.exp(-dt * 5))
        // Gone only once the fog is back and the camera is home again, so the view's limits do not jump.
        if (!a.shot && now >= rv.until && rv.fade < 0.01 && a.cam.z < 1.02 && a.cam.x0 < 2) a.reveal = null
      }
      const revealed = !!a.reveal

      // --- camera: follow the ball, close in for the impact, then ease home ---
      // Always home while peeking at the enemy or while you can aim, so aiming never happens through a moved camera.
      const cam = a.cam
      let tz = 1
      let tx = viewW / 2
      let ty = WORLD_H / 2
      if (!enemyTower && !canAim) {
        if (projectile) {
          tz = CAM_ZOOM
          // Aim at where the ball will be a moment from now, and at the impact itself once the flight is near its end.
          const path = a.shot!.active.path
          const ahead = path[Math.min(pathIndex + CAM_LOOKAHEAD, path.length - 1)]
          tx = ahead.x
          ty = GY - ahead.y
          if (a.shot?.active.dir === 'in') {
            // An incoming ball is heading for your tower: stay by the tower and lean a little towards the ball, rather
            // than chasing it into the sky or in from the far edge.
            tx = TOWER_FOCUS_X + (Math.min(projectile.x, VIEW_EDGE_SCREEN_X) - TOWER_FOCUS_X) * 0.3
            ty = ty * 0.35 + (GY - 130) * 0.65
          }
        } else if (a.hold && now < a.hold.until) {
          tz = CAM_ZOOM
          tx = a.hold.x
          ty = a.hold.y
        }
      }
      // The camera never aims past what it can currently show (the fog edge, until the reveal has opened it up). Aiming
      // past it would store up a gap that is released in one go the moment the reveal widens the view.
      tx = Math.min(tx, Math.max(cam.reach, viewW) - viewW / (2 * cam.z))
      const kz = 1 - Math.exp(-dt * CAM_ZOOM_RATE)
      const kp = 1 - Math.exp(-dt * CAM_POS_RATE)
      cam.z += (tz - cam.z) * kz
      cam.cx += (tx - cam.cx) * kp
      cam.cy += (ty - cam.cy) * kp
      // Keep the view inside the visible area: the fog edge, unless the enemy's side is being revealed.
      cam.reach += ((revealed ? WORLD_W : viewW) - cam.reach) * (1 - Math.exp(-dt * CAM_REACH_RATE))
      cam.reach = Math.max(cam.reach, viewW)
      cam.x0 = Math.max(0, Math.min(cam.cx - viewW / (2 * cam.z), cam.reach - viewW / cam.z))
      cam.y0 = Math.min(Math.max(cam.cy - WORLD_H / (2 * cam.z), 0), WORLD_H - WORLD_H / cam.z)

      // --- scene ---
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.save()
      ctx.scale(cam.z, cam.z)
      ctx.translate(-cam.x0, -cam.y0)
      if (a.shake > 0) ctx.translate(rand(-a.shake, a.shake) * 0.5, rand(-a.shake, a.shake) * 0.5)

      ctx.drawImage(assets.bg, -BG_MARGIN, -BG_MARGIN, WORLD_W + BG_MARGIN * 2, WORLD_H + BG_MARGIN * 2)

      for (const c of assets.clouds) {
        const span = viewW + c.w + 80
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

      // your own tower is always on screen; the enemy's only while peeking, else just a pointer to where it is
      drawTower(ctx, assets, myTower, MY_PLACEMENT, t, TEAMS[myTeam].main)
      if (enemyTower) drawTower(ctx, assets, enemyTower, enemyPlacement(enemyTower), t, TEAMS[enemyTeam].main)
      else {
        const fade = a.reveal?.fade ?? 0
        if (fade < 0.99) {
          ctx.globalAlpha = 1 - fade
          drawEnemyDirection(ctx, viewW, t, enemyTeam)
          ctx.globalAlpha = 1
        }
        if (a.reveal && fade > 0.01) {
          ctx.globalAlpha = fade
          drawEnemySlingshot(ctx, a.reveal.placement, t, enemyTeam)
          drawTower(ctx, assets, a.reveal.tower, a.reveal.placement, t, TEAMS[enemyTeam].main)
          ctx.globalAlpha = 1
        }
      }

      // previous trails (review): yours in your team's colour, the enemy's in theirs
      for (const [dir, color] of [['out', TEAMS[myTeam].lightRgb], ['in', TEAMS[enemyTeam].lightRgb]] as const) {
        const trails = a.trails[dir]
        trails.forEach((trail, i) => {
          ctx.fillStyle = `rgba(${color},${0.22 + 0.1 * (i / Math.max(1, trails.length))})`
          for (let k = 0; k < trail.length; k += 6) {
            const p = trail[k]
            if (p.x > maxX) continue // enemy shots begin off screen
            ctx.beginPath()
            ctx.arc(p.x, GY - p.y, 1.8, 0, Math.PI * 2)
            ctx.fill()
          }
        })
      }

      const sling = { aim: { angle, power }, pull: a.pull, loaded: canAim && !a.released, time: t, team: TEAMS[myTeam] }
      drawSlingshot(ctx, sling)
      if (canAim && !a.released && a.pull > 0.05) drawAimLine(ctx, sling)

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

      const vig = ctx.createRadialGradient(viewW / 2, WORLD_H * 0.55, WORLD_H * 0.35, viewW / 2, WORLD_H * 0.55, Math.max(viewW, WORLD_H) * 0.65)
      vig.addColorStop(0, 'rgba(10,8,30,0)')
      vig.addColorStop(1, 'rgba(10,8,30,0.5)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, viewW, WORLD_H)
    }

    const drawTower = (c: CanvasRenderingContext2D, as: Assets, tw: Tower, placement: Placement, t: number, flag: string) => {
      // long dusk shadow stretching away from the low sun, towards the slingshot
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

      forEachBlock(tw, (cell) => {
        const r = cellRect(placement, cell)
        c.drawImage(as.blockSprite(tw.material, variantOf(tw, cell), lookOf(tw, cell)), r.x, GY - r.y - r.h, r.w, r.h)
      })

      // pennant on the highest block (the one nearest the middle, if the top row has several)
      let flagRow = -1
      tw.hp.forEach((row, i) => row.some((v) => v > 0) && (flagRow = i))
      const mid = flagRow < 0 ? 0 : [...tw.hp[flagRow].keys()].filter((col) => tw.hp[flagRow][col] > 0).sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1))[0]
      if (flagRow >= 0) {
        const bx = placement.screenX + displayCol(placement, mid) * BLOCK_SIZE + BLOCK_SIZE / 2
        const by = GY - (flagRow + 1) * BLOCK_SIZE
        c.fillStyle = '#3b2f2a'
        c.fillRect(bx - 0.8, by - 26, 1.6, 26)
        c.fillStyle = flag
        c.beginPath()
        c.moveTo(bx + 0.8, by - 26)
        for (let i = 0; i <= 8; i++) c.lineTo(bx + 0.8 + i * 2.2, by - 23 + Math.sin(t * 6 + i * 0.7) * 1.8 * (i / 8))
        c.lineTo(bx + 0.8, by - 14)
        c.fill()
        c.fillStyle = 'rgba(255,220,180,0.35)'
        c.fillRect(bx + 0.8, by - 26, 14, 1.2)
      }
    }

    /** Their slingshot stands between their tower and you, like yours does: the same one, turned to face you. */
    const drawEnemySlingshot = (c: CanvasRenderingContext2D, placement: Placement, t: number, team: Team) => {
      const gap = SLING_ANCHOR.x - (MY_TOWER_X + TOWER_WIDTH) // from the tower's near face to the slingshot, as on your side
      c.save()
      c.translate(placement.screenX - gap, 0)
      c.scale(-1, 1)
      c.translate(-SLING_ANCHOR.x, 0)
      drawSlingshot(c, { aim: { angle: 45, power: 50 }, pull: 0, loaded: false, time: t, team: TEAMS[team] })
      c.restore()
    }

    /** The enemy is off the right edge of the screen: a glow and drifting arrows, in their colour, say so. */
    const drawEnemyDirection = (c: CanvasRenderingContext2D, viewW: number, t: number, team: Team) => {
      const style = TEAMS[team]
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4)
      const glow = c.createLinearGradient(viewW - 90, 0, viewW, 0)
      glow.addColorStop(0, `rgba(${style.rgb},0)`)
      glow.addColorStop(1, `rgba(${style.rgb},${0.2 + 0.14 * pulse})`)
      c.fillStyle = glow
      c.fillRect(viewW - 90, 0, 90, GY + 14)

      // three arrows drifting towards the enemy, each fading in and out in turn
      const cy = GY - 150
      for (let i = 0; i < 3; i++) {
        const phase = (t * 1.4 - i * 0.28) % 1.0
        const k = phase < 0 ? phase + 1 : phase
        const x = viewW - 62 + i * 15 + k * 8
        c.strokeStyle = `rgba(${style.lightRgb},${0.35 + 0.6 * Math.sin(k * Math.PI)})`
        c.lineWidth = 5
        c.lineCap = 'round'
        c.lineJoin = 'round'
        c.beginPath()
        c.moveTo(x, cy - 15)
        c.lineTo(x + 12, cy)
        c.lineTo(x, cy + 15)
        c.stroke()
      }
      c.textAlign = 'right'
      c.font = '800 17px system-ui, sans-serif'
      c.lineWidth = 4
      c.strokeStyle = 'rgba(15,10,25,0.75)'
      c.strokeText(style.name.toUpperCase(), viewW - 12, cy - 30)
      c.fillStyle = style.light
      c.fillText(style.name.toUpperCase(), viewW - 12, cy - 30)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(warmTimer)
    }
  }, [])

  // ---- pulling the slingshot with a finger or the mouse ----
  /** Pointer position in the canvas's own world units (y down, like the screen). */
  const worldPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { viewW, cam } = anim.current
    // Undo the camera so the pointer lands on the right world point even while it is still easing home.
    return {
      x: cam.x0 + (((e.clientX - rect.left) / rect.width) * viewW) / cam.z,
      y: cam.y0 + (((e.clientY - rect.top) / rect.height) * WORLD_H) / cam.z,
    }
  }
  const near = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { angle, power } = live.current
    const p = worldPoint(e)
    const pouch = pouchPoint({ angle, power }, 1)
    // Fingers are big: grab anywhere near the pouch or the fork.
    return Math.hypot(p.x - pouch.x, p.y - pouch.y) < GRAB_RADIUS || Math.hypot(p.x - SLING_ANCHOR.x, p.y - SLING_ANCHOR.y) < GRAB_RADIUS
  }
  const pullOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = worldPoint(e)
    return { dx: SLING_ANCHOR.x - p.x, dy: p.y - SLING_ANCHOR.y }
  }
  const pullTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const aim = aimFromPull(pullOf(e))
    live.current.onAim(aim.angle, aim.power)
  }

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      aria-label="Battlefield: drag back from the slingshot to aim"
      onPointerDown={(e) => {
        if (!live.current.canAim || !near(e)) return
        try {
          e.currentTarget.setPointerCapture(e.pointerId) // keep the drag if the finger leaves the canvas
        } catch {
          // not an active pointer: the drag still works while it stays over the canvas
        }
        anim.current.dragging = true
        pullTo(e)
      }}
      onPointerMove={(e) => {
        if (anim.current.dragging && e.pointerType === 'mouse' && e.buttons === 0) {
          // The button was let go somewhere we never heard about: don't leave the pouch stuck to the cursor.
          anim.current.dragging = false
          live.current.onRelease(null)
        } else if (anim.current.dragging) pullTo(e)
        else e.currentTarget.style.cursor = live.current.canAim && near(e) ? 'grab' : 'default'
      }}
      onPointerUp={(e) => {
        const wasDragging = anim.current.dragging
        anim.current.dragging = false
        if (wasDragging && live.current.canAim) {
          // Letting go fires. Dropping the pouch back at the fork cancels instead.
          const pull = pullOf(e)
          live.current.onRelease(Math.hypot(pull.dx, pull.dy) >= CANCEL_PULL ? aimFromPull(pull) : null)
        }
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        if (anim.current.dragging) live.current.onRelease(null)
        anim.current.dragging = false
      }}
    />
  )
}
