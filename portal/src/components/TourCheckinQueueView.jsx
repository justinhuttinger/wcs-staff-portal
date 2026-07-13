import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { tourAdmin, publicTour } from '../lib/api'
import { buildDayOneUrl } from '../lib/dayOnePrefill'

// Native desktop rebuild of the front-desk Tour Check-In queue (the same flow
// the iPad runs), rendered directly in the portal rather than embedded via an
// iframe. Admin-only. Per-location tokens come from the authed admin list
// endpoint; the queue itself is read/written through the token-gated public
// tour API (the only queue API that exists).

const OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour']
const REFRESH_MS = 2000

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
const AVATAR_COLORS = ['bg-red-100 text-red-700', 'bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700', 'bg-teal-100 text-teal-700']
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}
function Avatar({ name, photo, size = 'w-14 h-14' }) {
  if (photo) return <img src={photo} alt={name || ''} className={`${size} rounded-full object-cover bg-gray-100`} />
  return <div className={`${size} rounded-full flex items-center justify-center font-bold text-lg ${avatarColor(name)}`}>{initials(name)}</div>
}

// Two-tone chime played on a new arrival. Needs an AudioContext unlocked inside
// a user gesture (browsers block ungestured audio), so the caller passes one.
function playChime(ctx) {
  try {
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()
    const now = ctx.currentTime
    const beep = (start, freq) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'; o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(0.5, start + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
      o.start(start); o.stop(start + 0.55)
    }
    beep(now, 880); beep(now + 0.28, 1175)
  } catch { /* best-effort */ }
}

