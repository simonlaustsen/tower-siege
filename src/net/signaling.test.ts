import { describe, expect, it } from 'vitest'
import { decodeSignal, encodeSignal, SignalError, slimSdp } from './signaling'

/** What Chrome produces for a data-channel-only offer on a home network (typical size and shape). */
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2113937151 7d3f1a4e-2c1b-4f0a-9d65-1f2a3b4c5d6e.local 54321 typ host generation 0 network-cost 999',
  'a=candidate:2563871442 1 udp 2113939711 b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f.local 59876 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 tcp 1518283007 192.168.1.23 9 typ host tcptype active generation 0 network-cost 999',
  'a=ice-ufrag:aBcD',
  'a=ice-pwd:7x9Zq3Lm2Kp8Vn5Rt1Yw4Hs6',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 4A:1F:9C:0B:7E:23:D5:88:61:AF:30:C2:19:E4:5B:77:0D:92:3A:6C:F1:8E:24:B9:50:D7:A3:16:CB:6F:08:E2',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n')

describe('pairing codes', () => {
  it('round-trip a session description, keeping everything a browser needs to connect', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    const back = await decodeSignal(code, 'offer')
    expect(back.type).toBe('offer')
    expect(back.sdp).toBe(slimSdp(SDP).replace(/\n/g, '\r\n') + '\r\n')
    for (const needed of [
      'v=0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'a=ice-ufrag:aBcD',
      'a=ice-pwd:7x9Zq3Lm2Kp8Vn5Rt1Yw4Hs6',
      'a=fingerprint:sha-256 4A:1F:9C:0B',
      'a=setup:actpass',
      'a=mid:0',
      'a=sctp-port:5000',
      'typ host',
    ]) {
      expect(back.sdp, needed).toContain(needed)
    }
    expect(back.sdp!.match(/a=candidate:.* udp /g)).toHaveLength(2) // both UDP candidates survive
  })

  it('slims the description: no TCP candidates, no per-candidate bookkeeping, no RTP extras', () => {
    const slim = slimSdp(SDP)
    expect(slim).not.toMatch(/ tcp /)
    expect(slim).not.toMatch(/network-cost|generation/)
    expect(slim).not.toMatch(/extmap-allow-mixed|msid-semantic|max-message-size/)
    expect(slim.length).toBeLessThan(SDP.length * 0.75)
  })

  it('are small enough for an easily scanned QR code', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    console.log('pairing code length:', code.length, 'characters (raw SDP is', SDP.length + ')')
    expect(code.length).toBeLessThan(560)
    expect(code).toMatch(/^TS1o\.[A-Za-z0-9_-]+$/) // safe in a URL or a chat message
  })

  it('tolerate whitespace and line breaks from copy and paste', async () => {
    const code = await encodeSignal({ type: 'answer', sdp: SDP })
    const messy = `  ${code.slice(0, 40)}\n${code.slice(40, 90)}\r\n  ${code.slice(90)}  \n`
    expect((await decodeSignal(messy, 'answer')).sdp).toContain('a=ice-ufrag:aBcD')
  })

  it('refuse the wrong kind of code with a helpful message', async () => {
    const offer = await encodeSignal({ type: 'offer', sdp: SDP })
    const answer = await encodeSignal({ type: 'answer', sdp: SDP })
    await expect(decodeSignal(answer, 'offer')).rejects.toThrow(/answer code/)
    await expect(decodeSignal(offer, 'answer')).rejects.toThrow(/host's game code/)
  })

  it('refuse garbage, damaged and oversized codes without crashing', async () => {
    await expect(decodeSignal('hello world', 'offer')).rejects.toBeInstanceOf(SignalError)
    await expect(decodeSignal('', 'offer')).rejects.toBeInstanceOf(SignalError)
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    await expect(decodeSignal(code.slice(0, -12), 'offer')).rejects.toBeInstanceOf(SignalError)
    await expect(decodeSignal('TS1o.' + 'A'.repeat(7000), 'offer')).rejects.toThrow(/too long/)
    await expect(decodeSignal('TS1o.!!!', 'offer')).rejects.toBeInstanceOf(SignalError)
  })

  it('refuse a compressed bomb', async () => {
    // 200 KB of zeros compresses to a few hundred bytes: it must not be inflated.
    const stream = new CompressionStream('deflate-raw')
    const writer = stream.writable.getWriter()
    void writer.write(new Uint8Array(200_000)).then(() => writer.close())
    const chunks: number[] = []
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(...value)
    }
    const bomb = 'TS1o.' + btoa(String.fromCharCode(...chunks)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    await expect(decodeSignal(bomb, 'offer')).rejects.toBeInstanceOf(SignalError)
  })

  it('will not encode an empty description', async () => {
    await expect(encodeSignal({ type: 'offer', sdp: '' })).rejects.toBeInstanceOf(SignalError)
    await expect(encodeSignal({ type: 'rollback' })).rejects.toBeInstanceOf(SignalError)
  })
})
