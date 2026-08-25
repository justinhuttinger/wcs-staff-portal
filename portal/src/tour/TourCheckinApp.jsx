import React, { useState, useEffect, useCallback, useRef } from 'react'
import { publicTour } from '../lib/api'
import { buildDayOneUrl } from '../lib/dayOnePrefill'

// 'Custom Pass' is not a plain outcome: choosing it reveals a day picker and
// writes the pass to ABC. It sits in the same grid because that is where staff
// already decide what happened, and a separate control above the outcome was
// easy to miss.
const CUSTOM_PASS = 'Custom Pass'
const OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour', CUSTOM_PASS]
const REFRESH_MS = 2000   // poll fast so a new arrival shows within ~2s (only while the app is open)

// Same per-location photo backgrounds as the mobile app (keyed by lowercase name).
const LOCATION_BACKGROUNDS = {
  salem: '/bg-salem.jpg',
  keizer: '/bg-keizer.jpg',
  eugene: '/bg-eugene.jpg',
  springfield: '/bg-springfield.jpg',
  clackamas: '/bg-clackamas.jpg',
  milwaukie: '/bg-milwaukie.jpg',
  medford: '/bg-medford.jpg',
}

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

const PUSH_SUPPORTED =
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window

// True once the app is running as an installed/standalone app (required for push on iOS).
function isStandalone() {
  return (typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true))
}

// VAPID public key (base64url) -> Uint8Array for pushManager.subscribe.
function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Loud two-tone chime (played twice) when a tour arrives while the app is open.
// iOS blocks audio unless the AudioContext was first resumed inside a user
// gesture, so the caller passes a context that was unlocked on first touch.
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
      g.gain.exponentialRampToValueAtTime(0.6, start + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
      o.start(start); o.stop(start + 0.55)
    }
    beep(now, 880); beep(now + 0.28, 1175)
    beep(now + 0.75, 880); beep(now + 1.03, 1175)
  } catch (e) { /* best-effort */ }
  try { navigator.vibrate?.([200, 100, 200]) } catch (e) { /* best-effort */ }
}

