/**
 * Pairing codes shared as links.
 *
 * A bare code in a QR is just text, and a phone's normal camera app turns unknown text into a web
 * search. Wrapped in a link, the same QR opens the game and joins by itself. The code goes after
 * the "#", which browsers never send to a server.
 *
 *   http://192.168.1.23:5173/#join=TS1o.…     the host's offer: opens the game as the guest
 *   http://192.168.1.23:5173/#answer=TS1a.…   the guest's answer: only useful inside the host's game
 */

export type LinkKind = 'join' | 'answer'

export function buildLink(base: string, kind: LinkKind, code: string): string {
  return `${base}#${kind}=${code}`
}

/** Reads `#join=…` / `#answer=…` from a URL hash. Returns null for anything else. */
export function parseLinkHash(hash: string): { kind: LinkKind; code: string } | null {
  const match = /^#(join|answer)=(.+)$/.exec(hash)
  if (!match) return null
  const code = extractCode(match[2])
  return /^TS1[oaOA]\./.test(code) ? { kind: match[1] as LinkKind, code } : null
}

const CODE_PATTERN = /TS1[oaOA]\.[A-Za-z0-9_-]+/

/**
 * Every plausible reading of the pairing code inside whatever was scanned or pasted (a bare code, a
 * whole link, or a chat message containing a link), best guess first.
 *
 * Two real-world problems pull in opposite directions: words after the code must not be glued on to
 * it, and a code that a chat app wrapped over several lines must be put back together. So the first
 * reading takes the code exactly as written, the second joins the lines up, and the caller keeps
 * whichever one actually decodes.
 */
export function codeCandidates(text: string): string[] {
  const asWritten = CODE_PATTERN.exec(text)?.[0]
  const joined = CODE_PATTERN.exec(text.replace(/\s+/g, ''))?.[0]
  return [...new Set([asWritten, joined].filter((c): c is string => !!c))]
}

/** The best single guess at the code in `text`, or the text itself if there is none. */
export function extractCode(text: string): string {
  return codeCandidates(text)[0] ?? text.trim()
}

/** Phones cannot reach "localhost": it means "this very device" to them. */
export function isLocalHostname(hostname: string): boolean {
  return /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i.test(hostname)
}

/**
 * Turns what someone typed ("192.168.1.23:5173", "http://192.168.1.23:5173/") into the address
 * other phones should use, or null if it is not usable. A missing scheme defaults to `protocol`.
 */
export function normalizeBase(input: string, protocol: string, basePath = '/'): string | null {
  const text = input.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${protocol}//${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || isLocalHostname(url.hostname)) return null
  return `${url.origin}${basePath}`
}

/** The most likely Wi-Fi address from a list: home networks first, then anything else. */
export function pickLanAddress(addresses: string[]): string | null {
  const isPrivate = (a: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  return addresses.find(isPrivate) ?? addresses[0] ?? null
}
