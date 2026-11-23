import type { Tower } from '../game/tower'
import { randomTower } from '../game/tower'
import type { Link } from './link'
import { closeMatch, createLocalMatch, type Match } from './match'
import { Peer } from './peer'
import { PROTOCOL_VERSION, type Message } from './protocol'

type Unsubscribe = () => void

/**
 * What the game screen needs from a match, whether the opponent is the computer or a friend's phone.
 * A session outlives single games: a new game (or rematch) swaps in a fresh `me`.
 */
export interface GameSession {
  readonly kind: 'local' | 'remote'
  /** This player's side of the current game. Replaced when a new game starts. */
  readonly me: Peer
  /** False while the connection to the other phone is down. Always true against the computer. */
  readonly connected: boolean
  /** Which phone set the connection up (remote only). Needed to reconnect the same way. */
  readonly role?: 'host' | 'guest'
  /** Development only: look at the enemy tower. Only exists against the computer. */
  readonly debugEnemyTower?: () => Tower
  /** Online: who has asked for a rematch. */
  readonly rematch?: { mine: boolean; theirs: boolean }
  onRematchChange?(handler: () => void): Unsubscribe
  onNewGame(handler: () => void): Unsubscribe
  onConnection(handler: (connected: boolean) => void): Unsubscribe
  /** Against the computer: start again now. Online: ask for a rematch (it starts when both ask). */
  newGame(): void
  /** Online: carry on over a fresh link after the old one dropped. */
  reconnect(link: Link): void
  close(): void
}

class Emitter<A extends unknown[]> {
  private handlers = new Set<(...args: A) => void>()
  on(handler: (...args: A) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => void this.handlers.delete(handler)
  }
  emit(...args: A) {
    this.handlers.forEach((h) => h(...args))
  }
  clear() {
    this.handlers.clear()
  }
}

/** A game against the computer on this device. */
export class LocalSession implements GameSession {
  readonly kind = 'local' as const
  readonly connected = true
  private match: Match = createLocalMatch()
  private newGames = new Emitter<[]>()

  get me(): Peer {
    return this.match.me
  }
  debugEnemyTower = () => this.match.bot.debugTower

  onNewGame(handler: () => void) {
    return this.newGames.on(handler)
  }
  onConnection() {
    return () => {} // it never drops
  }
  newGame() {
    closeMatch(this.match)
    this.match = createLocalMatch()
    this.newGames.emit()
  }
  reconnect() {}
  close() {
    closeMatch(this.match)
    this.newGames.clear()
  }
}

/** Room to wait for the host's first message before giving up. */
const HELLO_TIMEOUT_MS = 10_000

/** A game against a friend's phone over a link (WebRTC in the real game). */
export class RemoteSession implements GameSession {
  readonly kind = 'remote' as const
  /** Settles when the first game is set up. Fails if the other phone speaks a different version. */
  readonly ready: Promise<void>

  private link: Link
  private _me: Peer | null = null
  private _connected = true
  private wantRematch = false
  private peerWantsRematch = false
  private offMessages: Unsubscribe | null = null
  private offClose: Unsubscribe | null = null
  private newGames = new Emitter<[]>()
  private connections = new Emitter<[boolean]>()
  private rematchChanges = new Emitter<[]>()
  private resolveReady!: () => void
  private rejectReady!: (e: Error) => void
  private helloTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    link: Link,
    readonly role: 'host' | 'guest',
  ) {
    this.link = link
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = () => {
        clearTimeout(this.helloTimer)
        resolve()
      }
      this.rejectReady = (e) => {
        clearTimeout(this.helloTimer)
        reject(e)
      }
    })
    this.ready.catch(() => {}) // callers handle it; never leave it "unhandled"
    this.listen(link)
    if (role === 'host') {
      this.beginGame()
      this.resolveReady()
    } else {
      this.helloTimer = setTimeout(() => this.rejectReady(new Error('The host never started the game.')), HELLO_TIMEOUT_MS)
    }
  }

  get me(): Peer {
    if (!this._me) throw new Error('The game has not started yet')
    return this._me
  }
  get connected(): boolean {
    return this._connected
  }
  get rematch() {
    return { mine: this.wantRematch, theirs: this.peerWantsRematch }
  }

  onNewGame(handler: () => void) {
    return this.newGames.on(handler)
  }
  onConnection(handler: (connected: boolean) => void) {
    return this.connections.on(handler)
  }
  onRematchChange(handler: () => void) {
    return this.rematchChanges.on(handler)
  }

  /** Development only: cut the connection, to try out the reconnect flow. */
  debugDropLink() {
    this.link.close()
  }

  private listen(link: Link) {
    this.offMessages = link.onMessage((m) => this.handle(m))
    this.offClose = link.onClose(() => {
      if (link !== this.link) return
      this.setConnected(false)
      if (!this._me) this.rejectReady(new Error('The connection was lost before the game began.'))
    })
  }

  private setConnected(connected: boolean) {
    if (this._connected === connected) return
    this._connected = connected
    this.connections.emit(connected)
  }

  private handle(msg: Message) {
    if (msg.type === 'hello' && this.role === 'guest') {
      if (msg.version !== PROTOCOL_VERSION) {
        this.rejectReady(new Error("Your friend's game is a different version. Both phones need the same version of Tower Siege."))
        return
      }
      this.startGame(msg.youGoFirst)
      this.resolveReady()
    } else if (msg.type === 'rematch') {
      this.peerWantsRematch = true
      this.rematchChanges.emit()
      this.startRematchIfBothWant()
    }
  }

  /** Host only: flip a coin, tell the guest, and start. */
  private beginGame() {
    const hostFirst = Math.random() < 0.5
    this.link.send({ type: 'hello', version: PROTOCOL_VERSION, youGoFirst: !hostFirst })
    this.startGame(hostFirst)
  }

  private startGame(firstTurn: boolean) {
    this._me?.dispose({ keepLink: true })
    this._me = new Peer(this.link, randomTower(), firstTurn)
    this.wantRematch = false
    this.peerWantsRematch = false
    this.rematchChanges.emit()
    this.newGames.emit()
  }

  newGame() {
    this.wantRematch = true
    this.link.send({ type: 'rematch' })
    this.rematchChanges.emit()
    this.startRematchIfBothWant()
  }

  private startRematchIfBothWant() {
    // The host decides who fires first; the guest starts when the host's hello arrives.
    if (this.wantRematch && this.peerWantsRematch && this.role === 'host') this.beginGame()
  }

  reconnect(link: Link) {
    this.offMessages?.()
    this.offClose?.()
    const old = this.link
    this.link = link
    old.close()
    this.listen(link)
    this._me?.attachLink(link) // anything unanswered is sent again; answers already given are replayed
    this.setConnected(true)
    if (this.wantRematch) link.send({ type: 'rematch' })
  }

  close() {
    this.offMessages?.()
    this.offClose?.()
    clearTimeout(this.helloTimer)
    this._me?.dispose({ keepLink: true })
    this.link.close()
    this.newGames.clear()
    this.connections.clear()
    this.rematchChanges.clear()
  }
}
