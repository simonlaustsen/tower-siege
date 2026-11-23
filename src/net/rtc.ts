import { describeConnection } from './iceReport'
import { RtcLink } from './rtcLink'
import { decodeSignal, encodeSignal } from './signaling'

/**
 * Serverless WebRTC pairing for two phones on the same Wi-Fi.
 *
 * No STUN/TURN: on one network the phones find each other with their local ("host") addresses,
 * so nothing ever leaves the room. The offer and answer travel between the phones as pairing
 * codes (see signaling.ts), shown as QR codes or pasted as text.
 */
const RTC_CONFIG: RTCConfiguration = { iceServers: [] }

/** Collecting local addresses is quick; don't wait forever if the browser stalls. */
const GATHER_TIMEOUT_MS = 3000
/** After both codes are exchanged, the connection itself should come up within this long. */
const CONNECT_TIMEOUT_MS = 30_000
/** The guest waits while the host scans their answer. */
const GUEST_WAIT_MS = 180_000

export const CONNECT_HELP =
  "Couldn't connect. Make sure both phones are on the same Wi-Fi. Guest or public networks often block phones from reaching each other."

/** The two phones found each other, but the host never entered this phone's code. */
export const GUEST_WAITING_ON_HOST =
  "This phone and the host's phone can see each other, but the host never entered this phone's code. In their game they need to tap Scan their code and scan this phone's screen (or paste this phone's link). Then try again."

/** The two phones never found each other. */
export const GUEST_NO_ROUTE =
  "This phone couldn't reach the host's phone. Check that both are on the same Wi-Fi (not a guest network), and that the host computer's firewall allows it."

const phonesCanSeeEachOther = (pc: RTCPeerConnection) =>
  pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'

/** A failed attempt, with the facts needed to see why (shown under "Technical details"). */
export class ConnectError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message)
  }
}

function waitForGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => pc.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

/** A promise that settles from the outside, plus a way to make it fail on a deadline or failure. */
function pendingLink() {
  let resolve!: (l: RtcLink) => void
  let reject!: (e: Error) => void
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  const promise = new Promise<RtcLink>((res, rej) => {
    resolve = (l) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      res(l)
    }
    reject = (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rej(e)
    }
  })
  promise.catch(() => {}) // the caller handles it; never leave it "unhandled"
  return {
    promise,
    resolve,
    reject,
    /** Call `onTimeout` if nothing has settled in `ms`. */
    deadline(ms: number, onTimeout: () => void) {
      clearTimeout(timer)
      if (!settled) timer = setTimeout(onTimeout, ms)
    },
  }
}

function watch(pc: RTCPeerConnection, fail: (message: string) => void, message: string) {
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') fail(message)
  })
}

/** Rejects `link` with an error that carries a report of how far this connection got. */
const failWith = (pc: RTCPeerConnection, link: ReturnType<typeof pendingLink>) => (message: string) =>
  link.reject(new ConnectError(message, describeConnection(pc)))

export interface HostOffer {
  /** Show this to the guest (as a QR code, or copy it). */
  offerCode: string
  /** Apply the guest's answer code. Throws a `SignalError` with a friendly message if it is wrong. */
  acceptAnswer(answerCode: string): Promise<void>
  /** Settles when the data channel is open and ready for the game. */
  linked: Promise<RtcLink>
  cancel(): void
}

export async function startHost(): Promise<HostOffer> {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  const channel = pc.createDataChannel('tower-siege', { ordered: true })
  const link = pendingLink()
  const fail = failWith(pc, link)
  watch(pc, fail, CONNECT_HELP)
  channel.addEventListener('open', () => link.resolve(new RtcLink(channel, pc)))

  await pc.setLocalDescription(await pc.createOffer())
  await waitForGathering(pc)
  const offerCode = await encodeSignal(pc.localDescription!)

  return {
    offerCode,
    async acceptAnswer(answerCode) {
      const answer = await decodeSignal(answerCode, 'answer')
      await pc.setRemoteDescription(answer)
      link.deadline(CONNECT_TIMEOUT_MS, () => fail(CONNECT_HELP))
    },
    linked: link.promise,
    cancel() {
      link.reject(new Error('Cancelled'))
      pc.close()
    },
  }
}

export interface GuestAnswer {
  /** Show this to the host (as a QR code, or copy it). */
  answerCode: string
  /** Live progress: has this phone found the host's phone yet? Returns a stop function. */
  onIceState(handler: (state: RTCIceConnectionState) => void): () => void
  linked: Promise<RtcLink>
  cancel(): void
}

export async function joinHost(offerCode: string): Promise<GuestAnswer> {
  const offer = await decodeSignal(offerCode, 'offer')
  const pc = new RTCPeerConnection(RTC_CONFIG)
  const link = pendingLink()
  const fail = failWith(pc, link)
  // Which message to give depends on how far it got when it failed.
  const failGuest = () => fail(phonesCanSeeEachOther(pc) ? GUEST_WAITING_ON_HOST : GUEST_NO_ROUTE)
  pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && failGuest())
  pc.addEventListener('datachannel', (e) => {
    const channel = e.channel
    if (channel.readyState === 'open') link.resolve(new RtcLink(channel, pc))
    else channel.addEventListener('open', () => link.resolve(new RtcLink(channel, pc)))
  })

  await pc.setRemoteDescription(offer)
  await pc.setLocalDescription(await pc.createAnswer())
  await waitForGathering(pc)
  const answerCode = await encodeSignal(pc.localDescription!)
  link.deadline(GUEST_WAIT_MS, failGuest)

  return {
    answerCode,
    onIceState(handler) {
      const listener = () => handler(pc.iceConnectionState)
      pc.addEventListener('iceconnectionstatechange', listener)
      handler(pc.iceConnectionState)
      return () => pc.removeEventListener('iceconnectionstatechange', listener)
    },
    linked: link.promise,
    cancel() {
      link.reject(new Error('Cancelled'))
      pc.close()
    },
  }
}
