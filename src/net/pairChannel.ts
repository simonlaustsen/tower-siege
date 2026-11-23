/**
 * Hand-off between two tabs of the same browser.
 *
 * If the host scans the guest's QR code with the phone's normal camera app, it opens as a new tab
 * rather than inside the game that is waiting for it. When both tabs are on the same address, that
 * new tab can pass the code to the waiting game here, and the connection completes by itself.
 */
const NAME = 'tower-siege-pairing'
const ACK_WAIT_MS = 1500

const supported = () => typeof BroadcastChannel === 'function'

/** Passes an answer code to a waiting host game. Resolves true if one picked it up. */
export function sendAnswerToHost(code: string): Promise<boolean> {
  if (!supported()) return Promise.resolve(false)
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(NAME)
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      channel.close()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), ACK_WAIT_MS)
    channel.onmessage = (e) => e.data?.type === 'ack' && finish(true)
    channel.postMessage({ type: 'answer', code })
  })
}

/** A waiting host game listens here for an answer passed on by another tab. Returns a stop function. */
export function listenForAnswers(onAnswer: (code: string) => void): () => void {
  if (!supported()) return () => {}
  const channel = new BroadcastChannel(NAME)
  channel.onmessage = (e) => {
    const data = e.data as { type?: unknown; code?: unknown } | null
    if (data?.type === 'answer' && typeof data.code === 'string') {
      channel.postMessage({ type: 'ack' })
      onAnswer(data.code)
    }
  }
  return () => channel.close()
}
