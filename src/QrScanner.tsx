import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Called once with the text of the first QR code seen. */
  onCode: (text: string) => void
  onClose: () => void
}

/** Why the camera is unavailable, in words a player can act on. */
function cameraProblem(): string | null {
  if (typeof navigator.mediaDevices?.getUserMedia === 'function') return null
  return window.isSecureContext
    ? 'This browser cannot use the camera. Paste the code instead.'
    : 'Phone cameras only work on secure (https) pages. Paste the code instead, or open the game over https.'
}

/** Live camera view that reads the first QR code it sees. */
export function QrScanner({ onCode, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(cameraProblem)
  const [starting, setStarting] = useState(true)
  // Kept in a ref so a new callback identity never restarts the camera.
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    if (cameraProblem()) return
    let stopped = false
    let raf = 0
    let stream: MediaStream | undefined

    const stop = () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was refused. Allow it in your browser settings, or paste the code instead.'
            : 'Could not open the camera. Paste the code instead.',
        )
        return
      }
      if (stopped) return stop()
      const video = videoRef.current!
      video.srcObject = stream!
      video.setAttribute('playsinline', 'true') // iOS Safari: stay inline instead of going full screen
      await video.play().catch(() => {})
      setStarting(false)

      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      let lastScan = 0
      const tick = (now: number) => {
        if (stopped) return
        raf = requestAnimationFrame(tick)
        if (now - lastScan < 120 || video.readyState < 2 || !video.videoWidth) return
        lastScan = now
        // Scan a reduced copy of the frame: plenty for a QR code, and much faster.
        const scale = Math.min(1, 720 / video.videoWidth)
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
        if (found?.data) {
          stop()
          onCodeRef.current(found.data)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    void start()
    return stop
  }, [])

  return (
    <div className="scanner">
      {error ? (
        <p className="scanner-error">{error}</p>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-frame" aria-hidden />
          {starting && <p className="scanner-note">Starting camera…</p>}
        </div>
      )}
      {!error && <p className="scanner-hint">Point the camera at the other phone's QR code.</p>}
      <canvas ref={canvasRef} hidden />
      <button type="button" className="ghost wide" onClick={onClose}>
        {error ? 'Back' : 'Cancel'}
      </button>
    </div>
  )
}
