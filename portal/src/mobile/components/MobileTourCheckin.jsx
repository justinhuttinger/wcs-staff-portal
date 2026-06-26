import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getTourIntakes, updateTourIntake } from '../../lib/api'
import MobileLoading from './MobileLoading'

// Outcomes staff can record after walking a prospect through the gym. Covers
// the common front-desk results: did they start a trial, book a Day One, etc.
const OUTCOMES = [
  'Joined',
  'Started Trial',
  'Booked Day One',
  'Thinking It Over',
  'Not Interested',
]

const REFRESH_MS = 20000 // keep the iPad queue fresh without a manual reload

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function timeAgo(iso) {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString()
}

// Deterministic accent color for the initials avatar, keyed off the name.
const AVATAR_COLORS = [
  'bg-red-100 text-red-700',
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-teal-100 text-teal-700',
]
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}

function Avatar({ name, photo, size = 'w-14 h-14' }) {
  if (photo) {
    return <img src={photo} alt={name || ''} className={`${size} rounded-full object-cover bg-bg`} />
  }
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-bold text-lg ${avatarColor(name)}`}>
      {initials(name)}
    </div>
  )
}

export default function MobileTourCheckin({ user }) {
  const locations = user?.staff?.locations || []
  const primary = locations.find(l => l.is_primary) || locations[0] || null
  const [locationId, setLocationId] = useState(primary?.id || '')
  const [tab, setTab] = useState('ready') // 'ready' | 'completed'
  const [intakes, setIntakes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)

  const fetchIntakes = useCallback(async (opts = {}) => {
    if (!locationId) { setLoading(false); return }
    if (!opts.silent) setLoading(true)
    setError('')
    try {
      const res = await getTourIntakes({ location_id: locationId, status: tab })
      setIntakes(res.tour_intakes || [])
    } catch (err) {
      setError(err.message || 'Failed to load tours')
    } finally {
      setLoading(false)
    }
  }, [locationId, tab])

  useEffect(() => { fetchIntakes() }, [fetchIntakes])

  // Background poll so newly-arrived prospects appear without a manual reload.
  const fetchRef = useRef(fetchIntakes)
  fetchRef.current = fetchIntakes
  useEffect(() => {
    const id = setInterval(() => fetchRef.current({ silent: true }), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  function handleSaved(updated) {
    setSelected(null)
    // Drop it from the ready list immediately; refetch keeps counts honest.
    setIntakes(prev => prev.filter(i => i.id !== updated.id))
    fetchIntakes({ silent: true })
  }

  const readyCount = tab === 'ready' ? intakes.length : null

  return (
    <div className="px-4 pt-6 pb-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">Tour Check-In</h1>
        <p className="text-sm text-text-muted">Front-desk gym tour queue</p>
      </div>

      {/* Location selector (only when staff cover more than one club) */}
      {locations.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {locations.map(loc => (
            <button
              key={loc.id}
              onClick={() => setLocationId(loc.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                locationId === loc.id
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border'
              }`}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {/* Ready / Completed tabs */}
      <div className="flex gap-1 bg-bg rounded-lg p-1 mb-4">
        {['ready', 'completed'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
            }`}
          >
            {t}{t === 'ready' && readyCount ? ` (${readyCount})` : ''}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-wcs-red mb-3">{error}</p>}
      {loading && <MobileLoading />}

      {!loading && intakes.length === 0 && (
        <div className="bg-surface border border-border rounded-2xl p-8 text-center text-text-muted text-sm">
          {tab === 'ready' ? 'No one waiting for a tour right now.' : 'No completed tours yet.'}
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {intakes.map(intake => (
            <button
              key={intake.id}
              onClick={() => setSelected(intake)}
              className="w-full text-left bg-surface border border-border rounded-2xl p-4 flex items-center gap-4 active:scale-[0.99] transition-transform"
            >
              <Avatar name={intake.contact_name} photo={intake.photo_base64} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary truncate">
                  {capitalize(intake.contact_name) || 'Unknown'}
                </p>
                {intake.contact_phone && <p className="text-xs text-text-muted truncate">{intake.contact_phone}</p>}
                {intake.contact_email && <p className="text-xs text-text-muted truncate">{intake.contact_email}</p>}
              </div>
              <div className="shrink-0 text-right">
                {tab === 'ready' ? (
                  <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                    Ready for a tour
                  </span>
                ) : (
                  intake.outcome && (
                    <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-bg text-text-secondary border border-border">
                      {intake.outcome}
                    </span>
                  )
                )}
                <p className="text-[10px] text-text-muted mt-1">{timeAgo(intake.received_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <TourOutcomeModal
          intake={selected}
          readOnly={tab === 'completed'}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

function TourOutcomeModal({ intake, readOnly, onClose, onSaved }) {
  const [outcome, setOutcome] = useState(intake.outcome || '')
  const [notes, setNotes] = useState(intake.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(status) {
    setSaving(true)
    setError('')
    try {
      const res = await updateTourIntake(intake.id, { status, outcome, notes })
      onSaved(res.tour_intake || intake)
    } catch (err) {
      setError(err.message || 'Failed to save. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-surface z-[60] flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Avatar name={intake.contact_name} photo={intake.photo_base64} size="w-11 h-11" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-text-primary truncate">
            {capitalize(intake.contact_name) || 'Unknown'}
          </h2>
          {intake.contact_phone && <p className="text-xs text-text-muted truncate">{intake.contact_phone}</p>}
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-bg"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-text-primary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* Contact details */}
        <div className="rounded-2xl bg-bg p-4 space-y-2">
          {intake.contact_email && (
            <DetailRow label="Email" value={intake.contact_email} href={`mailto:${intake.contact_email}`} />
          )}
          {intake.contact_phone && (
            <DetailRow label="Phone" value={intake.contact_phone} href={`tel:${intake.contact_phone}`} />
          )}
        </div>

        {/* Outcome */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Tour outcome</label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map(o => (
              <button
                key={o}
                disabled={readOnly}
                onClick={() => setOutcome(o)}
                className={`px-3 py-3 rounded-xl text-sm font-medium border transition-colors ${
                  outcome === o
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-secondary border-border'
                } ${readOnly ? 'opacity-70' : 'active:scale-95'}`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            readOnly={readOnly}
            rows={5}
            placeholder="Questions they had, follow-ups, anything worth remembering…"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-wcs-red"
          />
        </div>

        {error && <p className="text-sm text-wcs-red">{error}</p>}
      </div>

      {!readOnly && (
        <div className="border-t border-border p-4 space-y-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
          <button
            onClick={() => save('completed')}
            disabled={saving || !outcome}
            className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
          >
            {saving ? 'Saving…' : 'Save & complete tour'}
          </button>
          <button
            onClick={() => save('cancelled')}
            disabled={saving}
            className="w-full py-2.5 rounded-xl border border-border text-text-muted text-sm font-medium disabled:opacity-50"
          >
            Remove from queue
          </button>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, href }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      {href ? (
        <a href={href} className="text-wcs-red font-medium truncate max-w-[60%] text-right">{value}</a>
      ) : (
        <span className="text-text-primary truncate max-w-[60%] text-right">{value}</span>
      )}
    </div>
  )
}
