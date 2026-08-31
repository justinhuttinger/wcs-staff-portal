import { useState, useEffect, useMemo, useCallback } from 'react'
import { getTillMovements, createTillMovement, voidTillMovement } from '../lib/api'
import { LOCATION_OPTIONS } from '../config/locations'
import { roleAtLeast } from '../lib/roles'

// Till — cash in and out of the drawer.
//
// Whoever pulls $200 for the bank taps it in here, and the nightly
// reconciliation subtracts it from what the drawer should hold. This replaces
// ringing the ABC "Cash Drop" POS item, which was easy to skip and which ABC
// books as a sale (inflating Revenue and POS Sales by the amount of the drop).
//
// Lead+, scoped to the clubs on the person's staff profile. Nothing here shows
// variance — over/short lives in the manager-only Till report.

// Mirrors REASONS in auth/src/lib/tillMovements.js. The server re-validates, so
// this list is for the picker; a mismatch fails the request rather than saving
// something the reconciler cannot label.
const REASONS = {
  out: [
    { key: 'bank_drop', label: 'Bank drop' },
    { key: 'to_safe', label: 'To the safe' },
    { key: 'payout', label: 'Payout / expense', needsNote: true },
    { key: 'other', label: 'Other', needsNote: true },
  ],
  in: [
    { key: 'from_safe', label: 'Change from the safe' },
    { key: 'float_topup', label: 'Float top-up' },
    { key: 'other', label: 'Other', needsNote: true },
  ],
}

const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const reasonLabel = (direction, key) =>
  (REASONS[direction] || []).find(r => r.key === key)?.label || key

