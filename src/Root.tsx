import { useCallback, useEffect, useRef, useState } from 'react'
import AnswerLanding from './AnswerLanding'
import Game from './Game'
import type { Link } from './net/link'
import { LocalSession, RemoteSession, type GameSession } from './net/session'
import { parseLinkHash } from './net/shareLink'
import Pairing from './Pairing'

type Role = 'host' | 'guest'

type Screen =
  | { name: 'menu' }
  | { name: 'pair'; role: Role; offer?: string }
  | { name: 'answer'; code: string }
  | { name: 'starting'; session: RemoteSession }
  | { name: 'game'; session: GameSession }

/**
 * Where to start. A phone that scanned the host's QR code with its camera app arrives here with the
 * host's code in the link (`#join=…`) and goes straight to joining; a scanned answer code
 * (`#answer=…`) gets its own explanatory page.
 */
function screenForHash(hash: string): Screen | null {
  const link = parseLinkHash(hash)
  if (link?.kind === 'join') return { name: 'pair', role: 'guest', offer: link.code }
  if (link?.kind === 'answer') return { name: 'answer', code: link.code }
  return null
}

const startScreen = (): Screen => screenForHash(location.hash) ?? { name: 'menu' }

/** Menu, pairing and game. The session outlives single games (and, online, a dropped connection). */
export default function Root() {
  const [screen, setScreen] = useState<Screen>(startScreen)
  const [notice, setNotice] = useState<string | null>(null)
  /** Online only: the connection dropped and a new one is being set up over the top of the game. */
  const [reconnecting, setReconnecting] = useState(false)
  const current = useRef<GameSession | null>(null)

  const show = useCallback((next: Screen) => {
    current.current = next.name === 'game' || next.name === 'starting' ? next.session : null
    setScreen(next)
  }, [])

  const toMenu = useCallback(
    (message: string | null = null) => {
      current.current?.close()
      setReconnecting(false)
      setNotice(message)
      show({ name: 'menu' })
    },
    [show],
  )

  const playComputer = () => {
    setNotice(null)
    show({ name: 'game', session: new LocalSession() })
  }

  const startPairing = (role: Role) => {
    setNotice(null)
    show({ name: 'pair', role })
  }

  /** A connection is open: set the game up on top of it. */
  const linked = useCallback(
    (link: Link, role: Role) => {
      const session = new RemoteSession(link, role)
      show({ name: 'starting', session })
      session.ready.then(
        () => show({ name: 'game', session }),
        (err: Error) => {
          session.close()
          toMenu(err.message)
        },
      )
    },
    [show, toMenu],
  )

  // The link has done its job: take the code out of the address bar, so reloading starts clean.
  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search)
  }, [])

  // A link can also arrive while the app is already open (the address changes without a reload).
  // Act on it, except in the middle of an online game, which a stray link must not interrupt.
  useEffect(() => {
    const onHashChange = () => {
      const next = screenForHash(location.hash)
      if (!next) return
      history.replaceState(null, '', location.pathname + location.search)
      if (current.current?.kind === 'remote') return
      current.current?.close()
      setReconnecting(false)
      setNotice(null)
      show(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [show])

  // Development aid: lets a test (or you, in the console) cut the connection to try the reconnect flow.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __towerSiege?: unknown }
    w.__towerSiege = {
      drop: () => (current.current instanceof RemoteSession ? current.current.debugDropLink() : undefined),
      session: current.current,
    }
  }, [screen])

  const session = screen.name === 'game' ? screen.session : null

  return (
    <>
      {screen.name === 'menu' && (
        <main className="screen menu">
          <h1 className="logo">Tower Siege</h1>
          <p className="tagline">
            Fire blind at a hidden wooden tower. Yours stands on your phone and theirs on theirs, so all you get back is a hint.
          </p>
          {notice && (
            <p className="error" role="alert">
              {notice}
            </p>
          )}
          <div className="menu-buttons">
            <button type="button" className="fire" onClick={playComputer}>
              Play the computer
            </button>
            <button type="button" className="fire alt" onClick={() => startPairing('host')}>
              Host a game
            </button>
            <button type="button" className="fire alt" onClick={() => startPairing('guest')}>
              Join a game
            </button>
          </div>
          <p className="fineprint">
            Two phones on the same Wi-Fi. No account and no server: you pair by scanning each other's codes.
          </p>
        </main>
      )}

      {screen.name === 'pair' && (
        <Pairing
          key={screen.offer ?? screen.role}
          role={screen.role}
          initialOffer={screen.offer}
          onLinked={(link) => linked(link, screen.role)}
          onBack={() => toMenu()}
        />
      )}

      {screen.name === 'answer' && <AnswerLanding key={screen.code} code={screen.code} onBack={() => toMenu()} />}

      {screen.name === 'starting' && (
        <main className="screen menu">
          <h1 className="logo">Connected!</h1>
          <p className="tagline">Setting up the game…</p>
          <button type="button" className="ghost wide" onClick={() => toMenu()}>
            Cancel
          </button>
        </main>
      )}

      {session && (
        <Game
          key={session.kind + (session as unknown as { role?: string }).role}
          session={session}
          onLeave={() => toMenu()}
          onReconnect={() => setReconnecting(true)}
        />
      )}

      {session?.role && reconnecting && (
        <div className="reconnect-layer">
          <Pairing
            role={session.role}
            reconnecting
            onLinked={(link) => {
              session.reconnect(link)
              setReconnecting(false)
            }}
            onBack={() => setReconnecting(false)}
          />
        </div>
      )}
    </>
  )
}
