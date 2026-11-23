/**
 * Pairing codes: a WebRTC session description squeezed into a short string that fits in a QR code
 * (or a text message). There is no signaling server, so players hand these to each other:
 *   host  -> guest : the offer   (shown as a QR code, scanned or pasted)
 *   guest -> host  : the answer  (the same, the other way)
 *
 * Format:  TS1o.<data>  /  TS1a.<data>   (deflate-compressed, base64url)
 *          TS1O.<data>  /  TS1A.<data>   (uppercase = not compressed, for browsers without CompressionStream)
 */

import { codeCandidates } from './shareLink'

export type SignalType = 'offer' | 'answer'

export class SignalError extends Error {}

const VERSION = 'TS1'
/** A real data-channel description is under 1 KB; anything far larger is not ours. */
const MAX_CODE_CHARS = 6000
const MAX_SDP_BYTES = 16_000

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer.write(bytes as BufferSource).then(() => writer.close()).catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      void reader.cancel()
      throw new SignalError('That code is too large to be a game code.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * Drop what a data-channel-only connection never uses, so the code (and its QR) stays small:
 * TCP candidates (a data channel runs over UDP), per-candidate bookkeeping, and RTP/media extras.
 * Everything needed to connect (credentials, fingerprint, UDP candidates, SCTP port) is kept.
 */
export function slimSdp(sdp: string): string {
  return sdp
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      if (line.startsWith('a=candidate:') && / tcp /i.test(line)) return false
      return !/^a=(extmap-allow-mixed|msid-semantic:|max-message-size:)/.test(line)
    })
    .map((line) => (line.startsWith('a=candidate:') ? line.replace(/ (generation|network-cost|network-id) \d+/g, '') : line))
    .join('\n')
    .trim()
}

/** Turn a session description into a pairing code. */
export async function encodeSignal(desc: { type: RTCSdpType; sdp?: string }): Promise<string> {
  if ((desc.type !== 'offer' && desc.type !== 'answer') || !desc.sdp) throw new SignalError('Nothing to encode.')
  const letter = desc.type === 'offer' ? 'o' : 'a'
  const bytes = new TextEncoder().encode(slimSdp(desc.sdp))
  if (canCompress()) {
    const packed = await pipe(bytes, new CompressionStream('deflate-raw'), MAX_SDP_BYTES)
    return `${VERSION}${letter}.${toBase64Url(packed)}`
  }
  return `${VERSION}${letter.toUpperCase()}.${toBase64Url(bytes)}`
}

/** Read a pairing code back into a session description, checking it is the kind we expect. */
export async function decodeSignal(raw: string, expected: SignalType): Promise<RTCSessionDescriptionInit> {
  // Accept a bare code, a whole share link, or a chat message with a link in it.
  const candidates = codeCandidates(raw)
  if (candidates.length === 0) return decodeOne(raw.replace(/\s+/g, ''), expected) // fails with the right message
  let firstError: unknown
  for (const candidate of candidates) {
    try {
      return await decodeOne(candidate, expected)
    } catch (err) {
      if (err instanceof WrongKindError) throw err
      firstError ??= err
    }
  }
  throw firstError
}

class WrongKindError extends SignalError {}

async function decodeOne(code: string, expected: SignalType): Promise<RTCSessionDescriptionInit> {
  if (code.length > MAX_CODE_CHARS) throw new SignalError('That is too long to be a game code.')
  const match = /^TS1([oaOA])\.([A-Za-z0-9_-]+)$/.exec(code)
  if (!match) throw new SignalError("That doesn't look like a Tower Siege game code.")

  const [, letter, data] = match
  const type: SignalType = letter.toLowerCase() === 'o' ? 'offer' : 'answer'
  if (type !== expected) {
    throw new WrongKindError(
      expected === 'offer'
        ? "That is an answer code. Paste the host's game code here instead."
        : "That is the host's game code. Paste your friend's answer code here instead.",
    )
  }

  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(data)
    if (letter === letter.toLowerCase()) {
      if (!canCompress()) throw new SignalError('This browser cannot read compressed game codes.')
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_SDP_BYTES)
    }
  } catch (err) {
    if (err instanceof SignalError) throw err
    throw new SignalError('That game code is damaged. Try copying it again.')
  }

  const sdp = new TextDecoder().decode(bytes).replace(/\n/g, '\r\n') + '\r\n'
  if (!sdp.startsWith('v=0')) throw new SignalError('That game code is damaged. Try copying it again.')
  return { type, sdp }
}