export default function TourCheckinQueueView({ location }) {
  const [rows, setRows] = useState([])
  const [locLoading, setLocLoading] = useState(true)
  const [locError, setLocError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let alive = true
    setLocLoading(true); setLocError('')
    tourAdmin.list()
      .then(r => {
        if (!alive) return
        const locs = r.locations || []
        setRows(locs)
        const match = locs.find(l => (l.name || '').toLowerCase() === (location || '').toLowerCase())
        setSelectedId((match || locs[0])?.location_id ?? null)
      })
      .catch(e => { if (alive) setLocError(e.message || 'Failed to load locations') })
      .finally(() => { if (alive) setLocLoading(false) })
    return () => { alive = false }
  }, [location])

  const selected = useMemo(() => rows.find(r => r.location_id === selectedId) || null, [rows, selectedId])
  const token = selected?.public_token || ''

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-10">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-bold text-text-primary">Tour Check-In</h2>
          <p className="text-sm text-text-muted">Live front-desk tour queue.</p>
        </div>
        {rows.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-text-muted">Location</span>
            <select
              value={selectedId ?? ''}
              onChange={e => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            >
              {rows.map(r => <option key={r.location_id} value={r.location_id}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {locLoading ? (
        <Card>Loading…</Card>
      ) : locError ? (
        <Card tone="error">{locError}</Card>
      ) : !token ? (
        <Card>No check-in link is configured for this location yet. Set one up under Admin → Tour Check-In.</Card>
      ) : (
        <Queue key={token} token={token} />
      )}
    </div>
  )
}

function Card({ children, tone }) {
  const color = tone === 'error' ? 'text-wcs-red' : 'text-text-muted'
  return <p className={`${color} text-sm bg-surface/95 border border-border rounded-xl px-4 py-8 text-center`}>{children}</p>
}

function Queue({ token }) {
  const [data, setData] = useState({ location_name: '', day_one_base_url: null, ready: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [flash, setFlash] = useState('')
  const knownIds = useRef(null)
  const audioCtxRef = useRef(null)
  const flashTimer = useRef(null)

  // Unlock audio on the first interaction so the arrival chime can play later.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx()
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume()
      } catch { /* best-effort */ }
    }
    window.addEventListener('pointerdown', unlock)
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true)
    setError('')
    try {
      const d = await publicTour.get(token)
      setData(d)
      const ready = d.ready || []
      const ids = new Set(ready.map(r => r.id))
      if (knownIds.current) {
        const arrived = ready.find(r => !knownIds.current.has(r.id))
        if (arrived) {
          playChime(audioCtxRef.current)
          setFlash(capitalize(arrived.contact_name) || 'New tour')
          clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlash(''), 6000)
        }
      }
      knownIds.current = ids
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => () => clearTimeout(flashTimer.current), [])
  useEffect(() => { load() }, [load])
  const ref = useRef(load); ref.current = load
  useEffect(() => {
    const id = setInterval(() => ref.current({ silent: true }), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const list = data.ready || []

  return (
    <div className="space-y-4">
      {flash && (
        <button
          onClick={() => setFlash('')}
          className="w-full bg-wcs-red text-white px-5 py-3 rounded-xl text-center font-bold animate-pulse"
        >
          🔔 {flash} just checked in — click to dismiss
        </button>
      )}

      {error && <Card tone="error">{error}</Card>}
      {loading && <Card>Loading…</Card>}

      {!loading && list.length === 0 && (
        <Card>No one waiting for a tour right now.</Card>
      )}

      {!loading && list.map(intake => (
        <button
          key={intake.id}
          onClick={() => setSelected(intake)}
          className="w-full text-left bg-surface border border-border rounded-2xl p-5 flex items-center gap-5 transition-all hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <Avatar name={intake.contact_name} photo={intake.photo_base64} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg text-text-primary truncate">{capitalize(intake.contact_name) || 'Unknown'}</p>
            {intake.contact_phone && <p className="text-sm text-text-muted truncate">{intake.contact_phone}</p>}
            {intake.contact_email && <p className="text-sm text-text-muted truncate">{intake.contact_email}</p>}
          </div>
          <div className="shrink-0 text-right">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">Ready for a tour</span>
            <p className="text-xs text-text-muted mt-1">{timeAgo(intake.received_at)}</p>
          </div>
        </button>
      ))}

      {selected && (
        <OutcomeModal
          token={token}
          intake={selected}
          dayOneBaseUrl={data.day_one_base_url}
          onClose={() => setSelected(null)}
          onSaved={() => {
            // Drop the completed tour from the list instantly so it doesn't
            // linger at the top until the next poll (the row is already deleted
            // server-side on save). Also forget its id so it can't re-alert.
            const doneId = selected.id
            setData(d => ({ ...d, ready: (d.ready || []).filter(r => r.id !== doneId) }))
            knownIds.current?.delete(doneId)
            setSelected(null)
            load({ silent: true })
          }}
        />
      )}
    </div>
  )
}

function OutcomeModal({ token, intake, dayOneBaseUrl, onClose, onSaved }) {
  const [employees, setEmployees] = useState([])
  const [tourMember, setTourMember] = useState('')
  const [outcome, setOutcome] = useState(intake.outcome || '')
  const [notes, setNotes] = useState(intake.notes || '')
  const [referrer, setReferrer] = useState(null) // { member_id, name } | null — VIP referrals
  const [showDayOne, setShowDayOne] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const isVip = outcome === 'Started VIP Pass'

  useEffect(() => {
    publicTour.employees(token).then(r => setEmployees(r.employees || [])).catch(() => {})
  }, [token])

  // The referring member only applies to a VIP Pass; drop it if the outcome changes.
  useEffect(() => { if (!isVip) setReferrer(null) }, [isVip])

  const dayOneUrl = buildDayOneUrl(dayOneBaseUrl, {
    name: intake.contact_name, email: intake.contact_email,
    phone: intake.contact_phone, tourMember,
  })

  async function save() {
    setSaving(true); setError('')
    try {
      await publicTour.saveOutcome(token, intake.id, {
        tour_member: tourMember, outcome, notes, status: 'completed',
        referring_member_id: referrer?.member_id || null,
        referring_member_name: referrer?.name || null,
      })
      setSaved(true)
      setTimeout(() => onSaved(), 1100)
    } catch (e) {
      setError(e.message || 'Failed to save'); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl border border-border w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {saved ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 52 52" className="w-14 h-14" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 27 l8 8 l16 -18" />
              </svg>
            </div>
            <p className="text-2xl font-bold text-text-primary">Saved!</p>
            <p className="text-sm text-text-muted">{capitalize(intake.contact_name) || 'Tour'} · {outcome}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
              <Avatar name={intake.contact_name} photo={intake.photo_base64} size="w-11 h-11" />
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-text-primary truncate">{capitalize(intake.contact_name) || 'Unknown'}</h3>
                {intake.contact_phone && <p className="text-xs text-text-muted truncate">{intake.contact_phone}</p>}
              </div>
              <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none" aria-label="Close">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Tour member</label>
                <select value={tourMember} onChange={e => setTourMember(e.target.value)}
                  className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-wcs-red">
                  <option value="">Select who gave the tour…</option>
                  {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Tour outcome</label>
                <div className="grid grid-cols-2 gap-2">
                  {OUTCOMES.map(o => (
                    <button key={o} onClick={() => setOutcome(o)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${outcome === o ? 'bg-wcs-red text-white border-wcs-red' : 'bg-surface text-text-secondary border-border hover:border-text-muted'}`}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              {isVip && (
                <div>
                  <label className="block text-sm font-semibold text-text-primary mb-2">Referring member</label>
                  <ReferrerPicker value={referrer} onChange={setReferrer} />
                  <p className="mt-1 text-xs text-text-muted">Who referred them? Search active members by name, phone, or email.</p>
                </div>
              )}

              {dayOneBaseUrl && (
                <div>
                  <label className="block text-sm font-semibold text-text-primary mb-2">Book Day One</label>
                  <button onClick={() => setShowDayOne(true)}
                    className="w-full py-2.5 rounded-xl border border-wcs-red/40 text-wcs-red font-medium hover:bg-wcs-red/5">
                    Open Day One calendar
                  </button>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                  placeholder="Questions they had, follow-ups, anything worth remembering…"
                  className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-wcs-red" />
              </div>

              {error && <p className="text-sm text-wcs-red">{error}</p>}
            </div>

            <div className="border-t border-border p-4 shrink-0">
              <button onClick={save} disabled={saving || !outcome}
                className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save & complete tour'}
              </button>
            </div>
          </>
        )}
      </div>

      {showDayOne && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDayOne(false)}>
          <div className="bg-surface rounded-2xl border border-border w-full max-w-2xl flex flex-col overflow-hidden" style={{ height: 'min(88vh, 880px)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="font-semibold text-text-primary">Book Day One</span>
              <div className="flex items-center gap-3">
                <a href={dayOneUrl} target="_blank" rel="noreferrer" className="text-sm text-wcs-red font-medium hover:underline">Open in new tab ↗</a>
                <button onClick={() => setShowDayOne(false)} className="text-text-muted hover:text-text-primary text-2xl leading-none" aria-label="Close">&times;</button>
              </div>
            </div>
            <iframe title="Book Day One" src={dayOneUrl} className="flex-1 w-full border-0 bg-white" />
          </div>
        </div>
      )}
    </div>
  )
}

// Debounced member search for the VIP-pass referring member. Searches active
// ABC members across all clubs (name / phone / email) via the authed admin
// endpoint. `value` is the chosen { member_id, name } or null.
function ReferrerPicker({ value, onChange }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (value) return // a member is picked; don't keep searching
    const term = query.trim()
    if (term.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await tourAdmin.searchReferrers(term)
        setResults(r.members || [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, value])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
        <span className="text-sm font-medium text-text-primary truncate">{value.name}</span>
        <button
          onClick={() => { onChange(null); setQuery(''); setResults([]) }}
          className="text-text-muted hover:text-wcs-red text-xl leading-none shrink-0"
          aria-label="Clear referring member"
        >
          &times;
        </button>
      </div>
    )
  }

  const showDropdown = open && query.trim().length >= 2
  return (
    <div className="relative">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        placeholder="Search by name, phone, or email…"
        className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-wcs-red"
      />
      {showDropdown && (
        <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
          {loading && <p className="px-3 py-2 text-sm text-text-muted">Searching…</p>}
          {!loading && results.map(m => {
            const name = `${m.first_name || ''} ${m.last_name || ''}`.trim()
            const sub = [m.phone, m.email, m.home_club].filter(Boolean).join(' · ')
            return (
              <button
                key={m.member_id}
                onClick={() => { onChange({ member_id: m.member_id, name }); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-bg border-b border-border last:border-0"
              >
                <p className="text-sm font-medium text-text-primary truncate">{name || 'Unknown'}</p>
                {sub && <p className="text-xs text-text-muted truncate">{sub}</p>}
              </button>
            )
          })}
          {!loading && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-text-muted">No matches</p>
          )}
        </div>
      )}
    </div>
  )
}
