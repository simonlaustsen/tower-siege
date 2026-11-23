import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { decodeSignal, encodeSignal } from './signaling'

/** Rasterise a QR code the way a screen would show it, as RGBA pixels. */
function render(text: string, pixelsPerModule: number, quiet = 2) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' })
  const n = qr.modules.size
  const size = (n + quiet * 2) * pixelsPerModule
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.modules.get(row, col)) continue
      for (let dy = 0; dy < pixelsPerModule; dy++) {
        for (let dx = 0; dx < pixelsPerModule; dx++) {
          const x = (col + quiet) * pixelsPerModule + dx
          const y = (row + quiet) * pixelsPerModule + dy
          const i = (y * size + x) * 4
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 20
        }
      }
    }
  }
  return { rgba, size, modules: n }
}

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2113937151 7d3f1a4e-2c1b-4f0a-9d65-1f2a3b4c5d6e.local 54321 typ host',
  'a=candidate:2563871442 1 udp 2113939711 b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f.local 59876 typ host',
  'a=ice-ufrag:aBcD',
  'a=ice-pwd:7x9Zq3Lm2Kp8Vn5Rt1Yw4Hs6',
  'a=fingerprint:sha-256 4A:1F:9C:0B:7E:23:D5:88:61:AF:30:C2:19:E4:5B:77:0D:92:3A:6C:F1:8E:24:B9:50:D7:A3:16:CB:6F:08:E2',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\r\n')

describe('QR codes for pairing', () => {
  it('can be scanned back into exactly the pairing code', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    // 4 px per module is roughly what a 320 px QR on a phone gives a camera at arm's length.
    const { rgba, size, modules } = render(code, 4)
    console.log(`QR for a ${code.length}-char code: ${modules}x${modules} modules`)
    const scanned = jsQR(rgba, size, size)
    expect(scanned?.data).toBe(code)
    expect((await decodeSignal(scanned!.data, 'offer')).sdp).toContain('a=ice-ufrag:aBcD')
  })

  it('stay a sensible density, so a phone camera can focus on them', async () => {
    const code = await encodeSignal({ type: 'answer', sdp: SDP })
    const { modules } = render(code, 2)
    expect(modules).toBeLessThanOrEqual(97) // QR version 19 or lower
  })
})
