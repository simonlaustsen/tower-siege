import QRCode from 'qrcode'
import { useEffect, useRef } from 'react'

/** Draws `text` as a QR code. Large and high-contrast, so another phone's camera can read it easily. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current) return
    // Drawn at twice the displayed size so it stays crisp on high-density screens.
    void QRCode.toCanvas(ref.current, text, {
      errorCorrectionLevel: 'L', // fewer, bigger squares are easier to scan than a sturdier, denser code
      margin: 2,
      width: 720,
      color: { dark: '#14213d', light: '#ffffff' },
    }).catch(() => {})
  }, [text])

  return <canvas ref={ref} className="qr" role="img" aria-label={label} />
}
