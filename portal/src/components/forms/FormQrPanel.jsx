import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

const PUBLIC_FORMS_BASE = import.meta.env.VITE_PUBLIC_FORMS_URL || 'https://forms.westcoaststrength.com'

// Render a plain QR to the given canvas. Kept at a 1024px bitmap so PNG
// downloads stay crisp; the on-screen size is controlled by CSS.
async function drawQrCanvas(canvas, url) {
  await QRCode.toCanvas(canvas, url, { errorCorrectionLevel: 'H', width: 1024, margin: 2 })
}

// Build the plain QR SVG string.
async function buildQrSvg(url) {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 2 })
}

function triggerDownload(href, filename) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export default function FormQrPanel({ form }) {
  const canvasRef = useRef(null)
  const [copiedField, setCopiedField] = useState(null)
  const [busy, setBusy] = useState(false)

  const published = form?.status === 'published'
  const slug = form?.slug || ''
  const url = `${PUBLIC_FORMS_BASE}/f/${slug}`

  useEffect(() => {
    if (!published || !slug || !canvasRef.current) return
    drawQrCanvas(canvasRef.current, url).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published, slug])

  function copyToClipboard(text, fieldKey) {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldKey)
    setTimeout(() => setCopiedField(null), 1500)
  }

  function downloadPng() {
    const canvas = canvasRef.current
    if (!canvas) return
    triggerDownload(canvas.toDataURL('image/png'), `${slug}-qr.png`)
  }

  async function downloadSvg() {
    if (busy) return
    setBusy(true)
    try {
      const svg = await buildQrSvg(url)
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const objectUrl = URL.createObjectURL(blob)
      triggerDownload(objectUrl, `${slug}-qr.svg`)
      URL.revokeObjectURL(objectUrl)
    } finally {
      setBusy(false)
    }
  }

  if (!published) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">Publish this form to get its QR code.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary">QR code and signage</h3>
        <p className="text-xs text-text-muted mt-0.5">Download a QR code that opens this form.</p>
      </div>

      {/* Public URL with copy */}
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="font-semibold">Public link:</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-wcs-red hover:underline truncate">{url}</a>
        <button
          type="button"
          onClick={() => copyToClipboard(url, 'qr-url')}
          className="text-wcs-red hover:text-wcs-red/70 transition-colors relative shrink-0"
          title="Copy link"
        >
          {copiedField === 'qr-url' ? (
            <span className="text-[10px] text-green-600 font-semibold animate-pulse">Copied!</span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
            </svg>
          )}
        </button>
      </div>

      {/* Preview */}
      <div className="bg-bg rounded-xl border border-border p-6 flex flex-col items-center gap-4">
        <canvas
          ref={canvasRef}
          className="rounded-lg max-w-full"
          style={{ width: '160px', height: '160px' }}
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={downloadPng}
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
          >
            {busy ? 'Preparing...' : 'Download SVG'}
          </button>
        </div>
      </div>

      <p className="text-xs text-text-muted">Print the PNG. Use the SVG for OptiSigns and large signage.</p>
    </div>
  )
}
