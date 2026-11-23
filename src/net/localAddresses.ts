/**
 * Browsers hide a device's Wi-Fi address behind a random `something.local` name, so a web page can't
 * learn it (a privacy measure). Two phones can still find each other that way, but only if the
 * network lets them look those names up, and plenty of routers and Wi-Fi networks don't.
 *
 * Once a page has been given camera access, browsers share the real address instead. We only ask so
 * that the phones can connect: nothing is recorded or sent anywhere, and the camera is switched off
 * again as soon as the addresses have been collected.
 */
export type RevealStatus =
  /** Camera access given: the real addresses were shared. */
  | 'revealed'
  /** The person said no. Pairing still works on networks that allow `.local` lookups. */
  | 'denied'
  /** No camera support here (or not a secure page). */
  | 'unavailable'
  /** The question went unanswered for too long, so pairing carried on without it. */
  | 'timeout'

export interface Reveal {
  status: RevealStatus
  /** Switch the camera off. Call once the addresses are collected. */
  release(): void
}

const WAIT_MS = 20_000

const stop = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop())

export async function revealLocalAddresses(waitMs = WAIT_MS): Promise<Reveal> {
  const without = (status: RevealStatus): Reveal => ({ status, release() {} })
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!media?.getUserMedia || !globalThis.isSecureContext) return without('unavailable')

  let timer: ReturnType<typeof setTimeout> | undefined
  const asked = media.getUserMedia({ video: true })
  const unanswered = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), waitMs)
  })
  try {
    const got = await Promise.race([asked, unanswered])
    clearTimeout(timer)
    if (got === 'timeout') {
      // Answered later: too late to help, so don't leave the camera on.
      asked.then(stop, () => {})
      return without('timeout')
    }
    return { status: 'revealed', release: () => stop(got) }
  } catch {
    clearTimeout(timer)
    return without('denied')
  }
}