// Pacific calendar date, so "today" matches the business date the server stamps.
function pacificToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
function prettyDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US',
    { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function prettyTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red/30'

export default function TillCashView({ onBack, user, location }) {
  const canSeeAllClubs = ['corporate', 'marketing', 'director', 'admin'].includes(user?.staff?.role)
  const isManager = roleAtLeast(user?.staff?.role, 'manager')
  const today = pacificToday()

  // A drawer belongs to one club, so there is no "all" here — you are always
  // logging cash for a specific till.
  const clubs = useMemo(() => {
    const all = LOCATION_OPTIONS.filter(o => o.slug !== 'all')
    if (canSeeAllClubs) return all
    const mine = (user?.staff?.locations || []).map(l => String(l.name || '').toLowerCase())
    const scoped = all.filter(o => mine.includes(o.slug))
    if (scoped.length) return scoped
    // Fall back to the club this session is signed in at, so somebody whose
    // profile has no locations still gets a usable screen.
    return all.filter(o => o.slug === String(location || '').toLowerCase())
  }, [canSeeAllClubs, user, location])

  const [slug, setSlug] = useState(() => {
    const home = String(location || '').toLowerCase()
    return clubs.find(c => c.slug === home)?.slug || clubs[0]?.slug || ''
  })

  const [direction, setDirection] = useState('out')
  const [reason, setReason] = useState('bank_drop')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [businessDate, setBusinessDate] = useState(today)

  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  // Switching direction resets the reason: the two lists barely overlap, and a
  // stale 'from_safe' on a cash-out would just 400.
  function pickDirection(next) {
    setDirection(next)
    setReason(REASONS[next][0].key)
  }

  const spec = (REASONS[direction] || []).find(r => r.key === reason)
  const needsNote = !!spec?.needsNote

  // The last week, so a movement logged late (or a night that ran past
  // midnight) is still visible next to today's.
  const from = useMemo(() => {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 6)
    return d.toISOString().slice(0, 10)
  }, [today])

  const load = useCallback(() => {
    if (!slug) { setRows([]); return }
    setLoading(true); setError('')
    getTillMovements({ location_slug: slug, from, to: today })
      .then(r => setRows(r.movements || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug, from, today])

  useEffect(() => { load() }, [load])

  // A flash message clears itself so the screen is ready for the next entry.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(''), 4000)
    return () => clearTimeout(t)
  }, [flash])

  async function submit(e) {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    if (needsNote && !note.trim()) { setError(`A note is required when the reason is "${spec.label}".`); return }
    setSaving(true); setError('')
    try {
      await createTillMovement({
        location_slug: slug, direction, reason, amount: amt,
        note: note.trim() || undefined,
        business_date: businessDate,
      })
      setFlash(`${direction === 'out' ? 'Took' : 'Added'} ${money(amt)} ${direction === 'out' ? 'out of' : 'to'} the drawer.`)
      setAmount(''); setNote('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function doVoid(row) {
    const why = window.prompt('Why is this entry being voided?')
    if (why === null) return
    if (!why.trim()) { setError('A reason is required to void an entry.'); return }
    setError('')
    try {
      await voidTillMovement(row.id, why.trim())
      setFlash('Entry voided. It no longer counts toward tonight’s close.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const live = (rows || []).filter(r => !r.voided_at)
  const todays = live.filter(r => String(r.business_date).slice(0, 10) === today)
  const todayOut = todays.filter(r => r.direction === 'out').reduce((a, r) => a + Number(r.amount || 0), 0)
  const todayIn = todays.filter(r => r.direction === 'in').reduce((a, r) => a + Number(r.amount || 0), 0)

  // Group the week's entries by business date, newest day first.
  const byDate = useMemo(() => {
    const m = new Map()
    for (const r of (rows || [])) {
      const d = String(r.business_date).slice(0, 10)
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(r)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [rows])

  // A lead may take back their own entry while it is still today's; anything
  // older, or anyone else's, needs a manager. Mirrors routes/till.js.
  function canVoid(row) {
    if (row.voided_at) return false
    if (isManager) return true
    return String(row.created_by || '') === String(user?.staff?.id || '')
      && String(row.business_date).slice(0, 10) === today
  }

  return (
    <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 pb-12">
      {/* Header */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border px-4 py-2.5 mb-3 flex items-center gap-3 flex-wrap">
        <button onClick={onBack}
          className="press-hide-back text-sm text-tile-sub hover:text-text-primary shrink-0">&larr; Back</button>
        <span className="text-border" aria-hidden="true">|</span>
        <h2 className="text-sm font-bold text-text-primary">Till &mdash; Cash In / Out</h2>
        {clubs.length > 1 && (
          <select value={slug} onChange={e => setSlug(e.target.value)}
            className="ml-auto px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-xs">
            {clubs.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select>
        )}
      </div>

      {clubs.length === 0 ? (
        <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-8 text-center">
          No club is assigned to your profile, so there is no drawer to log against. Ask an admin to add your location.
        </p>
      ) : (
      <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-4 items-start">
        {/* --- Entry form --- */}
        <form onSubmit={submit} className="bg-surface rounded-xl border border-border p-4 space-y-4">
          {/* Direction */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'out', label: 'Cash OUT', hint: 'Money leaving the drawer' },
              { key: 'in', label: 'Cash IN', hint: 'Money added to the drawer' },
            ].map(d => (
              <button key={d.key} type="button" onClick={() => pickDirection(d.key)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  direction === d.key
                    ? 'border-wcs-red bg-wcs-red/10 text-text-primary'
                    : 'border-border bg-bg text-text-muted hover:text-text-primary'}`}>
                <span className="block text-sm font-bold">{d.label}</span>
                <span className="block text-[11px] leading-tight mt-0.5">{d.hint}</span>
              </button>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-lg">$</span>
              <input
                type="number" inputMode="decimal" step="0.01" min="0" required
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className={inputCls + ' pl-7 text-2xl font-bold py-3'}
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className={inputCls}>
              {REASONS[direction].map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
              Note {needsNote ? <span className="text-wcs-red">(required)</span> : <span className="normal-case font-normal">(optional)</span>}
            </label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500}
              placeholder={needsNote ? 'What was this for?' : 'Anything worth remembering'}
              className={inputCls} />
          </div>

          {/* Business date — normally today; backdating covers a close that ran
              past midnight or an entry someone forgot until the morning. */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Business day</label>
            <input type="date" value={businessDate} max={today}
              onChange={e => setBusinessDate(e.target.value)} className={inputCls} />
            {businessDate !== today && (
              <p className="text-[11px] text-amber-600 mt-1">Backdated to {prettyDate(businessDate)}.</p>
            )}
          </div>

          <button type="submit" disabled={saving || !slug}
            className="w-full px-4 py-3 rounded-lg bg-wcs-red text-white text-sm font-bold hover:bg-wcs-red/90 disabled:opacity-50 transition-colors">
            {saving ? 'Recording...' : direction === 'out' ? 'Record cash out' : 'Record cash in'}
          </button>

          {flash && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{flash}</p>}
          {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}
        </form>

        {/* --- Today + the week --- */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Out today</p>
              <p className="text-2xl font-bold mt-1 text-text-primary">{money(todayOut)}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">In today</p>
              <p className="text-2xl font-bold mt-1 text-text-primary">{money(todayIn)}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Net off the drawer</p>
              <p className="text-2xl font-bold mt-1 text-text-primary">{money(todayOut - todayIn)}</p>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-bg/50">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Last 7 days</p>
            </div>
            {loading && rows === null && <p className="text-sm text-text-muted p-8 text-center">Loading...</p>}
            {rows && rows.length === 0 && (
              <p className="text-sm text-text-muted p-8 text-center">Nothing has come out of this drawer in the last week.</p>
            )}
            {byDate.map(([date, entries]) => (
              <div key={date}>
                <p className="px-4 py-1.5 text-xs font-semibold text-text-muted bg-bg/30 border-b border-border/50">
                  {prettyDate(date)}{date === today ? ' (today)' : ''}
                </p>
                {entries.map(r => (
                  <div key={r.id}
                    className={`px-4 py-2.5 border-b border-border/50 flex items-start gap-3 ${r.voided_at ? 'opacity-60' : ''}`}>
                    <span className={`mt-0.5 shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      r.direction === 'out' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {r.direction}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm text-text-primary ${r.voided_at ? 'line-through' : ''}`}>
                        <span className="font-semibold">{money(r.amount)}</span>
                        <span className="text-text-muted"> &middot; {reasonLabel(r.direction, r.reason)}</span>
                      </p>
                      {r.note && <p className="text-xs text-text-muted mt-0.5 break-words">{r.note}</p>}
                      <p className="text-[11px] text-text-muted mt-0.5">
                        {r.created_by_name || 'Unknown'}{r.created_at ? ` at ${prettyTime(r.created_at)}` : ''}
                      </p>
                      {r.voided_at && (
                        <p className="text-[11px] text-wcs-red mt-0.5">
                          Voided by {r.voided_by_name || 'a manager'}{r.void_reason ? ` — ${r.void_reason}` : ''}
                        </p>
                      )}
                    </div>
                    {canVoid(r) && (
                      <button onClick={() => doVoid(r)}
                        className="shrink-0 text-xs text-text-muted hover:text-wcs-red transition-colors">
                        Void
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted px-1">
            Anything logged here comes off what the drawer should hold at close, so the
            count reconciles. Entries are never deleted &mdash; a mistake gets voided and
            stays on the record.
          </p>
        </div>
      </div>
      )}
    </div>
  )
}
