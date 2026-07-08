import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

const PUBLIC_FORMS_BASE = import.meta.env.VITE_PUBLIC_FORMS_URL || 'https://forms.westcoaststrength.com'
const LOGO_SRC = '/wcs-logo.png'

// Load the logo image once. Resolves to an HTMLImageElement, or null if it fails.
function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = LOGO_SRC
  })
}

// Render the QR to the given canvas at 1024px, then overlay the logo (if it loads)
// centered at 20% width over a white rounded pad. Never throws on logo failure.
async function drawQrCanvas(canvas, url) {
  await QRCode.toCanvas(canvas, url, { errorCorrectionLevel: 'H', width: 1024, margin: 2 })
  const logo = await loadLogo()
  if (!logo) return // plain QR, no logo
  const ctx = canvas.getContext('2d')
  const size = canvas.width * 0.2
  const x = (canvas.width - size) / 2
  const pad = size * 0.12
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(x - pad, x - pad, size + pad * 2, size + pad * 2, pad)
  ctx.fill()
  ctx.drawImage(logo, x, x, size, size)
}

// Draw the logo to an offscreen canvas and return a PNG data URL, or null on failure.
async function buildLogoDataUrl() {
  const logo = await loadLogo()
  if (!logo) return null
  const off = document.createElement('canvas')
  off.width = logo.naturalWidth || logo.width || 256
  off.height = logo.naturalHeight || logo.height || 256
  const ctx = off.getContext('2d')
  ctx.drawImage(logo, 0, 0, off.width, off.height)
  try {
    return off.toDataURL('image/png')
  } catch {
    return null
  }
}

// Build the QR SVG string, injecting a centered logo (white rounded pad + <image>)
// sized from the viewBox. Falls back to the plain QR SVG if the logo can't load.
async function buildQrSvg(url) {
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 2 })
  const logoDataUrl = await buildLogoDataUrl()
  if (!logoDataUrl) return svg

  const viewBoxMatch = svg.match(/viewBox="([\d.\s-]+)"/)
  if (!viewBoxMatch) return svg
  const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number)
  const vb = parts[2] // viewBox width (square QR)
  if (!vb || Number.isNaN(vb)) return svg

  const size = vb * 0.2
  const x = (vb - size) / 2
  const pad = size * 0.12
  const overlay =
    `<rect x="${x - pad}" y="${x - pad}" width="${size + pad * 2}" height="${size + pad * 2}" rx="${pad}" ry="${pad}" fill="#ffffff"/>` +
    `<image href="${logoDataUrl}" x="${x}" y="${x}" width="${size}" height="${size}"/>`
  return svg.replace('</svg>', `${overlay}</svg>`)
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
        <p className="text-xs text-text-muted mt-0.5">Download a branded QR code that opens this form.</p>
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
          className="rounded-lg"
          style={{ width: '256px', height: '256px' }}
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
