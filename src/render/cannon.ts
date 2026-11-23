import { BARREL_LENGTH, CANNON_SCREEN_X, CANNON_Y, GROUND_MARGIN, WORLD_H } from '../game/constants'
import type { Assets } from './assets'

const GY = WORLD_H - GROUND_MARGIN

export interface CannonPose {
  angleDeg: number
  /** Barrel kick-back in world units (0 at rest). */
  recoil: number
  /** Seconds, for the fuse ember flicker. */
  time: number
}

function sandbags(ctx: CanvasRenderingContext2D) {
  // stacked in front of the cannon, on the side the enemy is on
  const bags: [number, number, number][] = [[64, 0, 15], [86, 0, 15], [75, -9, 14]]
  for (const [x, y, w] of bags) {
    ctx.fillStyle = '#b39a69'
    ctx.beginPath()
    ctx.ellipse(CANNON_SCREEN_X + x, GY + y - 5, w, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,235,190,0.35)'
    ctx.beginPath()
    ctx.ellipse(CANNON_SCREEN_X + x - 3, GY + y - 8, w * 0.6, 3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(70,50,25,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(CANNON_SCREEN_X + x - w * 0.6, GY + y - 5)
    ctx.lineTo(CANNON_SCREEN_X + x + w * 0.6, GY + y - 5)
    ctx.stroke()
  }
}

function wheel(ctx: CanvasRenderingContext2D, rot: number) {
  ctx.save()
  ctx.translate(-2, CANNON_Y - 17)
  ctx.rotate(rot)
  ctx.fillStyle = '#34261a'
  ctx.beginPath()
  ctx.arc(0, 0, 17, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8b5e34'
  ctx.beginPath()
  ctx.arc(0, 0, 14.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#a8814f'
  ctx.lineWidth = 2.4
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4)
    ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14)
    ctx.stroke()
  }
  ctx.strokeStyle = '#5d636d'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.arc(0, 0, 16.1, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#2b2e36'
  ctx.beginPath()
  ctx.arc(0, 0, 4.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8c94a3'
  ctx.beginPath()
  ctx.arc(-1, -1, 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function barrel(ctx: CanvasRenderingContext2D, recoil: number) {
  ctx.save()
  ctx.translate(-recoil, 0)
  const grad = ctx.createLinearGradient(0, -11.5, 0, 11.5)
  grad.addColorStop(0, '#171a26')
  grad.addColorStop(0.25, '#59627a')
  grad.addColorStop(0.42, '#9aa5bd')
  grad.addColorStop(0.7, '#4a5164')
  grad.addColorStop(1, '#141722')

  // tapered tube with a flared muzzle lip
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(-14, -11)
  ctx.lineTo(34, -8)
  ctx.lineTo(34, -9.6)
  ctx.lineTo(BARREL_LENGTH, -9.6)
  ctx.lineTo(BARREL_LENGTH, 9.6)
  ctx.lineTo(34, 9.6)
  ctx.lineTo(34, 8)
  ctx.lineTo(-14, 11)
  ctx.closePath()
  ctx.fill()

  // reinforcing rings
  for (const x of [-6, 10, 25]) {
    const hw = 11 - (x + 14) * 0.065
    ctx.fillStyle = '#2a2f40'
    ctx.fillRect(x, -hw - 1, 4, hw * 2 + 2)
    ctx.fillStyle = 'rgba(190,205,235,0.35)'
    ctx.fillRect(x, -hw - 1, 1.3, hw * 2 + 2)
  }
  ctx.fillStyle = '#242838'
  ctx.fillRect(BARREL_LENGTH - 3, -10.4, 3, 20.8)
  ctx.fillStyle = 'rgba(190,205,235,0.4)'
  ctx.fillRect(34, -9.6, BARREL_LENGTH - 34, 1.4)

  // cascabel
  const ball = ctx.createRadialGradient(-18, -2, 1, -17, 0, 6.5)
  ball.addColorStop(0, '#9aa5bd')
  ball.addColorStop(1, '#1a1d29')
  ctx.fillStyle = ball
  ctx.beginPath()
  ctx.arc(-17, 0, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Wooden carriage, spoked wheel and iron barrel. Origin is the world; y up is flipped by GY. */
export function drawCannon(ctx: CanvasRenderingContext2D, assets: Assets, pose: CannonPose) {
  const rad = (pose.angleDeg * Math.PI) / 180
  sandbags(ctx)

  // dirt mound
  ctx.fillStyle = '#5e4630'
  ctx.beginPath()
  ctx.ellipse(CANNON_SCREEN_X + 2, GY + 1, 46, 7, 0, Math.PI, 0)
  ctx.fill()

  ctx.save()
  ctx.translate(CANNON_SCREEN_X - pose.recoil * 0.3, GY - CANNON_Y)

  // carriage cheek
  const wood = ctx.createLinearGradient(0, -6, 0, CANNON_Y)
  wood.addColorStop(0, '#8d6238')
  wood.addColorStop(1, '#4b3019')
  ctx.fillStyle = wood
  ctx.beginPath()
  ctx.moveTo(-36, CANNON_Y - 3)
  ctx.lineTo(-20, -5)
  ctx.lineTo(24, -5)
  ctx.lineTo(37, CANNON_Y - 3)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(30,18,8,0.45)'
  ctx.lineWidth = 1
  for (let x = -26; x <= 28; x += 9) {
    ctx.beginPath()
    ctx.moveTo(x, -4)
    ctx.lineTo(x * 1.12, CANNON_Y - 4)
    ctx.stroke()
  }
  ctx.fillStyle = '#3a2615'
  ctx.fillRect(-40, CANNON_Y - 4, 80, 5)
  ctx.fillStyle = '#4f555f'
  ctx.fillRect(-21, -6, 46, 3.5)
  ctx.fillStyle = 'rgba(210,220,240,0.35)'
  ctx.fillRect(-21, -6, 46, 1)

  wheel(ctx, -pose.recoil * 0.09)

  // barrel, trunnion and fuse
  ctx.save()
  ctx.rotate(-rad)
  barrel(ctx, pose.recoil)
  ctx.restore()
  ctx.fillStyle = '#2b2e36'
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8c94a3'
  ctx.beginPath()
  ctx.arc(-1.2, -1.2, 2.2, 0, Math.PI * 2)
  ctx.fill()

  // glowing fuse ember that flickers while the cannon is loaded
  if (pose.recoil < 2) {
    ctx.save()
    ctx.rotate(-rad)
    const flick = 0.7 + 0.3 * Math.sin(pose.time * 14) * Math.sin(pose.time * 5.3)
    ctx.strokeStyle = '#3a2d22'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-11, -10.5)
    ctx.quadraticCurveTo(-13, -16, -9, -18)
    ctx.stroke()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = flick
    ctx.drawImage(assets.puffs.glow, -9 - 8, -18 - 8, 16, 16)
    ctx.restore()
  }
  ctx.restore()
}
