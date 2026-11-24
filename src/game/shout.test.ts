import { describe, expect, it } from 'vitest'
import type { FeedbackKind } from './feedback'
import { shoutFor } from './shout'

const KINDS: FeedbackKind[] = ['far-short', 'near-short', 'just-over', 'too-far', 'too-high', 'breach', 'pit', 'hit', 'destroyed', 'collapse']

describe('shouts', () => {
  it('have a short callout for every kind of result, for both players', () => {
    for (const kind of KINDS) {
      for (const whose of ['mine', 'enemy'] as const) {
        const { text } = shoutFor(kind, whose)
        expect(text.length, `${whose} ${kind}`).toBeGreaterThan(2)
        expect(text.split(' ').length, `${whose} ${kind}`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('tell your own shots apart (so the callout is still useful for aiming)', () => {
    const mine = KINDS.map((k) => shoutFor(k, 'mine').text)
    expect(new Set(mine).size).toBe(KINDS.length)
  })
})
