import { describe, expect, it } from 'vitest'
import { describeConnection, summarizeSdp } from './iceReport'

const SDP = [
  'v=0',
  'a=candidate:1 1 udp 2113937151 7d3f1a4e-2c1b-4f0a-9d65-1f2a3b4c5d6e.local 54321 typ host',
  'a=candidate:2 1 UDP 2113939711 192.168.1.50 59876 typ host', // Safari writes the protocol in capitals
  'a=candidate:3 1 udp 2113932031 fe80::1c2b:3d4e:5f60:7182 51000 typ host',
  'a=candidate:4 1 tcp 1518283007 192.168.1.50 9 typ host tcptype active',
  'a=ice-ufrag:abcd',
  '',
].join('\r\n')

const pc = (over: Partial<Parameters<typeof describeConnection>[0]> = {}) => ({
  connectionState: 'connecting' as RTCPeerConnectionState,
  iceConnectionState: 'checking' as RTCIceConnectionState,
  iceGatheringState: 'complete' as RTCIceGatheringState,
  localDescription: { type: 'offer', sdp: SDP, toJSON: () => ({}) } as RTCSessionDescription,
  remoteDescription: { type: 'answer', sdp: SDP, toJSON: () => ({}) } as RTCSessionDescription,
  ...over,
})

describe('summarizeSdp', () => {
  it('counts what a device offered', () => {
    expect(summarizeSdp(SDP)).toEqual({ total: 4, udp: 3, tcp: 1, hidden: 1, numeric: 3, ipv6: 1 })
  })
  it('copes with nothing at all', () => {
    expect(summarizeSdp('')).toEqual({ total: 0, udp: 0, tcp: 0, hidden: 0, numeric: 0, ipv6: 0 })
    expect(summarizeSdp(undefined)).toEqual({ total: 0, udp: 0, tcp: 0, hidden: 0, numeric: 0, ipv6: 0 })
  })
})

describe('describeConnection', () => {
  it('says what each side offered and how far it got', () => {
    const text = describeConnection(pc()).join('\n')
    expect(text).toContain('Connection: connecting, ICE: checking')
    expect(text).toContain('This device offered: 4 (3 udp, 1 hidden by name')
    expect(text).toContain('The other device offered: 4')
  })

  it('blames the missing second step when the other half never arrived', () => {
    const text = describeConnection(pc({ remoteDescription: null })).join('\n')
    expect(text).toContain("The other device's code was never received")
    expect(text).toMatch(/Likely cause: the other phone never completed its half/)
  })

  it('blames the network when both sides offered addresses but could not connect', () => {
    expect(describeConnection(pc({ iceConnectionState: 'failed' })).join('\n')).toMatch(/could not reach each other/)
  })

  it('tells a missing last step apart from a network problem', () => {
    // ICE connected = the devices found each other. Still "connecting" = the handshake never finished.
    const found = describeConnection(pc({ iceConnectionState: 'connected' })).join('\n')
    expect(found).toMatch(/can reach each other, but the connection was never completed/)
    expect(found).not.toMatch(/could not reach each other/)
  })

  it('notices a device with no usable address', () => {
    const none = { type: 'offer', sdp: 'v=0\r\n', toJSON: () => ({}) } as RTCSessionDescription
    expect(describeConnection(pc({ localDescription: none })).join('\n')).toMatch(/this device found no network address/)
    expect(describeConnection(pc({ remoteDescription: none })).join('\n')).toMatch(/other device offered no network address/)
  })
})

describe('phones that only offered hidden .local names', () => {
  const hidden = {
    type: 'offer',
    sdp: 'a=candidate:1 1 udp 2113937151 7d3f1a4e-2c1b-4f0a-9d65-1f2a3b4c5d6e.local 54321 typ host\r\n',
    toJSON: () => ({}),
  } as RTCSessionDescription

  it('explains a connection that never started (the real failure seen on two phones)', () => {
    const text = describeConnection(
      pc({ connectionState: 'new', iceConnectionState: 'new', localDescription: hidden, remoteDescription: hidden }),
      ['Camera access: refused'],
    ).join('\n')
    expect(text).toContain('Camera access: refused')
    expect(text).toMatch(/hid their Wi-Fi address behind a '.local' name/)
  })

  it('does not blame the names when real addresses were shared', () => {
    expect(describeConnection(pc({ iceConnectionState: 'failed' })).join('\n')).not.toMatch(/'.local' name/)
  })
})
