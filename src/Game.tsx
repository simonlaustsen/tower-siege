import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameCanvas, type ActiveShot } from './GameCanvas'
import RangeFinder from './RangeFinder'
import {
  MAX_ANGLE,
  MAX_POWER,
  MIN_ANGLE,
  MIN_POWER,
  WORLD_W,
} from './game/constants'
import { previewFlight } from './game/attackerView'
import '@fontsource/lilita-one/latin-400.css'
import type { Feedback, FeedbackKind } from './game/feedback'
import { shoutFor, type Shout } from './game/shout'
import { simulateShot } from './game/physics'
import { otherTeam, TEAMS, type Team } from './game/teams'
import { flightOf, initialEstimate, landingX, narrow, resultOf, type Flight } from './game/rangeFinder'
import { createTower, totalMaxHp, type Tower } from './game/tower'
import type { GameSession } from './net/session'
import { enemyPlacement, inwardMapX, mapPath, MY_PLACEMENT, outwardMapX } from './render/placement'
import type { IncomingShot } from './net/peer'
import type { ResultMessage } from './net/protocol'

/**
 * The turn cycle, as seen on this phone:
 *   aim -> shooting -> result -> enemy-turn -> incoming -> enemy-result -> aim ...
 * and 'over' once either tower has collapsed.
 */
type Phase = 'aim' | 'shooting' | 'result' | 'enemy-turn' | 'incoming' | 'enemy-result' | 'over'

const RESULT_MS = 1600 // how long your shot's feedback stays up before the enemy's turn begins
const ENEMY_RESULT_MS = 1600 // how long the enemy shot's outcome stays up before your turn
const IDLE_NUDGE_MS = 3000 // how long you may sit on your turn without touching anything before the game shows how to pull the slingshot
const SHOUT_MS = 1500 // how long the big callout over the battlefield stays up

interface HistoryEntry {
  n: number
  angle: number
  power: number
  feedback: Feedback
  /** How the shot flew over open ground, for the range finder. */
  flight: Flight
}

/** My shot between "fired" and "settled": it settles once the animation AND the reply are both in. */
interface InFlight {
  id: number
  angle: number
  power: number
  active: ActiveShot
  animationDone: boolean
  reply: ResultMessage | null
}

interface GameProps {
  session: GameSession
  /** Back to the menu. */
  onLeave: () => void
  /** Online: set up a fresh connection after the old one dropped. */
  onReconnect: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A ball that has flown this far past the enemy's side is out of the picture: its flight ends there. */
const WORLD_END_X = WORLD_W + 60

/**
 * Completes the flight of a shot that was waiting for the defender's reply. The snapshot of their tower in it
 * lets this phone replay the whole shot (the physics is deterministic) and show it with full effects.
 */
function revealFlight(active: ActiveShot, tower: Tower, input: { angle: number; power: number }) {
  const result = simulateShot(tower, input)
  const path = mapPath(result.path, outwardMapX)
  const end = path.findIndex((p) => p.x > WORLD_END_X)
  active.path = end < 0 ? path : path.slice(0, end + 1)
  active.detail = { result, towerBefore: tower, placement: enemyPlacement(tower), mapX: outwardMapX }
  active.groundLanding = false
  active.reveal = true
  active.open = false
}

function Stepper(props: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  const { label, unit, value, min, max, disabled, onChange } = props
  return (
    <div className="stepper">
      <div className="stepper-head">
        <span className="stepper-label">{label}</span>
        <span className="stepper-value">
          {value}
          {unit}
        </span>
      </div>
      <div className="stepper-row">
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(value - 1, min, max))} aria-label={`${label} down`}>
          −
        </button>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(value + 1, min, max))} aria-label={`${label} up`}>
          +
        </button>
      </div>
    </div>
  )
}

/** How intact a tower is: the share of its hit points left, 0..1. */
interface Integrity {
  hp: number
}

const integrityOf = (tower: Tower): Integrity => ({
  hp: tower.hp.flat().reduce((s, v) => s + v, 0) / Math.max(1, totalMaxHp(tower)),
})

/** Every tower starts whole, so this is what you know of the enemy's before your first shot lands. */
const FULL_INTEGRITY: Integrity = { hp: 1 }

