import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameCanvas, type ActiveShot } from './GameCanvas'
import RangeFinder from './RangeFinder'
import {
  MAX_ANGLE,
  MAX_POWER,
  MIN_ANGLE,
  MIN_POWER,
} from './game/constants'
import { previewFlight } from './game/attackerView'
import '@fontsource/lilita-one/latin-400.css'
import type { Feedback, FeedbackKind } from './game/feedback'
import { shoutFor, type Shout } from './game/shout'
import { simulateShot } from './game/physics'
import { otherTeam, TEAMS, type Team } from './game/teams'
import { flightOf, initialEstimate, landingX, narrow, resultOf, type Flight } from './game/rangeFinder'
import { countBlocks, createTower, initialBlocks, totalMaxHp, type Tower } from './game/tower'
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

/** Tower health, as a small chip over the battlefield. The enemy's is a secret unless peeking. */
function IntegrityChip(props: { side: 'mine' | 'enemy'; label: string; team: Team; tower: Tower; hidden?: boolean }) {
  const { side, label, team, tower, hidden = false } = props
  const hpLeft = tower.hp.flat().reduce((s, v) => s + v, 0)
  const percent = Math.round((countBlocks(tower) / Math.max(1, initialBlocks(tower))) * 100)
  return (
    <div
      className={`integrity ${side}`}
      title={`${label} tower integrity`}
      style={{ background: `rgba(${TEAMS[team].rgb},0.62)`, borderColor: TEAMS[team].light }}
    >
      <span>{label}</span>
      <div className="bar">
        <div
          className="bar-fill"
          style={{ width: hidden ? '100%' : `${(hpLeft / Math.max(1, totalMaxHp(tower))) * 100}%` }}
          data-hidden={hidden}
        />
      </div>
      <span className="integrity-num">{hidden ? '???' : `${percent}%`}</span>
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
  const [peek, setPeek] = useState(false)
  const [peekTower, setPeekTower] = useState<Tower>(() => session.debugEnemyTower?.() ?? UNKNOWN_TOWER)
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

  useEffect(() => session.onConnection(setConnected), [session])
  useEffect(() => session.onNewGame(() => startFresh(session.me)), [session, startFresh])
  useEffect(() => session.onRematchChange?.(() => setRematch({ ...session.rematch! })), [session])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

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
      active = { id, dir: 'out', path: mapPath(flight.path, outwardMapX), groundLanding: flight.landsInView, detail: null }
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
        settle()
      })
      .catch((err: Error) => {
        if (inFlight.current !== pending) return
        inFlight.current = null
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
        if (mine.active.detail) setPeekTower(mine.active.detail.result.towerAfter)
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
        <IntegrityChip side="mine" label={`${TEAMS[myTeam].name} · you`} team={myTeam} tower={myTower} />
        <IntegrityChip side="enemy" label={TEAMS[enemyTeam].name} team={enemyTeam} tower={peekTower} hidden={!peek} />
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
        {outcome && (
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
