import { TOWER_COLS, TOWER_ROWS } from '../game/constants'
import type { Feedback } from '../game/feedback'
import { MATERIALS } from '../game/materials'
import type { Tower } from '../game/tower'

/**
 * Wire protocol between two phones.
 *
 * Hidden-information rule: a tower exists only on its owner's phone. The attacker
 * sends a shot command; the defender resolves it against its own tower and answers with
 * qualitative feedback, plus a one-off snapshot of the tower as it stood when the shot
 * arrived (`reveal`), so the attacker's screen can follow the ball in and replay the hit.
 * The attacker's screen shows that snapshot only for the length of the replay and keeps nothing.
 * Never add anything else here (no standing positions, no hit points between shots).
 */
export const PROTOCOL_VERSION = 2

export interface FireMessage {
  type: 'fire'
  id: number
  angle: number
  power: number
}

export interface ResultMessage {
  type: 'result'
  id: number
  feedback: Feedback
  /** The defender's tower as it stood just before this shot, for the attacker's replay of the hit. */
  reveal: Tower
  /** The defender's tower has collapsed: the attacker wins. */
  towerDown: boolean
}

export interface RejectedMessage {
  type: 'rejected'
  id: number
  reason: string
}

/** The host starts every game (and rematch) by saying who fires first. */
export interface HelloMessage {
  type: 'hello'
  version: number
  youGoFirst: boolean
}

/** "I'd like another game." A new game starts once both players have asked. */
export interface RematchMessage {
  type: 'rematch'
}

export type Message = FireMessage | ResultMessage | RejectedMessage | HelloMessage | RematchMessage

const FEEDBACK_TONES = new Set(['miss', 'hit', 'big'])

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max

const isGrid = (v: unknown): v is number[][] =>
  Array.isArray(v) &&
  v.length === TOWER_ROWS &&
  v.every((row) => Array.isArray(row) && row.length === TOWER_COLS && row.every((n) => typeof n === 'number' && Number.isFinite(n)))

function isTower(v: unknown): v is Tower {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.x === 'number' && Number.isFinite(t.x) && typeof t.material === 'string' && t.material in MATERIALS && isGrid(t.hp) && isGrid(t.maxHp)
}

function isFeedback(v: unknown): v is Feedback {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return isStr(f.kind, 40) && isStr(f.title) && isStr(f.hint) && typeof f.tone === 'string' && FEEDBACK_TONES.has(f.tone)
}

/** Checks that something that came off the wire really is one of our messages. */
export function isMessage(v: unknown): v is Message {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  switch (m.type) {
    case 'fire':
      return isInt(m.id) && typeof m.angle === 'number' && typeof m.power === 'number'
    case 'result':
      return isInt(m.id) && typeof m.towerDown === 'boolean' && isFeedback(m.feedback) && isTower(m.reveal)
    case 'rejected':
      return isInt(m.id) && isStr(m.reason)
    case 'hello':
      return isInt(m.version) && typeof m.youGoFirst === 'boolean'
    case 'rematch':
      return true
    default:
      return false
  }
}

/** Largest frame we are willing to parse. Real messages are a few hundred bytes. */
export const MAX_FRAME_BYTES = 4096

/** Result of reading one frame off the wire. */
export type Frame = { kind: 'message'; message: Message } | { kind: 'ping' } | { kind: 'invalid' }

export function parseFrame(raw: unknown): Frame {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES) return { kind: 'invalid' }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'invalid' }
  }
  if (typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'ping') return { kind: 'ping' }
  return isMessage(value) ? { kind: 'message', message: value } : { kind: 'invalid' }
}