/** On the final blow the bar first takes the hit, then (after this many ms) runs all the way down to empty. */
const FINAL_DRAIN_DELAY_MS = 750
/** How long (ms) after the game ends the Victory / Defeat card waits, so the bar's last stand is seen. */
const END_CARD_DELAY_MS = 2300

/** Bar colour: green when whole, through yellow, to red when nearly gone. */
const healthColor = (hp: number) => `hsl(${Math.round(Math.max(0, Math.min(1, hp)) * 120)} 78% 46%)`

/**
 * Tower health, as a small chip over the battlefield. A hit knocks the bar down in one jolt with a white flash and
 * shakes the chip, harder the bigger the hit.
 * When `final`, the tower has fallen and the bar runs down to nothing.
 */
function IntegrityChip(props: { side: 'mine' | 'enemy'; label: string; team: Team; integrity: Integrity; final: boolean }) {
  const { side, label, team, integrity, final } = props
  const [drained, setDrained] = useState(false)
  useEffect(() => {
    setDrained(false)
    if (!final) return
    const id = setTimeout(() => setDrained(true), FINAL_DRAIN_DELAY_MS)
    return () => clearTimeout(id)
  }, [final])

  const hp = final && drained ? 0 : integrity.hp
  const chip = useRef<HTMLDivElement>(null)
  const previous = useRef(hp)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    const before = previous.current
    previous.current = hp
    if (hp >= before) return
    setFlash((n) => n + 1)
    const reach = Math.min(9, 3 + (before - hp) * 60)
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      chip.current?.animate(
        [0, -1, 0.8, -0.6, 0.4, -0.2, 0].map((k) => ({ transform: `translate(${k * reach}px, ${Math.abs(k) * reach * 0.3}px)` })),
        { duration: 460, easing: 'ease-out' },
      )
    }
  }, [hp])

  return (
    <div
      ref={chip}
      className={`integrity ${side}`}
      title={`${label} tower integrity`}
      style={{ background: `rgba(${TEAMS[team].rgb},0.62)`, borderColor: TEAMS[team].light }}
    >
      <span>{label}</span>
      <div className="bar" data-final={final}>
        <div className="bar-fill" style={{ width: `${hp * 100}%`, background: healthColor(hp) }}>
          {flash > 0 && <div key={flash} className="bar-flash" />}
        </div>
      </div>
    </div>
  )
}

/** The first-turn phase for a fresh game: aim if you go first, otherwise wait for the enemy's shot. */
const openingPhase = (session: GameSession): Phase => (session.me.myTurn ? 'aim' : 'enemy-turn')

/** Stand-in for the enemy tower on screens that can never show it (online games). */
const UNKNOWN_TOWER = createTower(0)

