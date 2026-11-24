import { Defender, validateShotInput, type Resolution } from '../game/defender'
import type { ShotInput } from '../game/physics'
import type { Tower } from '../game/tower'
import { AttackerSession } from './attackerSession'
import type { Link } from './link'
import type { Message, ResultMessage } from './protocol'

export interface IncomingShot {
  input: ShotInput
  /** Full details of what the shot did to this peer's own tower. For the local screen only. */
  resolution: Resolution
}

export type Outcome = 'won' | 'lost' | null

/** How many answers to remember, so a shot sent twice is only ever applied once. */
const REPLY_CACHE = 8

/**
 * One player's side of a match, as it runs on that player's own phone:
 * it owns the tower, resolves incoming shots, fires at the opponent and
 * enforces turn order. The opponent's tower is never known here.
 *
 * The connection can drop and be replaced (`attachLink`) without losing the game.
 */
export class Peer {
  readonly defender: Defender
  private session: AttackerSession
  private link: Link | null = null
  private offMessages: (() => void) | null = null
  private offClose: (() => void) | null = null
  private incomingHandlers = new Set<(s: IncomingShot) => void>()
  private turnHandlers = new Set<() => void>()
  private connectionHandlers = new Set<(connected: boolean) => void>()
  /** Shots that arrived while nobody was listening yet: replayed to the first listener. */
  private backlog: IncomingShot[] = []
  private replies = new Map<number, ResultMessage>()
  private _connected = false
  private _myTurn: boolean
  private _over: Outcome = null

  constructor(link: Link, tower: Tower, firstTurn: boolean, timeoutMs?: number) {
    this.defender = new Defender(tower)
    this._myTurn = firstTurn
    // A shot that goes unanswered on a link that still looks alive means the link is broken.
    this.session = new AttackerSession(null, timeoutMs, () => this.markLost())
    this.attachLink(link)
  }

  /** This player's own tower (they can see it, of course). */
  get tower(): Tower {
    return this.defender.tower
  }
  get myTurn(): boolean {
    return this._myTurn
  }
  get over(): Outcome {
    return this._over
  }
  get connected(): boolean {
    return this._connected
  }

  /** Start using a (new) link. Anything still unanswered is sent again. */
  attachLink(link: Link) {
    this.detach()
    this.link = link
    this.offMessages = link.onMessage((m) => this.handle(m))
    this.offClose = link.onClose(() => this.markLost())
    this.session.attach(link)
    this.setConnected(true)
  }

  private detach() {
    this.offMessages?.()
    this.offClose?.()
    this.offMessages = this.offClose = null
  }

  private markLost() {
    if (!this._connected) return
    const dead = this.link
    this.detach()
    this.link = null
    this.session.attach(null) // keeps any unanswered shot, to send again later
    this.setConnected(false)
    dead?.close() // make sure a link that merely went silent is really released
  }

  private setConnected(connected: boolean) {
    this._connected = connected
    this.connectionHandlers.forEach((h) => h(connected))
  }

  async fire(angle: number, power: number): Promise<ResultMessage> {
    if (this._over) throw new Error('The game is over')
    if (!this._myTurn) throw new Error('It is not your turn')
    if (!this._connected) throw new Error('Connection lost')
    this._myTurn = false
    try {
      const reply = await this.session.fire(angle, power)
      if (reply.towerDown) this._over = 'won'
      return reply
    } catch (err) {
      // A shot that was refused (or could not be sent) did not use up the turn.
      if (err instanceof Error && !/closed/.test(err.message)) this._myTurn = true
      throw err
    }
  }

  /** Called whenever the opponent fires at us. Returns an unsubscribe function. */
  onIncoming(handler: (s: IncomingShot) => void): () => void {
    this.incomingHandlers.add(handler)
    const waiting = this.backlog
    this.backlog = []
    waiting.forEach(handler)
    return () => void this.incomingHandlers.delete(handler)
  }

  /** Called when it becomes our turn to fire (and the game is not over). */
  onTurn(handler: () => void): () => void {
    this.turnHandlers.add(handler)
    return () => void this.turnHandlers.delete(handler)
  }

  /** Called when the connection is lost or comes back. */
  onConnection(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler)
    return () => void this.connectionHandlers.delete(handler)
  }

  private handle(msg: Message) {
    if (msg.type !== 'fire') return
    const link = this.link
    if (!link) return
    const reject = (reason: string) => link.send({ type: 'rejected', id: msg.id, reason })

    // The same shot sent again (after a reconnect): replay our answer, never apply it twice.
    const earlier = this.replies.get(msg.id)
    if (earlier) {
      link.send(earlier)
      return
    }

    const input = validateShotInput(msg.angle, msg.power)
    if (!input) return reject('illegal angle or power')
    if (this._over) return reject('the game is over')
    if (this._myTurn) return reject('it is not your turn to fire')

    const before = this.defender.tower
    const resolution = this.defender.handleFire(input)
    const reply: ResultMessage = { type: 'result', id: msg.id, feedback: resolution.feedback, reveal: before, towerDown: resolution.towerDown }
    this.replies.set(msg.id, reply)
    if (this.replies.size > REPLY_CACHE) this.replies.delete(this.replies.keys().next().value!)
    link.send(reply)

    if (resolution.towerDown) this._over = 'lost'
    else this._myTurn = true

    const shot: IncomingShot = { input, resolution }
    if (this.incomingHandlers.size === 0) this.backlog.push(shot)
    else this.incomingHandlers.forEach((h) => h(shot))
    if (!this._over) this.turnHandlers.forEach((h) => h())
  }

  /** Stop this peer. Pass `keepLink` to leave the connection open for a following game. */
  dispose({ keepLink = false }: { keepLink?: boolean } = {}) {
    this.detach()
    this.incomingHandlers.clear()
    this.turnHandlers.clear()
    this.connectionHandlers.clear()
    this.session.dispose({ closeLink: false })
    if (!keepLink) this.link?.close()
    this.link = null
    this._connected = false
  }
}
