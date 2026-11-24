import type { FeedbackKind } from './feedback'

/**
 * The few words shouted over the battlefield after a shot. The longer hint ("Add a little power") still
 * goes in the status line; this is the quick, readable-at-a-glance version.
 */
export interface Shout {
  text: string
  /** How exciting it is: a miss, a hit, or something breaking. Drives the colour. */
  tone: 'miss' | 'hit' | 'big'
}

const YOURS: Record<FeedbackKind, Shout> = {
  'far-short': { text: 'Way short!', tone: 'miss' },
  'near-short': { text: 'A bit short!', tone: 'miss' },
  'just-over': { text: 'Just over!', tone: 'miss' },
  'too-far': { text: 'Too far!', tone: 'miss' },
  'too-high': { text: 'Too high!', tone: 'miss' },
  breach: { text: 'Through a gap!', tone: 'miss' },
  pit: { text: 'In a gap!', tone: 'miss' },
  hit: { text: 'Hit!', tone: 'hit' },
  destroyed: { text: 'Smash!', tone: 'big' },
  collapse: { text: 'Timber!', tone: 'big' },
}

/** What you say when the enemy's shot lands on your tower. */
const THEIRS: Record<FeedbackKind, Shout> = {
  'far-short': { text: 'Phew!', tone: 'miss' },
  'near-short': { text: 'Close one!', tone: 'miss' },
  'just-over': { text: 'Close one!', tone: 'miss' },
  'too-far': { text: 'Phew!', tone: 'miss' },
  'too-high': { text: 'Phew!', tone: 'miss' },
  breach: { text: 'Close one!', tone: 'miss' },
  pit: { text: 'Close one!', tone: 'miss' },
  hit: { text: 'Ouch!', tone: 'hit' },
  destroyed: { text: 'Crunch!', tone: 'big' },
  collapse: { text: 'Timber!', tone: 'big' },
}

export const shoutFor = (kind: FeedbackKind, whose: 'mine' | 'enemy'): Shout => (whose === 'mine' ? YOURS : THEIRS)[kind]
