import { GROUND_MARGIN, PROJECTILE_RADIUS, SLING_SCREEN_X, SLING_Y, WORLD_H } from '../game/constants'
import type { ShotInput } from '../game/physics'
import { pullFromAim } from '../game/sling'

const GY = WORLD_H - GROUND_MARGIN
/** Where the ball is released, on screen: between the tips of the fork. */
export const SLING_ANCHOR = { x: SLING_SCREEN_X, y: GY - SLING_Y }

const TIP = 15 // half the gap between the fork's tips
const TIP_LIFT = 4

export interface SlingPose {
  aim: ShotInput
  /** 0: relaxed, 1: pulled back by the aim. */
  pull: number
  /** The ball sits in the pouch (it is your turn and nothing is in the air). */
  loaded: boolean
  /** Seconds, for small animations. */
  time: number
  /** Colours of the team banner and rubber bands. */
  team: { main: string; dark: string; light: string; lightRgb: string }
}

/** Where the pouch is on screen for a given aim and pull. */
export function pouchPoint(aim: ShotInput, pull: number) {
  const { dx, dy } = pullFromAim(aim)
  return { x: SLING_ANCHOR.x - dx * pull, y: SLING_ANCHOR.y + dy * pull }
}

/** A cloth banner in the team's colour on a pole, flying towards the enemy. */
function banner(ctx: CanvasRenderingContext2D, pose: SlingPose) {
  const x = SLING_ANCHOR.x + 62
  const top = GY - 88
  ctx.fillStyle = '#3b2f2a'
  ctx.fillRect(x - 1.2, top - 4, 2.4, 92)
  ctx.fillStyle = '#d9b45a'
  ctx.beginPath()
  ctx.arc(x, top - 5, 3.2, 0, Math.PI * 2)
  ctx.fill()
  const w = 34
  const h = 24
  const wave = (i: number) => Math.sin(pose.time * 5 + i * 0.8) * 2.4 * (i / 8)
  ctx.fillStyle = pose.team.main
  ctx.beginPath()
  ctx.moveTo(x + 1.2, top)
  for (let i = 0; i <= 8; i++) ctx.lineTo(x + 1.2 + (i * w) / 8, top + wave(i))
  ctx.lineTo(x + 1.2 + w - 8, top + h / 2 + wave(8))
  for (let i = 8; i >= 0; i--) ctx.lineTo(x + 1.2 + (i * w) / 8, top + h + wave(i))
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = pose.team.dark
  ctx.globalAlpha = 0.45
  ctx.fillRect(x + 1.2, top + h - 5, w - 6, 4)
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.fillRect(x + 1.2, top, w - 4, 2)
}

