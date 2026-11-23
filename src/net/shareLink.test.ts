import { describe, expect, it } from 'vitest'
import { decodeSignal, encodeSignal } from './signaling'
import { buildLink, codeCandidates, extractCode, isLocalHostname, normalizeBase, parseLinkHash, pickLanAddress } from './shareLink'

const CODE = 'TS1o.XZHdattAEIXv9RT7Auvs7N9oB3RhSQ4YU-_x9'
const SDP = 'v=0\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=ice-ufrag:abcd\r\n'

describe('share links', () => {
  it('put the code after the # so it never reaches a server', () => {
    const link = buildLink('http://192.168.1.23:5173/', 'join', CODE)
    expect(link).toBe(`http://192.168.1.23:5173/#join=${CODE}`)
    expect(new URL(link).search).toBe('')
    expect(new URL(link).hash).toBe(`#join=${CODE}`)
  })

  it('are read back from the hash', () => {
    expect(parseLinkHash(`#join=${CODE}`)).toEqual({ kind: 'join', code: CODE })
    expect(parseLinkHash(`#answer=${CODE.replace('o.', 'a.')}`)).toEqual({ kind: 'answer', code: CODE.replace('o.', 'a.') })
  })

  it('ignore other hashes and links with no real code in them', () => {
    for (const hash of ['', '#', '#join=', '#join=hello', '#other=' + CODE, '#answer=notacode', CODE]) {
      expect(parseLinkHash(hash), hash).toBeNull()
    }
  })

  it('find the code in a bare code, a link, or a chat message', () => {
    expect(extractCode(CODE)).toBe(CODE)
    expect(extractCode(`  ${CODE}\n`)).toBe(CODE)
    expect(extractCode(`http://192.168.1.23:5173/#join=${CODE}`)).toBe(CODE)
    expect(extractCode(`Join my game! https://example.com/#join=${CODE} see you there`)).toBe(CODE)
    expect(extractCode('  just some words ')).toBe('just some words')
  })

  it('offer a second reading for a code that was wrapped over several lines', () => {
    const wrapped = `${CODE.slice(0, 20)}\n${CODE.slice(20)}`
    expect(codeCandidates(wrapped)).toContain(CODE)
    expect(codeCandidates(CODE)).toEqual([CODE]) // nothing to second-guess in a clean code
  })
})

describe('reading a pasted or scanned link as a pairing code', () => {
  it('works for a whole link as well as a bare code', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    const link = buildLink('http://192.168.1.23:5173/', 'join', code)
    const fromLink = await decodeSignal(link, 'offer')
    const fromCode = await decodeSignal(code, 'offer')
    expect(fromLink.sdp).toBe(fromCode.sdp)
    expect(fromLink.sdp).toContain('a=ice-ufrag:abcd')
  })

  it('copes with the messy ways people actually share it', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    const link = buildLink('http://192.168.1.23:5173/', 'join', code)
    const wanted = (await decodeSignal(code, 'offer')).sdp
    const messy = [
      `Join my game! ${link} see you there`, // words after it must not be glued on
      `${link}\nthanks`, // ...nor a following line
      `${code.slice(0, 50)}\n${code.slice(50, 120)}\r\n${code.slice(120)}`, // wrapped by a chat app
      `  \n${link}  \n`, // stray blank space
    ]
    for (const text of messy) expect((await decodeSignal(text, 'offer')).sdp, text.slice(0, 30)).toBe(wanted)
  })

  it('still refuses the wrong kind, even inside a link', async () => {
    const answer = await encodeSignal({ type: 'answer', sdp: SDP })
    await expect(decodeSignal(buildLink('http://x.test/', 'answer', answer), 'offer')).rejects.toThrow(/answer code/)
  })
})

describe('the address other phones should use', () => {
  it('knows which addresses phones cannot reach', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '0.0.0.0']) {
      expect(isLocalHostname(h), h).toBe(true)
    }
    for (const h of ['192.168.1.23', '10.0.0.5', 'game.example.com', 'my-mac.local']) {
      expect(isLocalHostname(h), h).toBe(false)
    }
  })

  it('tidies what someone typed', () => {
    expect(normalizeBase('192.168.1.23:5173', 'http:')).toBe('http://192.168.1.23:5173/')
    expect(normalizeBase('  192.168.1.23:5173  ', 'https:')).toBe('https://192.168.1.23:5173/')
    expect(normalizeBase('http://192.168.1.23:5173/some/path?x=1#y', 'https:')).toBe('http://192.168.1.23:5173/')
    expect(normalizeBase('my-mac.local:5173', 'http:')).toBe('http://my-mac.local:5173/')
    expect(normalizeBase('192.168.1.23', 'http:', '/tower/')).toBe('http://192.168.1.23/tower/')
  })

  it('refuses anything that would not work or is not a web address', () => {
    for (const bad of ['', '   ', 'localhost:5173', '127.0.0.1:5173', 'javascript:alert(1)', 'ftp://192.168.1.2/', 'http://', '::::']) {
      expect(normalizeBase(bad, 'http:'), bad).toBeNull()
    }
  })

  it('prefers a home-network address from the list', () => {
    expect(pickLanAddress(['169.254.3.4', '192.168.1.23'])).toBe('192.168.1.23')
    expect(pickLanAddress(['203.0.113.9', '10.1.2.3'])).toBe('10.1.2.3')
    expect(pickLanAddress(['172.20.0.2'])).toBe('172.20.0.2')
    expect(pickLanAddress(['203.0.113.9'])).toBe('203.0.113.9')
    expect(pickLanAddress([])).toBeNull()
  })
})