export default function TourCheckinApp({ token }) {
  const [data, setData] = useState({ location_name: '', day_one_base_url: null, vapid_public_key: null, ready: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [permission, setPermission] = useState(PUSH_SUPPORTED ? Notification.permission : 'denied')
  const [notifyError, setNotifyError] = useState('')
  const [flash, setFlash] = useState('') // name shown in the big arrival banner
  const knownIds = useRef(null) // null until first load; then a Set of ready ids
  const audioCtxRef = useRef(null)
  const flashTimer = useRef(null)

  // Unlock audio on the first touch so the chime can play later (iOS requirement).
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx()
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume()
      } catch (e) { /* best-effort */ }
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('touchstart', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
  }, [])

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true)
    setError('')
    try {
      const d = await publicTour.get(token)
      setData(d)
      // Alert on a newly-arrived tour (skip the first load so we don't alert on open).
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

  // If alerts are already granted, re-register this device's subscription on open
  // (keeps it fresh and re-adds it if the server lost it).
  useEffect(() => {
    if (!PUSH_SUPPORTED || permission !== 'granted' || !data.vapid_public_key) return
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => { if (sub) publicTour.subscribe(token, sub.toJSON()).catch(() => {}) })
      .catch(() => {})
  }, [token, data.vapid_public_key, permission])

  async function enableNotifications() {
    setNotifyError('')
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(data.vapid_public_key),
      })
      await publicTour.subscribe(token, sub.toJSON())
    } catch (e) {
      setNotifyError('Could not enable alerts. Make sure the app was added to the Home Screen and opened from there.')
    }
  }

  const showNotifyPrompt = PUSH_SUPPORTED && data.vapid_public_key && permission !== 'granted'
  const list = data.ready
  const bg = LOCATION_BACKGROUNDS[(data.location_name || '').trim().toLowerCase()]

  return (
    <div className="min-h-screen relative">
      {/* Location photo background (same as the mobile app); header + tiles stay white. */}
      <div className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={bg ? { backgroundImage: `url(${bg})` } : { backgroundColor: '#f9fafb' }} />
      <div className="relative z-10">
      {/* Light header bar with dark text (fixes unreadable-on-dark title). */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Tour Check-In</h1>
        <p className="text-sm text-gray-500">
          {data.location_name || 'Front desk'}{list.length ? ` · ${list.length} waiting` : ''}
        </p>
      </div>

      {flash && (
        <button onClick={() => setFlash('')}
          className="w-full bg-red-600 text-white px-5 py-4 text-center font-bold text-lg sticky top-[68px] z-20 animate-pulse active:opacity-90">
          🔔 {flash} just checked in — tap to dismiss
        </button>
      )}

      <div className="px-5 py-5 max-w-2xl mx-auto">
        {showNotifyPrompt && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
            {isStandalone() ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-amber-900">Get an alert when a tour checks in.</span>
                <button onClick={enableNotifications}
                  className="shrink-0 px-3 py-2 rounded-lg bg-amber-600 text-white font-medium active:scale-95">
                  Enable alerts
                </button>
              </div>
            ) : (
              <span className="text-amber-900">
                To get tour alerts on this iPad: tap the Share icon, choose <strong>Add to Home Screen</strong>, then open Tour Check-In from the new icon.
              </span>
            )}
            {notifyError && <p className="text-red-600 mt-2">{notifyError}</p>}
          </div>
        )}
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
          onSaved={(id) => {
            // The server already deleted the row on save — drop the card from
            // local state now so it vanishes with the modal instead of lingering
            // until the refetch returns. The silent load stays as reconciliation.
            setData(d => ({ ...d, ready: (d.ready || []).filter(r => r.id !== id) }))
            setSelected(null)
            load({ silent: true })
          }}
        />
      )}
      </div>
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
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Trial days. Only offered when the kiosk linked an ABC profile to this
  // check-in; a card raised from a GHL survey has nothing to extend.
  const [days, setDays] = useState('10')
  const [givingDays, setGivingDays] = useState(false)
  const [daysResult, setDaysResult] = useState(null)
  const [daysError, setDaysError] = useState('')

  async function giveDays() {
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setDaysError('Enter between 1 and 90 days.')
      return
    }
    setGivingDays(true); setDaysError(''); setDaysResult(null)
    try {
      const r = await publicTour.giveTrialDays(token, intake.id, n)
      setDaysResult(r)
    } catch (e) {
      setDaysError(e.message || 'Could not update ABC.')
    } finally {
      setGivingDays(false)
    }
  }

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
      // Show the success animation briefly, then close + refresh the queue.
      setSaved(true)
      try { navigator.vibrate?.(80) } catch (e) { /* best-effort */ }
      setTimeout(() => onSaved(intake.id), 1300)
    } catch (e) {
      setError(e.message || 'Failed to save'); setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="fixed inset-0 z-[70] bg-white flex flex-col items-center justify-center gap-5">
        <div className="animate-tour-pop w-28 h-28 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
          <svg viewBox="0 0 52 52" className="w-16 h-16" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path className="tour-check-path" d="M14 27 l8 8 l16 -18" />
          </svg>
        </div>
        <p className="animate-tour-pop text-2xl font-bold text-gray-900">Saved!</p>
        <p className="text-sm text-gray-500">{capitalize(intake.contact_name) || 'Tour'} · {outcome}</p>
      </div>
    )
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
            {OUTCOMES.map(o => {
              // Nothing to extend without a linked ABC profile, so the box is
              // there but plainly unavailable rather than silently broken.
              const disabled = o === CUSTOM_PASS && !intake.abc_member_id
              return (
                <button key={o} onClick={() => !disabled && setOutcome(o)} disabled={disabled}
                  title={disabled ? 'No ABC profile linked to this check-in' : undefined}
                  className={`px-3 py-3 rounded-xl text-sm font-medium border transition-colors active:scale-95 ${
                    outcome === o ? 'bg-red-600 text-white border-red-600'
                    : disabled ? 'bg-gray-50 text-gray-400 border-gray-200'
                    : 'bg-white text-gray-700 border-gray-300'}`}>
                  {o}
                </button>
              )
            })}
          </div>

          {outcome === CUSTOM_PASS && (
            <div className="mt-3 rounded-xl border border-gray-200 p-3">
              {daysResult ? (
                <p className="text-sm text-green-700 font-medium">
                  {daysResult.days} days granted — active through{' '}
                  {daysResult.after.expirationDate}, {daysResult.after.visitsAllowed} visits.
                </p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-gray-900 mb-2">How many days?</p>
                  <div className="flex flex-wrap gap-2">
                    {[3, 7, 10, 14, 30].map(d => (
                      <button key={d} type="button" onClick={() => setDays(String(d))}
                        className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors active:scale-95 ${
                          days === String(d) ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-gray-700 border-gray-300'}`}>
                        {d}
                      </button>
                    ))}
                    <input value={days}
                      onChange={e => setDays(e.target.value.replace(/\D+/g, '').slice(0, 2))}
                      inputMode="numeric" aria-label="Number of pass days"
                      className="w-20 px-3 py-2 rounded-xl border border-gray-300 text-sm" />
                    <button type="button" onClick={giveDays} disabled={givingDays}
                      className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-50">
                      {givingDays ? 'Updating…' : 'Give days'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Writes the expiration and visit allowance to ABC, and flags the front
                    desk until 3 days after it ends.
                  </p>
                </>
              )}
              {daysError && <p className="text-sm text-red-600 mt-2">{daysError}</p>}
            </div>
          )}
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