/** A forked branch: trunk from the ground, splitting into two prongs. */
function fork(ctx: CanvasRenderingContext2D, side: 'back' | 'front') {
  const { x, y } = SLING_ANCHOR
  const bark = ctx.createLinearGradient(x - 12, 0, x + 12, 0)
  bark.addColorStop(0, '#4a2f19')
  bark.addColorStop(0.45, '#9a6c3d')
  bark.addColorStop(1, '#4a2f19')
  const split = y + 34
  const prong = (tipX: number, shade: string) => {
    ctx.strokeStyle = shade
    ctx.lineCap = 'round'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(x, split + 4)
    ctx.quadraticCurveTo(x + (tipX - x) * 0.25, split - 10, tipX, y - TIP_LIFT)
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,225,170,0.3)'
    ctx.beginPath()
    ctx.moveTo(x + (tipX - x) * 0.1, split)
    ctx.quadraticCurveTo(x + (tipX - x) * 0.3, split - 10, tipX - 1, y - TIP_LIFT + 2)
    ctx.stroke()
  }
  if (side === 'back') {
    prong(x + TIP, '#5a3a1f')
    return
  }
  // trunk
  ctx.fillStyle = bark
  ctx.beginPath()
  ctx.moveTo(x - 11, GY + 2)
  ctx.quadraticCurveTo(x - 6, (GY + split) / 2, x - 5, split + 6)
  ctx.lineTo(x + 5, split + 6)
  ctx.quadraticCurveTo(x + 6, (GY + split) / 2, x + 11, GY + 2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(30,18,8,0.4)'
  ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    const yy = split + 22 + i * ((GY - split - 26) / 3)
    ctx.beginPath()
    ctx.moveTo(x - 4 + (i % 2) * 2, yy)
    ctx.lineTo(x + 2 + (i % 2) * 2, yy + 5)
    ctx.stroke()
  }
  prong(x - TIP, '#7a5230')
  // knots at the tips where the bands are tied
  for (const tx of [x - TIP, x + TIP]) {
    ctx.fillStyle = '#c9a15c'
    ctx.beginPath()
    ctx.arc(tx, y - TIP_LIFT, 3.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** One rubber band from a fork tip to the pouch. A relaxed band sags; a stretched one is taut and thinner. */
function band(ctx: CanvasRenderingContext2D, tipX: number, pouch: { x: number; y: number }, stretch: number, color: string) {
  const ty = SLING_ANCHOR.y - TIP_LIFT
  const sag = (1 - stretch) * 12
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = 5.5 - 2.4 * stretch
  ctx.beginPath()
  ctx.moveTo(tipX, ty)
  ctx.quadraticCurveTo((tipX + pouch.x) / 2, (ty + pouch.y) / 2 + sag, pouch.x, pouch.y)
  ctx.stroke()
}

/** The dashed line the ball will fly along: from the pouch through the fork and out into the sky. */
export function drawAimLine(ctx: CanvasRenderingContext2D, pose: SlingPose) {
  const p = pouchPoint(pose.aim, pose.pull)
  const a = (pose.aim.angle * Math.PI) / 180
  // Stop the line where it would meet the ground, if the ball is aimed downwards.
  const down = Math.sin(a) < 0 ? (GY - SLING_ANCHOR.y) / -Math.sin(a) : Infinity
  const reach = Math.min(170, down)
  const end = { x: SLING_ANCHOR.x + Math.cos(a) * reach, y: SLING_ANCHOR.y - Math.sin(a) * reach }
  const grad = ctx.createLinearGradient(SLING_ANCHOR.x, SLING_ANCHOR.y, end.x, end.y)
  grad.addColorStop(0, `rgba(${pose.team.lightRgb},0.95)`)
  grad.addColorStop(1, `rgba(${pose.team.lightRgb},0.1)`)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.setLineDash([10, 9])
  ctx.lineDashOffset = -pose.time * 26 // the dashes run the way the ball will go
  const line = () => {
    ctx.beginPath()
    ctx.moveTo(SLING_ANCHOR.x, SLING_ANCHOR.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  }
  // a dark edge keeps the dashes readable against the bright sun and sky
  ctx.strokeStyle = 'rgba(20,10,35,0.35)'
  ctx.lineWidth = 6.4
  line()
  ctx.strokeStyle = grad
  ctx.lineWidth = 3.6
  line()
  // a fainter stretch behind the fork shows the pull itself
  ctx.strokeStyle = `rgba(${pose.team.lightRgb},0.35)`
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(SLING_ANCHOR.x, SLING_ANCHOR.y)
  ctx.stroke()
  ctx.restore()
}

/** Forked branch, rubber bands, leather pouch and ball. Fork tips are at `SLING_ANCHOR` ± TIP. */
export function drawSlingshot(ctx: CanvasRenderingContext2D, pose: SlingPose) {
  banner(ctx, pose)

  // dirt mound at the foot
  ctx.fillStyle = '#5e4630'
  ctx.beginPath()
  ctx.ellipse(SLING_ANCHOR.x, GY + 1, 34, 7, 0, Math.PI, 0)
  ctx.fill()

  const pouch = pouchPoint(pose.aim, pose.pull)
  const band_color = pose.team.main

  band(ctx, SLING_ANCHOR.x + TIP, pouch, pose.pull, pose.team.dark)
  fork(ctx, 'back')
  fork(ctx, 'front')

  // pouch and ball
  ctx.save()
  ctx.translate(pouch.x, pouch.y)
  ctx.rotate(Math.atan2(SLING_ANCHOR.y - pouch.y, SLING_ANCHOR.x - pouch.x) || 0)
  ctx.fillStyle = '#6b4526'
  ctx.beginPath()
  ctx.ellipse(-1, 0, 6, 11, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2e1c0e'
  ctx.lineWidth = 1.2
  ctx.stroke()
  if (pose.loaded) {
    const ball = ctx.createRadialGradient(-2, -2, 0.5, 0, 0, PROJECTILE_RADIUS)
    ball.addColorStop(0, '#8a92a6')
    ball.addColorStop(0.45, '#2a2d38')
    ball.addColorStop(1, '#0c0d12')
    ctx.fillStyle = ball
    ctx.beginPath()
    ctx.arc(2, 0, PROJECTILE_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,200,130,0.5)'
    ctx.beginPath()
    ctx.arc(4.4, 2.4, 1.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  band(ctx, SLING_ANCHOR.x - TIP, pouch, pose.pull, band_color)
}
