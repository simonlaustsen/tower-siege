import { ShotPlanner } from '../game/botStrategy'
import type { Tower } from '../game/tower'
import type { Link } from './link'
import { Peer } from './peer'

export interface BotOptions {
  /** Random pause before each shot, in ms: [min, max]. Use [0, 0] in tests. */
  thinkMs?: [number, number]
  random?: () => number
}

/**
 * A computer opponent. It is just another peer at the far end of a link:
 * it owns a hidden tower and learns only from the feedback its shots get.
 */
export class Bot {
  readonly peer: Peer
  private planner: ShotPlanner
  private offTurn: () => void
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    link: Link,
    tower: Tower,
    firstTurn: boolean,
    private options: BotOptions = {},
  ) {
    const random = options.random ?? Math.random
    this.peer = new Peer(link, tower, firstTurn)
    this.planner = new ShotPlanner(random)
    this.offTurn = this.peer.onTurn(() => this.schedule())
    if (firstTurn) this.schedule()
  }

  /** Development only ("peek"). A real opponent could never be inspected like this. */
  get debugTower(): Tower {
    return this.peer.tower
  }

  private schedule() {
    const [min, max] = this.options.thinkMs ?? [1200, 2600]
    const random = this.options.random ?? Math.random
    this.timer = setTimeout(() => void this.takeShot(), min + random() * (max - min))
  }

  private async takeShot() {
    if (this.disposed || this.peer.over || !this.peer.myTurn) return
    const { angle, power } = this.planner.next()
    try {
      const reply = await this.peer.fire(angle, power)
      this.planner.learn(reply.feedback.kind)
    } catch {
      // Connection problems: stay quiet; the human sees them on their own side.
    }
  }

  dispose() {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.offTurn()
    this.peer.dispose()
  }
}
