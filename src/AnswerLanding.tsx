import { useEffect, useState } from 'react'
import { sendAnswerToHost } from './net/pairChannel'

/**
 * What you see after scanning your friend's answer code with the phone's normal camera app.
 * That opens a fresh page, not the game that is waiting for it. If that game is open in this same
 * browser, the code is passed to it; otherwise this explains what to do instead.
 */
export default function AnswerLanding({ code, onBack }: { code: string; onBack: () => void }) {
  const [state, setState] = useState<'sending' | 'sent' | 'notFound'>('sending')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    sendAnswerToHost(code).then((ok) => !cancelled && setState(ok ? 'sent' : 'notFound'))
    return () => {
      cancelled = true
    }
  }, [code])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // clipboard blocked: the code is on screen to copy by hand
    }
  }

  return (
    <main className="screen menu">
      {state === 'sending' && <h1 className="logo">Connecting…</h1>}
      {state === 'sent' && (
        <>
          <h1 className="logo">Sent!</h1>
          <p className="tagline">Your game was waiting for this. Go back to it: it will connect by itself.</p>
        </>
      )}
      {state === 'notFound' && (
        <>
          <h1 className="logo">Almost!</h1>
          <p className="tagline">
            That was your friend's answer code, and the camera app can't finish the connection on its own. Go back to the game you
            are hosting, tap <b>Scan their code</b> and scan it with that button. Or copy the code and paste it there.
          </p>
          <button type="button" className="fire alt" onClick={copy}>
            {copied ? 'Copied!' : 'Copy the code'}
          </button>
        </>
      )}
      <button type="button" className="ghost wide" onClick={onBack}>
        Back to the menu
      </button>
    </main>
  )
}
