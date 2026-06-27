import React, { useState, useEffect, useCallback, useRef } from 'react'
import { publicTour } from '../lib/api'
import { buildDayOneUrl } from '../lib/dayOnePrefill'

const OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour']
const REFRESH_MS = 5000   // poll fast so a prefired prospect shows within ~5s

function capitalize(s) {
  if (!s) return ''
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}
function initials(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0][0].toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}
function timeAgo(iso) {
  if (!iso) return ''
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}
const AVATAR_COLORS = ['bg-red-100 text-red-700','bg-blue-100 text-blue-700','bg-green-100 text-green-700','bg-purple-100 text-purple-700','bg-amber-100 text-amber-700','bg-teal-100 text-teal-700']
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}
// Larger avatar than the old mobile tile (w-16 default) for readability on iPad.
function Avatar({ name, photo, size = 'w-16 h-16' }) {
  if (photo) return <img src={photo} alt={name || ''} className={`${size} rounded-full object-cover bg-gray-100`} />
  return <div className={`${size} rounded-full flex items-center justify-center font-bold text-xl ${avatarColor(name)}`}>{initials(name)}</div>
}

export default function TourCheckinApp({ token }) {
  const [data, setData] = useState({ location_name: '', day_one_base_url: null, ready: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true)
    setError('')
    try {
      setData(await publicTour.get(token))
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])
  const ref = useRef(load); ref.current = load
  useEffect(() => {
    const id = setInterval(() => ref.current({ silent: true }), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const list = data.ready

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Light header bar with dark text (fixes unreadable-on-dark title). */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Tour Check-In</h1>
        <p className="text-sm text-gray-500">
          {data.location_name || 'Front desk'}{list.length ? ` · ${list.length} waiting` : ''}
        </p>
      </div>

      <div className="px-5 py-5 max-w-2xl mx-auto">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {loading && <p className="text-center text-gray-400 py-10">Loading…</p>}

        {!loading && list.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
            No one waiting for a tour right now.
          </div>
        )}

        {!loading && (
          <div className="space-y-4">
            {list.map(intake => (
              <button key={intake.id} onClick={() => setSelected(intake)}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-5 active:scale-[0.99] transition-transform shadow-sm">
                <Avatar name={intake.contact_name} photo={intake.photo_base64} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-lg text-gray-900 truncate">{capitalize(intake.contact_name) || 'Unknown'}</p>
                  {intake.contact_phone && <p className="text-sm text-gray-500 truncate">{intake.contact_phone}</p>}
                  {intake.contact_email && <p className="text-sm text-gray-500 truncate">{intake.contact_email}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">Ready for a tour</span>
                  <p className="text-xs text-gray-400 mt-1">{timeAgo(intake.received_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <OutcomeModal
          token={token}
          intake={selected}
          dayOneBaseUrl={data.day_one_base_url}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load({ silent: true }) }}
        />
      )}
    </div>
  )
}

function OutcomeModal({ token, intake, dayOneBaseUrl, onClose, onSaved }) {
  const [employees, setEmployees] = useState([])
  const [tourMember, setTourMember] = useState('')        // asked every tour
  const [outcome, setOutcome] = useState(intake.outcome || '')
  const [notes, setNotes] = useState(intake.notes || '')
  const [showDayOne, setShowDayOne] = useState(false)
  const [iframeFailed, setIframeFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    publicTour.employees(token).then(r => setEmployees(r.employees || [])).catch(() => {})
  }, [token])

  const dayOneUrl = buildDayOneUrl(dayOneBaseUrl, {
    name: intake.contact_name, email: intake.contact_email,
    phone: intake.contact_phone, tourMember,
  })

  async function save() {
    setSaving(true); setError('')
    try {
      await publicTour.saveOutcome(token, intake.id, { tour_member: tourMember, outcome, notes, status: 'completed' })
      onSaved()
    } catch (e) {
      setError(e.message || 'Failed to save'); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-[60] flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
        <Avatar name={intake.contact_name} photo={intake.photo_base64} size="w-12 h-12" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{capitalize(intake.contact_name) || 'Unknown'}</h2>
          {intake.contact_phone && <p className="text-xs text-gray-500 truncate">{intake.contact_phone}</p>}
        </div>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-100" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-gray-900"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6 max-w-2xl mx-auto w-full">
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Tour member</label>
          <select value={tourMember} onChange={e => setTourMember(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:border-red-500">
            <option value="">Select who gave the tour…</option>
            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Tour outcome</label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map(o => (
              <button key={o} onClick={() => setOutcome(o)}
                className={`px-3 py-3 rounded-xl text-sm font-medium border transition-colors active:scale-95 ${outcome === o ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'}`}>
                {o}
              </button>
            ))}
          </div>
        </div>

        {dayOneBaseUrl && (
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Book Day One</label>
            <button onClick={() => { setShowDayOne(true); setIframeFailed(false) }}
              className="w-full py-3 rounded-xl border border-red-300 text-red-600 font-medium active:scale-[0.99]">
              Open Day One calendar
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5}
            placeholder="Questions they had, follow-ups, anything worth remembering…"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-red-500" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="border-t border-gray-200 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
        <button onClick={save} disabled={saving || !outcome}
          className="w-full py-3.5 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50 active:scale-[0.99]">
          {saving ? 'Saving…' : 'Save & complete tour'}
        </button>
      </div>

      {showDayOne && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex flex-col justify-end">
          <div className="bg-white rounded-t-2xl h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <span className="font-semibold text-gray-900">Book Day One</span>
              <div className="flex items-center gap-3">
                <a href={dayOneUrl} target="_blank" rel="noreferrer" className="text-sm text-red-600 font-medium">Open in new tab</a>
                <button onClick={() => setShowDayOne(false)} className="text-sm text-gray-500">Done</button>
              </div>
            </div>
            {iframeFailed
              ? <div className="flex-1 flex items-center justify-center text-center text-gray-500 px-6">
                  <p>This calendar can't be embedded. Use <a href={dayOneUrl} target="_blank" rel="noreferrer" className="text-red-600 underline">Open in new tab</a>.</p>
                </div>
              : <iframe title="Day One" src={dayOneUrl} className="flex-1 w-full" onError={() => setIframeFailed(true)} />}
          </div>
        </div>
      )}
    </div>
  )
}
