import { useCallback, useEffect, useRef, useState } from 'react'
import type { Link } from './net/link'
import { listenForAnswers } from './net/pairChannel'
import { ConnectError, joinHost, startHost, type GuestAnswer, type HostOffer } from './net/rtc'
import { buildLink } from './net/shareLink'
import { SignalError } from './net/signaling'
import { QrCode } from './QrCode'
import { QrScanner } from './QrScanner'
import { useShareBase, type ShareBase } from './useShareBase'

interface Props {
  role: 'host' | 'guest'
  /** Resuming a game that dropped, rather than starting a new one. */
  reconnecting?: boolean
  /** Arrived by scanning the host's QR code with a camera app: join straight away. */
  initialOffer?: string
  onLinked: (link: Link) => void
  onBack: () => void
}

/** What went wrong, in words for a player, plus the technical facts if there are any. */
interface Problem {
  message: string
  details?: string[]
}

const toProblem = (err: unknown): Problem => ({
  message: err instanceof SignalError || err instanceof Error ? err.message : 'Something went wrong. Please try again.',
  details: err instanceof ConnectError ? err.details : undefined,
})

/** The red box shown when pairing fails, with the technical details tucked underneath. */
function ProblemBox({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  return (
    <div className="error" role="alert">
      <p>{problem.message}</p>
      {problem.details && (
        <details>
          <summary>Technical details</summary>
          <pre>{problem.details.join('\n')}</pre>
        </details>
      )}
      <button type="button" className="ghost" onClick={onRetry}>
        Start over
      </button>
    </div>
  )
}

/** A link as text, with a Copy button: the way to pair when a camera is not an option. */
function CopyRow({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      area.current?.select() // older browsers: select it so it can be copied by hand
      document.execCommand?.('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="copy-row">
      <textarea ref={area} readOnly value={link} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Game link" />
      <button type="button" className="ghost" onClick={copy}>
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  )
}

/**
 * Shown when the game is open as "localhost". To a phone that means the phone itself, so a link
 * built from it can never work: say so, and let the player correct the address if it was guessed wrong.
 */
function AddressNotice({ share }: { share: ShareBase }) {
  if (!share.needsAddress) return null
  return (
    <div className={`address-box${share.valid ? '' : ' bad'}`}>
      <p>
        {share.valid ? (
          <>
            {share.detected ? 'Found this computer on your Wi-Fi.' : 'Using this address.'} Your friend's phone will open{' '}
            <b>{share.base}</b>
          </>
        ) : (
          <>
            <b>Phones can't open "localhost".</b> Type this computer's address on your Wi-Fi, like 192.168.1.23:5173 (it is the
            "Network" line shown when you start the game).
          </>
        )}
      </p>
      <label>
        <span>Address for the other phone</span>
        <input
          value={share.address}
          placeholder="192.168.1.23:5173"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => share.setAddress(e.target.value)}
        />
      </label>
    </div>
  )
}

/** Paste a code, or scan one with the camera. */
function CodeInput(props: { cta: string; scanLabel: string; busy: boolean; onCode: (text: string) => void }) {
  const { cta, scanLabel, busy, onCode } = props
  const [scanning, setScanning] = useState(false)
  const [text, setText] = useState('')
  if (scanning) {
    return (
      <QrScanner
        onClose={() => setScanning(false)}
        onCode={(code) => {
          setScanning(false)
          onCode(code)
        }}
      />
    )
  }
  return (
    <div className="code-input">
      <button type="button" className="fire" disabled={busy} onClick={() => setScanning(true)}>
        {scanLabel}
      </button>
      <details>
        <summary>…or paste the code instead</summary>
        <textarea value={text} rows={3} placeholder="TS1…" onChange={(e) => setText(e.target.value)} aria-label="Paste code" />
        <button type="button" className="ghost wide" disabled={busy || !text.trim()} onClick={() => onCode(text)}>
          {cta}
        </button>
      </details>
    </div>
  )
}

/** Shared by both roles: create the connection on arrival, hand it over once it is open, and never kill a connection that was handed over. */
function usePairing<T extends { linked: Promise<Link>; cancel: () => void }>(
  create: () => Promise<T>,
  onLinked: (link: Link) => void,
  attempt: number,
  onError: (problem: Problem) => void,
) {
  const [pairing, setPairing] = useState<T | null>(null)
  const onLinkedRef = useRef(onLinked)
  onLinkedRef.current = onLinked
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const createRef = useRef(create)
  createRef.current = create

  useEffect(() => {
    let cancelled = false
    let handedOver = false
    let current: T | undefined
    setPairing(null)
    createRef
      .current()
      .then((p) => {
        if (cancelled) return p.cancel()
        current = p
        setPairing(p)
        p.linked
          .then((link) => {
            if (cancelled) return link.close()
            handedOver = true
            onLinkedRef.current(link)
          })
          .catch((err: Error) => {
            if (!cancelled && err.message !== 'Cancelled') onErrorRef.current(toProblem(err))
          })
      })
      .catch((err) => !cancelled && onErrorRef.current(toProblem(err)))
    return () => {
      cancelled = true
      if (!handedOver) current?.cancel() // the connection belongs to the game once it is handed over
    }
  }, [attempt])

  return pairing
}

function HostPairing({ onLinked, onBack, reconnecting }: Omit<Props, 'role'>) {
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<Problem | null>(null)
  const [connecting, setConnecting] = useState(false)
  const failed = useCallback((problem: Problem) => {
    setConnecting(false)
    setError(problem)
  }, [])
  const offer: HostOffer | null = usePairing(startHost, onLinked, attempt, failed)
  const share = useShareBase()
  const link = offer ? buildLink(share.base, 'join', offer.offerCode) : ''

  const submit = useCallback(
    async (text: string) => {
      if (!offer) return
      setError(null)
      try {
        await offer.acceptAnswer(text)
        setConnecting(true)
      } catch (err) {
        setError(toProblem(err))
      }
    },
    [offer],
  )

  // If the answer was scanned with a camera app, it arrives in another tab: that tab passes it on.
  useEffect(() => (offer ? listenForAnswers(submit) : undefined), [offer, submit])
  const retry = () => {
    setError(null)
    setConnecting(false)
    setAttempt((n) => n + 1)
  }

  return (
    <div className="screen pairing">
      <h1>{reconnecting ? 'Reconnect: host' : 'Host a game'}</h1>
      <section className="step">
        <h2>
          <span className="num">1</span> Show this to your friend
        </h2>
        <p>
          Point their phone's camera at this code. It opens the game and joins by itself.
        </p>
        <AddressNotice share={share} />
        {offer ? (
          <>
            <QrCode text={link} label="A link that joins your game, as a QR code" />
            <details>
              <summary>Can't scan? Send them the link instead</summary>
              <CopyRow link={link} />
            </details>
          </>
        ) : (
          !error && <p className="note">Getting ready…</p>
        )}
      </section>

      <section className="step">
        <h2>
          <span className="num">2</span> Scan their code back
        </h2>
        <p>Their phone will then show a code of its own. Scan it here, with this button.</p>
        {connecting ? (
          <p className="note">Connecting… keep both phones on the same Wi-Fi.</p>
        ) : (
          <CodeInput scanLabel="Scan their code" cta="Connect" busy={!offer} onCode={submit} />
        )}
      </section>

      {error && <ProblemBox problem={error} onRetry={retry} />}
      <button type="button" className="ghost wide" onClick={onBack}>
        Cancel
      </button>
    </div>
  )
}

/** Step 2 for the guest: answer the host's code, show our own, wait to be scanned. */
function GuestAnswerStep(props: { offerCode: string; onLinked: (link: Link) => void; onError: (problem: Problem) => void }) {
  const { offerCode, onLinked, onError } = props
  const create = useCallback(() => joinHost(offerCode), [offerCode])
  const answer: GuestAnswer | null = usePairing(create, onLinked, 0, onError)
  const share = useShareBase()

  // What is going on, as far as this phone can tell: has it found the host's phone yet?
  const [ice, setIce] = useState<RTCIceConnectionState>('new')
  const [waited, setWaited] = useState(false)
  useEffect(() => (answer ? answer.onIceState(setIce) : undefined), [answer])
  useEffect(() => {
    if (!answer) return
    const t = setTimeout(() => setWaited(true), 20_000)
    return () => clearTimeout(t)
  }, [answer])
  const found = ice === 'connected' || ice === 'completed'
  const link = answer ? buildLink(share.base, 'answer', answer.answerCode) : ''
  return (
    <section className="step">
      <h2>
        <span className="num">2</span> Show this to the host
      </h2>
      <p>
        On their phone, they tap <b>Scan their code</b> and scan <b>your</b> code, and you're connected.
      </p>
      {answer ? (
        <>
          <QrCode text={link} label="Your answer as a QR code" />
          <details>
            <summary>Can't scan? Send them the link instead</summary>
            <CopyRow link={link} />
          </details>
          {found ? (
            <p className="note good">
              ✓ Your phones can see each other. Now the host needs to tap <b>Scan their code</b> and scan this screen.
            </p>
          ) : waited ? (
            <p className="note">
              Still looking for the host's phone. Are you both on the same Wi-Fi? And has the host scanned this code? They need to tap{' '}
              <b>Scan their code</b> in their game.
            </p>
          ) : (
            <p className="note">Waiting for the host to scan it…</p>
          )}
        </>
      ) : (
        <p className="note">Getting ready…</p>
      )}
    </section>
  )
}

function GuestPairing({ onLinked, onBack, reconnecting, initialOffer }: Omit<Props, 'role'>) {
  const [attempt, setAttempt] = useState(0)
  const [offerCode, setOfferCode] = useState<string | null>(initialOffer ?? null)
  const [error, setError] = useState<Problem | null>(null)
  const failed = useCallback((problem: Problem) => setError(problem), [])

  const retry = () => {
    setError(null)
    setOfferCode(null)
    setAttempt((n) => n + 1)
  }

  return (
    <div className="screen pairing">
      <h1>{reconnecting ? 'Reconnect: join' : 'Join a game'}</h1>
      {!offerCode ? (
        <section className="step">
          <h2>
            <span className="num">1</span> Scan the host's code
          </h2>
          <p>
            On their phone, tap <b>Host a game</b> and scan the code it shows.
          </p>
          <CodeInput
            scanLabel="Scan the host's code"
            cta="Continue"
            busy={false}
            onCode={(code) => {
              setError(null)
              setOfferCode(code)
            }}
          />
        </section>
      ) : (
        <GuestAnswerStep key={attempt} offerCode={offerCode} onLinked={onLinked} onError={failed} />
      )}

      {error && <ProblemBox problem={error} onRetry={retry} />}
      <button type="button" className="ghost wide" onClick={onBack}>
        Cancel
      </button>
    </div>
  )
}

export default function Pairing({ role, ...rest }: Props) {
  return role === 'host' ? <HostPairing {...rest} /> : <GuestPairing {...rest} />
}
