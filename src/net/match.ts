import { randomTower } from '../game/tower'
import { Bot, type BotOptions } from './bot'
import { createLoopbackPair } from './link'
import { Peer } from './peer'

export interface Match {
  /** The human's side of the match. Everything the UI may use. */
  me: Peer
  /** Local stand-in for the other phone. Replaced by a WebRTC peer in Phase 3. */
  bot: Bot
}

export interface MatchOptions extends BotOptions {
  latencyMs?: number
}

/** A single-device match against a computer opponent, over a simulated network link. The human fires first. */
export function createLocalMatch({ latencyMs = 250, ...botOptions }: MatchOptions = {}): Match {
  const [mine, theirs] = createLoopbackPair(latencyMs)
  return {
    me: new Peer(mine, randomTower(), true),
    bot: new Bot(theirs, randomTower(), false, botOptions),
  }
}

export function closeMatch(match: Match) {
  // The human's side first, so it does not notice the link closing and report a lost connection.
  match.me.dispose()
  match.bot.dispose()
}