export default function Game({ session, onLeave, onReconnect }: GameProps) {
  // The opponent lives behind a link. This screen talks to `session.me` only; the enemy
  // tower is never read except in the dev-only "peek" mode against the computer.
  const [me, setMe] = useState(() => session.me)
  const [gameId, setGameId] = useState(0)
  const [phase, setPhaseState] = useState<Phase>(() => openingPhase(session))
  const [connected, setConnected] = useState(() => session.connected)
  const [rematch, setRematch] = useState(() => session.rematch ?? { mine: false, theirs: false })
  const [angle, setAngle] = useState(45)
  const [power, setPower] = useState(70)
  // Has an aim been set this turn? Until then the slingshot rests at its fork.
  const [aimed, setAimed] = useState(false)
  // Your turn has gone by with no interaction: nudge the player to pull the slingshot.
  const [idle, setIdle] = useState(false)
  const [peek, setPeek] = useState(false)
  const [peekTower, setPeekTower] = useState<Tower>(() => session.debugEnemyTower?.() ?? UNKNOWN_TOWER)
  // What the enemy's phone has told this one about its tower: updated after every shot of mine, from their reply.
  const [enemyIntegrity, setEnemyIntegrity] = useState<Integrity>(FULL_INTEGRITY)
  const [myTower, setMyTowerState] = useState<Tower>(() => session.me.tower)
  const [shot, setShot] = useState<ActiveShot | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [shout, setShout] = useState<(Shout & { id: number; whose: 'mine' | 'enemy' }) | null>(null)
  const [enemyFeedback, setEnemyFeedback] = useState<Feedback | null>(null)
  const [enemyShots, setEnemyShots] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [outcome, setOutcome] = useState<'won' | 'lost' | null>(null)
  // The Victory / Defeat card comes up a moment after the game ends, once the losing bar has run down.
  const [cardShown, setCardShown] = useState(false)

  // Refs mirror state that event handlers need to read synchronously.
  const phaseRef = useRef<Phase>(phase)
  const myTowerRef = useRef<Tower>(myTower)
  const nextId = useRef(1)
  const inFlight = useRef<InFlight | null>(null)
  const incomingQueue = useRef<IncomingShot[]>([])
  const incomingNow = useRef<{ id: number; shot: IncomingShot } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const go = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])
  /** A few big words over the battlefield: what the shot just did. */
  const shoutId = useRef(0)
  const showShout = useCallback(
    (kind: FeedbackKind, whose: 'mine' | 'enemy') => {
      const id = ++shoutId.current
      setShout({ id, whose, ...shoutFor(kind, whose) })
      later(() => setShout((s) => (s?.id === id ? null : s)), SHOUT_MS)
    },
    [later],
  )
  const setMyTower = useCallback((t: Tower) => {
    myTowerRef.current = t
    setMyTowerState(t)
  }, [])

  const canAct = phase === 'aim' && connected

  // Everything to do with a fresh game: a rematch online, or "new game" against the computer.
  const startFresh = useCallback(
    (next: typeof me) => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      inFlight.current = null
      incomingNow.current = null
      incomingQueue.current = []
      setMe(next)
      setMyTower(next.tower)
      setPeekTower(session.debugEnemyTower?.() ?? UNKNOWN_TOWER)
      setGameId((g) => g + 1)
      setShot(null)
      setWaiting(false)
      setEnemyIntegrity(FULL_INTEGRITY)
      setFeedback(null)
      setShout(null)
      setEnemyFeedback(null)
      setEnemyShots(0)
      setError(null)
      setHistory([])
      setOutcome(null)
      go(next.myTurn ? 'aim' : 'enemy-turn')
    },
    [session, go, setMyTower],
  )

  useEffect(() => {
    setCardShown(false)
    if (!outcome) return
    const id = setTimeout(() => setCardShown(true), END_CARD_DELAY_MS)
    return () => clearTimeout(id)
  }, [outcome])

  useEffect(() => session.onConnection(setConnected), [session])
  useEffect(() => session.onNewGame(() => startFresh(session.me)), [session, startFresh])
  useEffect(() => session.onRematchChange?.(() => setRematch({ ...session.rematch! })), [session])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Any interaction (a pull, a stepper, a key) sets `aimed`, which resets the wait; so does a new turn.
  useEffect(() => {
    setIdle(false)
    if (!canAct || aimed) return
    const id = setTimeout(() => setIdle(true), IDLE_NUDGE_MS)
    return () => clearTimeout(id)
  }, [canAct, aimed])

  // ---- the enemy's turn: animate their shot against my tower ----

  const startIncomingIfReady = useCallback(() => {
    if (phaseRef.current !== 'enemy-turn') return
    const next = incomingQueue.current.shift()
    if (!next) return
    const id = nextId.current++
    const { result } = next.resolution
    // The enemy's flight is drawn flipped: in from the right, onto your tower's right side.
    const tower = myTowerRef.current
    const mapX = inwardMapX(tower)
    const active: ActiveShot = {
      id,
      dir: 'in',
      path: mapPath(result.path, mapX),
      groundLanding: false,
      detail: { result, towerBefore: tower, placement: MY_PLACEMENT, mapX },
    }
    incomingNow.current = { id, shot: next }
    go('incoming')
    setShot(active)
  }, [go])

  useEffect(
    () =>
      me.onIncoming((s) => {
        incomingQueue.current.push(s)
        startIncomingIfReady()
      }),
    [me, startIncomingIfReady],
  )

  // ---- my turn ----

  /** Show the outcome once both the animation and the defender's reply have arrived. */
  const settle = useCallback(() => {
    const p = inFlight.current
    if (!p || !p.animationDone || !p.reply) return
    inFlight.current = null
    const { feedback: fb, towerDown } = p.reply
    // The defender's tower after this shot: their snapshot, run through the same deterministic physics they used.
    setEnemyIntegrity(integrityOf(simulateShot(p.reply.reveal, { angle: p.angle, power: p.power }).towerAfter))
    setShot(null)
    setWaiting(false)
    setFeedback(fb)
    showShout(fb.kind, 'mine')
    setHistory((h) => [
      { n: h.length + 1, angle: p.angle, power: p.power, feedback: fb, flight: flightOf({ angle: p.angle, power: p.power }) },
      ...h,
    ])
    if (towerDown) {
      setOutcome('won')
      go('over')
      return
    }
    go('result')
    later(() => {
      go('enemy-turn')
      startIncomingIfReady()
    }, RESULT_MS)
  }, [go, later, showShout, startIncomingIfReady])

  /** Fires the aim set on screen, or `aim` when the slingshot is let go (state may not have caught up with the last drag yet). */
  const fire = useCallback((aim?: { angle: number; power: number }) => {
    if (phaseRef.current !== 'aim') return
    const id = nextId.current++
    const input = aim ?? { angle, power }
    setAimed(false)

    // What this screen is allowed to animate. In peek mode (dev only) it is the real
    // outcome against the real tower; otherwise only the flight up to the edge of the screen.
    let active: ActiveShot
    if (peek) {
      const result = simulateShot(peekTower, input)
      active = {
        id,
        dir: 'out',
        path: mapPath(result.path, outwardMapX),
        groundLanding: false,
        detail: { result, towerBefore: peekTower, placement: enemyPlacement(peekTower), mapX: outwardMapX },
      }
    } else {
      const flight = previewFlight(input)
      // Up to the fog the flight is the same whatever the enemy tower looks like. Past it, the ball waits for the
      // defender's reply, which brings the snapshot the rest of the flight is replayed from.
      active = {
        id,
        dir: 'out',
        path: mapPath(flight.path, outwardMapX),
        groundLanding: flight.landsInView,
        detail: null,
        open: !flight.landsInView,
      }
    }

    const pending: InFlight = { id, angle: input.angle, power: input.power, active, animationDone: false, reply: null }
    inFlight.current = pending
    setError(null)
    setFeedback(null)
    go('shooting')
    setShot(active)

    me.fire(input.angle, input.power)
      .then((reply) => {
        if (inFlight.current !== pending) return // new game started meanwhile
        pending.reply = reply
        if (active.open) revealFlight(active, reply.reveal, input)
        settle()
      })
      .catch((err: Error) => {
        if (inFlight.current !== pending) return
        inFlight.current = null
        active.open = false
        setShot(null)
        setWaiting(false)
        setError(err.message)
        go('aim')
      })
  }, [angle, power, peek, peekTower, me, settle, go])

  // ---- animation finished (either kind of shot) ----

  const onShotEnd = useCallback(
    (id: number) => {
      const mine = inFlight.current
      if (mine && mine.id === id) {
        mine.animationDone = true
        if (mine.active.detail && !mine.active.reveal) setPeekTower(mine.active.detail.result.towerAfter)
        if (!mine.reply) setWaiting(true)
        settle()
        return
      }
      const incoming = incomingNow.current
      if (incoming && incoming.id === id) {
        incomingNow.current = null
        const { resolution } = incoming.shot
        setMyTower(resolution.result.towerAfter)
        setShot(null)
        setEnemyFeedback(resolution.feedback)
        showShout(resolution.feedback.kind, 'enemy')
        setEnemyShots((n) => n + 1)
        if (resolution.towerDown) {
          setOutcome('lost')
          go('over')
          return
        }
        go('enemy-result')
        later(() => go('aim'), ENEMY_RESULT_MS)
      }
    },
    [settle, go, later, showShout, setMyTower],
  )

  /** "New game" against the computer starts at once; online it asks for a rematch. */
  const playAgain = () => session.newGame()

  const leave = () => {
    const midGame = session.kind === 'remote' && outcome === null
    if (midGame && !window.confirm('Leave this game? Your opponent will be disconnected.')) return
    onLeave()
  }

  // Keyboard: arrows aim, space/enter fires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') return
      if (e.key === 'ArrowLeft') (setAimed(true), setAngle((v) => clamp(v + 1, MIN_ANGLE, MAX_ANGLE)))
      else if (e.key === 'ArrowRight') (setAimed(true), setAngle((v) => clamp(v - 1, MIN_ANGLE, MAX_ANGLE)))
      else if (e.key === 'ArrowUp') (setAimed(true), setPower((v) => clamp(v + 1, MIN_POWER, MAX_POWER)))
      else if (e.key === 'ArrowDown') (setAimed(true), setPower((v) => clamp(v - 1, MIN_POWER, MAX_POWER)))
      else if (e.key === ' ' || e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        if (aimed) fire()
      } else return
      if (e.key.startsWith('Arrow')) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fire, aimed])

  // ---- what to show ----

  // Where the enemy tower can be, from the rules and what each shot earned: never from the tower itself.
  const estimate = useMemo(
    () => history.reduce((e, h) => narrow(e, h.flight, h.feedback.kind), initialEstimate()),
    [history],
  )
  // Whose turn it is, shown as a halo around the battlefield in that team's colour (the same on both phones).
  // When the game ends it settles on the winner's colour.
  const myTeam = session.team
  const enemyTeam = otherTeam(myTeam)
  const myTurn = phase === 'aim' || phase === 'shooting' || phase === 'result'
  const turnTeam: Team | undefined = !connected ? undefined : outcome ? (outcome === 'won' ? myTeam : enemyTeam) : myTurn ? myTeam : enemyTeam
  const aimLanding = useMemo(() => landingX({ angle, power }), [angle, power])

  let banner: { tone: string; title?: string; text?: string }
  if (error) banner = { tone: 'big', title: 'Connection problem', text: error }
  else if (phase === 'aim') {
    banner = {
      tone: 'idle',
      title: 'Your turn',
      text: history[0] ? `Last shot: ${shoutFor(history[0].feedback.kind, 'mine').text}` : 'Pull back the slingshot and let go!',
    }
  } else if (phase === 'shooting') banner = { tone: 'idle', title: waiting ? 'Waiting for the other phone…' : 'Shot away…' }
  else if (phase === 'result' && feedback) banner = { tone: feedback.tone, title: feedback.hint }
  else if (phase === 'enemy-turn') banner = { tone: 'idle', title: 'Enemy is aiming…', text: 'Brace yourself.' }
  else if (phase === 'incoming') banner = { tone: 'idle', title: 'Incoming!' }
  else if (phase === 'enemy-result' && enemyFeedback) {
    banner = { tone: enemyFeedback.tone, title: `Enemy: ${enemyFeedback.title}`, text: 'Your turn next.' }
  } else banner = { tone: 'idle' }

  return (
    <div className="app">
      <header className="top">
        <h1>Tower Siege</h1>
        <div className="top-actions">
          {session.debugEnemyTower && (
            <label className="toggle" title="Developer view: reveals the enemy tower, which a real opponent's phone never would">
              <input
                type="checkbox"
                checked={peek}
                disabled={!canAct}
                onChange={(e) => {
                  // Re-read the true tower: it kept taking damage while nobody was peeking.
                  if (e.target.checked) setPeekTower(session.debugEnemyTower!())
                  setPeek(e.target.checked)
                }}
              />
              <span>Peek (dev)</span>
            </label>
          )}
          {session.kind === 'local' && (
            <button type="button" className="ghost" onClick={playAgain}>
              New game
            </button>
          )}
          <button type="button" className="ghost" onClick={leave}>
            {session.kind === 'remote' ? 'Leave' : 'Menu'}
          </button>
        </div>
      </header>

      <div className="field" data-wide={peek}>
      <div className="stage-frame">
      <div className="stage">
        <GameCanvas
          key={gameId}
          myTower={myTower}
          enemyTower={peek ? peekTower : null}
          angle={angle}
          power={power}
          canAim={canAct}
          aimed={aimed}
          nudge={idle}
          onAim={(a, p) => {
            setAngle(a)
            setPower(p)
            setAimed(true)
          }}
          onRelease={(aim) => (aim ? fire(aim) : setAimed(false))}
          myTeam={myTeam}
          enemyTeam={enemyTeam}
          shot={shot}
          onShotEnd={onShotEnd}
        />
        <IntegrityChip side="mine" label={`${TEAMS[myTeam].name} · you`} team={myTeam} integrity={integrityOf(myTower)} final={outcome === 'lost'} />
        <IntegrityChip side="enemy" label={TEAMS[enemyTeam].name} team={enemyTeam} integrity={peek ? integrityOf(peekTower) : enemyIntegrity} final={outcome === 'won'} />
        <div className={`banner ${banner.tone}`} role="status" aria-live="polite">
          {banner.title && <strong>{banner.title}</strong>}
          {banner.text && <span>{banner.text}</span>}
        </div>
        {shout && !outcome && (
          <div
            key={shout.id}
            className={`shout ${shout.whose} ${shout.tone}`}
            style={{ '--shout-color': TEAMS[enemyTeam].light, animationDuration: `${SHOUT_MS}ms` } as React.CSSProperties}
            aria-hidden="true"
          >
            {shout.text}
          </div>
        )}
        {outcome && cardShown && (
          <div className="overlay">
            <div className="card">
              <h2>{outcome === 'won' ? 'Victory!' : 'Defeat'}</h2>
              <p>
                {outcome === 'won' ? (
                  <>
                    You brought down the enemy tower in <b>{history.length}</b> {history.length === 1 ? 'shot' : 'shots'}.
                  </>
                ) : (
                  <>
                    Your tower fell after <b>{enemyShots}</b> enemy {enemyShots === 1 ? 'shot' : 'shots'}.
                    {' '}You fired <b>{history.length}</b>.
                  </>
                )}
              </p>
              {session.kind === 'local' ? (
                <button type="button" className="fire" onClick={playAgain}>
                  Play again
                </button>
              ) : (
                <>
                  <button type="button" className="fire" onClick={playAgain} disabled={rematch.mine}>
                    {rematch.mine ? 'Waiting for your opponent…' : rematch.theirs ? 'Accept rematch' : 'Rematch'}
                  </button>
                  {rematch.theirs && !rematch.mine && <p className="hint">Your opponent wants a rematch.</p>}
                  <button type="button" className="ghost wide" onClick={onLeave}>
                    Leave
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {session.kind === 'remote' && !connected && (
          <div className="overlay">
            <div className="card">
              <h2>Connection lost</h2>
              <p>The other phone dropped out. Your game is safe: reconnect and carry on exactly where you left off.</p>
              <button type="button" className="fire" onClick={onReconnect}>
                Reconnect
              </button>
              <button type="button" className="ghost wide" onClick={onLeave}>
                Leave game
              </button>
            </div>
          </div>
        )}
      </div>
      {/* The halo is its own element, outside the clipped stage. A new key per team replays its wash animation. */}
      {turnTeam && <div key={turnTeam} className="halo" data-turn={turnTeam} data-pulse={outcome === null} aria-hidden="true" />}
      </div>
      {!peek && (
        <RangeFinder
          estimate={estimate}
          shots={[...history].reverse().map((h) => ({ n: h.n, angle: h.angle, power: h.power, landing: h.flight.landing, result: resultOf(h.feedback.kind) }))}
          aim={aimLanding}
          active={canAct && aimed}
          enemy={enemyTeam}
        />
      )}
      </div>

      <section className="controls" data-active={canAct}>
        <Stepper label="Angle" unit="°" value={angle} min={MIN_ANGLE} max={MAX_ANGLE} disabled={!canAct} onChange={(v) => (setAimed(true), setAngle(v))} />
        <Stepper label="Power" unit="%" value={power} min={MIN_POWER} max={MAX_POWER} disabled={!canAct} onChange={(v) => (setAimed(true), setPower(v))} />
        <button type="button" className="fire" disabled={!canAct || !aimed} onClick={() => fire()}>
          {canAct ? 'FIRE!' : phase === 'shooting' ? 'Firing…' : phase === 'over' ? 'Game over' : 'Enemy turn…'}
        </button>
      </section>
    </div>
  )
}
