import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealLocalAddresses } from './localAddresses'

const track = () => ({ stop: vi.fn() })
const stream = (t = track()) => ({ stream: { getTracks: () => [t] } as unknown as MediaStream, t })

function stubBrowser(getUserMedia: (() => Promise<MediaStream>) | undefined, secure = true) {
  vi.stubGlobal('navigator', { mediaDevices: getUserMedia ? { getUserMedia } : undefined })
  vi.stubGlobal('isSecureContext', secure)
}

afterEach(() => vi.unstubAllGlobals())

describe('revealLocalAddresses', () => {
  it('keeps the camera on until released, then switches it off', async () => {
    const { stream: s, t } = stream()
    stubBrowser(async () => s)
    const reveal = await revealLocalAddresses()
    expect(reveal.status).toBe('revealed')
    expect(t.stop).not.toHaveBeenCalled()
    reveal.release()
    expect(t.stop).toHaveBeenCalledOnce()
  })

  it('carries on when camera access is refused', async () => {
    stubBrowser(async () => Promise.reject(new DOMException('no', 'NotAllowedError')))
    expect((await revealLocalAddresses()).status).toBe('denied')
  })

  it('carries on when there is no camera API or the page is not secure', async () => {
    stubBrowser(undefined)
    expect((await revealLocalAddresses()).status).toBe('unavailable')
    stubBrowser(async () => stream().stream, false)
    expect((await revealLocalAddresses()).status).toBe('unavailable')
  })

  it('does not wait forever, and switches off a camera that is allowed too late', async () => {
    const { stream: s, t } = stream()
    let allow!: (s: MediaStream) => void
    stubBrowser(() => new Promise<MediaStream>((r) => (allow = r)))
    const reveal = await revealLocalAddresses(10)
    expect(reveal.status).toBe('timeout')
    allow(s)
    await Promise.resolve()
    await Promise.resolve()
    expect(t.stop).toHaveBeenCalledOnce()
  })
})
