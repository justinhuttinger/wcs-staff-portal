import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { nps as npsApi } from '../../lib/api'

const SURVEY_BASE = 'https://survey.westcoaststrength.com'

const CLUBS = [
  { number: '30935', name: 'Salem' },
  { number: '31599', name: 'Keizer' },
  { number: '7655', name: 'Eugene' },
  { number: '31598', name: 'Springfield' },
  { number: '31600', name: 'Clackamas' },
  { number: '31601', name: 'Milwaukie' },
  { number: '32073', name: 'Medford' },
]

function clubName(number) {
  return CLUBS.find(c => c.number === number)?.name || number
}

function triggerDownload(href, filename) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function QrRow({ qr, slug, onRotate, rotating }) {
  const canvasRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const url = `${SURVEY_BASE}/${slug}?k=${qr.key}`

  useEffect(() => {
    if (!canvasRef.current) return
    // 1024px bitmap so the downloaded PNG prints at poster size.
    QRCode.toCanvas(canvasRef.current, url, { errorCorrectionLevel: 'H', width: 1024, margin: 2 })
      .then(() => {
        canvasRef.current.style.width = '120px'
        canvasRef.current.style.height = '120px'
      })
      .catch(() => {})
  }, [url])

  function copy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-bg rounded-xl border border-border p-4 flex items-start gap-4">
      <canvas ref={canvasRef} className="rounded-lg shrink-0" style={{ width: '120px', height: '120px' }} />

      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-bold text-text-primary">{clubName(qr.club_number)}</p>

        <div className="flex items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-wcs-red hover:underline truncate">
            {url}
          </a>
          <button type="button" onClick={copy} className="text-[10px] font-semibold text-wcs-red hover:text-wcs-red/70 shrink-0">
            {copied ? <span className="text-green-600 animate-pulse">Copied!</span> : 'Copy'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => triggerDownload(canvasRef.current.toDataURL('image/png'), `${slug}-${clubName(qr.club_number).toLowerCase()}-qr.png`)}
            className="px-3 py-1.5 text-xs font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={() => onRotate(qr)}
            disabled={rotating}
            className="px-3 py-1.5 text-xs font-medium text-text-primary border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
          >
            {rotating ? 'Rotating…' : 'Rotate key'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SurveyQrPanel({ survey, qr, onChanged }) {
  const [club, setClub] = useState('')
  const [busy, setBusy] = useState(false)
  const [rotatingId, setRotatingId] = useState(null)
  const [error, setError] = useState('')

  const active = (qr || []).filter(q => q.active)
  const used = new Set(active.map(q => q.club_number))
  const available = CLUBS.filter(c => !used.has(c.number))

  async function generate() {
    if (!club || busy) return
    setBusy(true)
    setError('')
    try {
      await npsApi.createQr(survey.id, club)
      setClub('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function rotate(row) {
    const label = clubName(row.club_number)
    if (!window.confirm(
      `Rotate the ${label} key?\n\nEvery poster already printed with the old code stops working immediately. You will need to reprint.`
    )) return

    setRotatingId(row.id)
    setError('')
    try {
      await npsApi.rotateQr(row.id)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setRotatingId(null)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Posters</h3>
        <p className="text-xs text-text-muted mt-0.5">
          One code per gym. Each code is unique so responses land against the
          right club, and rotating one retires whatever is already on the wall.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map(row => (
            <QrRow
              key={row.id}
              qr={row}
              slug={survey.slug}
              onRotate={rotate}
              rotating={rotatingId === row.id}
            />
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-text-muted mb-1">Add a gym</label>
            <select
              value={club}
              onChange={e => setClub(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Pick a gym</option>
              {available.map(c => <option key={c.number} value={c.number}>{c.name}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={!club || busy}
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create code'}
          </button>
        </div>
      )}

      {active.length === 0 && (
        <p className="text-xs text-text-muted">No codes yet. Add a gym to create one.</p>
      )}
    </div>
  )
}
