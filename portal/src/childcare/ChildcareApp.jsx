import { useState, useEffect, useCallback } from 'react'
import { publicChildcare } from '../lib/api'

// Login-free childcare check-in for one club, opened from its secret link
// (/childcare.html?token=...). Everything is typed by the desk on the day:
// no member lookup and no saved families, so each visit stands on its own.
// Opened with ?view= instead of ?token=, the same board is read-only: who is
// in the room now, no phones, no check-in or check-out.

// Short enough that two iPads in the same room agree within moments.
const REFRESH_MS = 15 * 1000

const inputCls = 'w-full border border-border rounded-lg px-3 py-2.5 text-base bg-surface text-text-primary'
const labelCls = 'block text-xs font-medium text-text-muted mb-1'

const childName = v => `${v.child_first_name} ${v.child_last_name}`
const parentName = v => `${v.parent_first_name} ${v.parent_last_name}`

function fmtAge(months) {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  if (m === 0) return `${y} yr${y === 1 ? '' : 's'}`
  return `${y} yr ${m} mo`
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
}

function fmtDuration(fromIso, toIso) {
  const mins = Math.max(0, Math.round((new Date(toIso || Date.now()) - new Date(fromIso)) / 60000))
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`
}

function Card({ children, tone }) {
  const color = tone === 'error' ? 'text-wcs-red' : 'text-text-muted'
  return <p className={`${color} text-sm bg-surface border border-border rounded-xl px-4 py-8 text-center`}>{children}</p>
}

function KindBadge({ kind }) {
  return kind === 'monthly'
    ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200">Monthly</span>
    : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">Drop-in</span>
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
            value === o.value ? 'bg-wcs-red text-white' : 'bg-surface text-text-primary hover:bg-bg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">{title}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ErrorBox({ children }) {
  return <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{children}</div>
}

const blankChild = () => ({ first_name: '', last_name: '', age: '', age_unit: 'years' })

function CheckinModal({ token, onClose, onSaved }) {
  const [children, setChildren] = useState([blankChild()])
  const [parentFirst, setParentFirst] = useState('')
  const [parentLast, setParentLast] = useState('')
  const [parentPhone, setParentPhone] = useState('')
  const [kind, setKind] = useState(null)
  const [altPickup, setAltPickup] = useState(false)
  const [altName, setAltName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const setChild = (i, patch) => setChildren(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const phoneDigits = parentPhone.replace(/\D/g, '')
  const valid = children.every(c => c.first_name.trim() && c.last_name.trim() && /^\d+$/.test(c.age))
    && parentFirst.trim() && parentLast.trim()
    && (phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith('1')))
    && kind
    && (!altPickup || altName.trim())

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await publicChildcare.checkin(token, {
        parent_first_name: parentFirst,
        parent_last_name: parentLast,
        parent_phone: parentPhone,
        membership_kind: kind,
        alt_pickup: altPickup,
        alt_pickup_name: altPickup ? altName : null,
        children,
      })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not check in')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Check In" onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-5">
        <div className="space-y-3">
          {children.map((c, i) => (
            <div key={i} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {children.length > 1 ? `Child ${i + 1}` : 'Child'}
                </span>
                {children.length > 1 && (
                  <button type="button" onClick={() => setChildren(cs => cs.filter((_, j) => j !== i))}
                    className="text-xs text-text-muted hover:text-wcs-red">Remove</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>First name</label>
                  <input value={c.first_name} onChange={e => setChild(i, { first_name: e.target.value })}
                    maxLength={100} autoFocus={i === 0} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Last name</label>
                  <input value={c.last_name} onChange={e => setChild(i, { last_name: e.target.value })}
                    maxLength={100} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Age</label>
                <div className="flex gap-2">
                  <input type="number" inputMode="numeric" min="0" value={c.age}
                    onChange={e => setChild(i, { age: e.target.value })}
                    className="w-24 flex-none border border-border rounded-lg px-3 py-2.5 text-base bg-surface text-text-primary" />
                  <div className="flex-1">
                    <Segmented value={c.age_unit} onChange={v => setChild(i, { age_unit: v })}
                      options={[{ value: 'years', label: 'Years' }, { value: 'months', label: 'Months' }]} />
                  </div>
                </div>
              </div>
            </div>
          ))}
          {children.length < 6 && (
            <button type="button" onClick={() => setChildren(cs => [...cs, blankChild()])}
              className="w-full px-3 py-2 text-sm rounded-lg border border-dashed border-border text-text-primary hover:bg-bg">
              + Add another child
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Parent first name</label>
              <input value={parentFirst} onChange={e => setParentFirst(e.target.value)} maxLength={100} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Parent last name</label>
              <input value={parentLast} onChange={e => setParentLast(e.target.value)} maxLength={100} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Parent phone</label>
            <input type="tel" inputMode="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)}
              placeholder="(503) 555-1234" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Childcare</label>
            <Segmented value={kind} onChange={setKind}
              options={[{ value: 'monthly', label: 'Monthly' }, { value: 'drop_in', label: 'Drop-in' }]} />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-3">
          <label className="flex items-center gap-3 text-sm text-text-primary">
            <input type="checkbox" checked={altPickup} onChange={e => setAltPickup(e.target.checked)} className="w-5 h-5" />
            Someone else may pick up
          </label>
          {altPickup && (
            <div>
              <label className={labelCls}>Their name</label>
              <input value={altName} onChange={e => setAltName(e.target.value)} maxLength={100} className={inputCls} />
            </div>
          )}
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Cancel</button>
          <button type="submit" disabled={!valid || saving}
            className="px-5 py-2.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
            {saving ? 'Checking in...' : children.length > 1 ? `Check In ${children.length} Children` : 'Check In'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PickupOption({ selected, onClick, title, detail }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
        selected ? 'border-wcs-red bg-wcs-red/5 ring-1 ring-wcs-red' : 'border-border bg-surface hover:bg-bg'
      }`}>
      <div className="font-medium text-text-primary">{title}</div>
      {detail && <div className="text-xs text-text-muted">{detail}</div>}
    </button>
  )
}

function CheckoutModal({ token, visit, onClose, onSaved }) {
  const [by, setBy] = useState(null)
  const [otherName, setOtherName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const valid = by === 'same_parent' || by === 'approved_alternate' || (by === 'other' && otherName.trim() && confirmed)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await publicChildcare.checkout(token, visit.id, { picked_up_by: by, name: by === 'other' ? otherName : null })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not check out')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Check Out ${childName(visit)}`} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="text-sm text-text-muted">
          Checked in at {fmtTime(visit.checked_in_at)} by {parentName(visit)}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Who is picking up?</div>
          <PickupOption selected={by === 'same_parent'} onClick={() => setBy('same_parent')}
            title={parentName(visit)} detail="Same parent who checked in" />
          {visit.alt_pickup_name && (
            <PickupOption selected={by === 'approved_alternate'} onClick={() => setBy('approved_alternate')}
              title={visit.alt_pickup_name} detail="Approved by the parent at check-in" />
          )}
          <PickupOption selected={by === 'other'} onClick={() => setBy('other')}
            title="Someone else" detail="Not named at check-in" />
        </div>

        {by === 'other' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Name of the person picking up</label>
              <input value={otherName} onChange={e => setOtherName(e.target.value)} maxLength={100} autoFocus className={inputCls} />
            </div>
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This person was not approved at check-in. Call {parentName(visit)} at{' '}
              <a href={`tel:${visit.parent_phone.replace(/\D/g, '')}`} className="font-semibold underline">{visit.parent_phone}</a>{' '}
              before releasing {visit.child_first_name}.
            </div>
            <label className="flex items-center gap-3 text-sm text-text-primary">
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="w-5 h-5" />
              I confirmed with the parent
            </label>
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Cancel</button>
          <button type="submit" disabled={!valid || saving}
            className="px-5 py-2.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
            {saving ? 'Checking out...' : 'Check Out'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function InRoomRow({ v, onCheckout, viewOnly }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[12rem]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-text-primary">{childName(v)}</span>
          <span className="text-sm text-text-muted">{fmtAge(v.child_age_months)}</span>
          <KindBadge kind={v.membership_kind} />
        </div>
        <div className="text-sm text-text-muted">
          {parentName(v)}
          {!viewOnly && (
            <>
              {' · '}
              <a href={`tel:${v.parent_phone.replace(/\D/g, '')}`} className="text-text-primary underline">{v.parent_phone}</a>
            </>
          )}
        </div>
        {v.alt_pickup_name && (
          <div className="text-xs text-text-muted">Also OK to pick up: <span className="text-text-primary">{v.alt_pickup_name}</span></div>
        )}
      </div>
      <div className="text-right text-sm">
        <div className="text-text-primary">In {fmtTime(v.checked_in_at)}</div>
        <div className="text-text-muted">{fmtDuration(v.checked_in_at)}</div>
      </div>
      {!viewOnly && (
        <button type="button" onClick={() => onCheckout(v)}
          className="px-4 py-2.5 text-sm rounded-lg border border-border text-text-primary font-medium hover:bg-bg">
          Check Out
        </button>
      )}
    </div>
  )
}

const PICKUP_LABEL = { same_parent: 'Parent', approved_alternate: 'Approved', other: 'Other' }

function CheckedOutRow({ v }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-t border-border first:border-t-0 text-sm">
      <span className="font-medium text-text-primary">{childName(v)}</span>
      <KindBadge kind={v.membership_kind} />
      <span className="text-text-muted">
        {fmtTime(v.checked_in_at)} – {fmtTime(v.checked_out_at)} ({fmtDuration(v.checked_in_at, v.checked_out_at)})
      </span>
      <span className="ml-auto text-text-muted">
        Picked up by <span className="text-text-primary">{v.checked_out_by_name}</span>
        {v.checked_out_by !== 'same_parent' && ` (${PICKUP_LABEL[v.checked_out_by]})`}
      </span>
    </div>
  )
}

export default function ChildcareApp({ token, viewOnly = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkingOut, setCheckingOut] = useState(null)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!token) {
      setError('This link is missing its access code. Ask a manager for the childcare link.')
      setLoading(false)
      return
    }
    try {
      setData(await (viewOnly ? publicChildcare.view(token) : publicChildcare.get(token)))
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, viewOnly])

  useEffect(() => {
    load()
    const t = setInterval(() => { load(); setTick(n => n + 1) }, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const inRoom = data?.in_room || []
  const out = data?.checked_out || []

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-surface rounded-xl border border-border px-4 py-3 flex flex-wrap items-center gap-3">
          <img src="/wcs-logo.png" alt="" className="w-8 h-8" />
          <div>
            <h1 className="font-semibold text-text-primary leading-tight">{viewOnly ? 'Childcare Room' : 'Childcare Check-In'}</h1>
            {data?.club && <p className="text-sm text-text-muted leading-tight">{data.club}</p>}
          </div>
          {data && (
            <span className="ml-auto text-sm text-text-muted">{inRoom.length} in the room</span>
          )}
          {data && !viewOnly && (
            <button type="button" onClick={() => setCheckingIn(true)}
              className="px-5 py-2.5 text-sm rounded-lg bg-wcs-red text-white font-semibold hover:bg-wcs-red-hover">
              Check In
            </button>
          )}
        </div>

        {loading && <Card>Loading…</Card>}
        {!loading && error && <Card tone="error">{error}</Card>}

        {!loading && !error && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1">In the room</h2>
            {inRoom.length === 0
              ? <Card>No children checked in right now.</Card>
              : inRoom.map(v => <InRoomRow key={v.id} v={v} onCheckout={setCheckingOut} viewOnly={viewOnly} />)}
          </div>
        )}

        {!loading && !error && out.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1">Checked out today</h2>
            <div className="bg-surface rounded-xl border border-border">
              {out.map(v => <CheckedOutRow key={v.id} v={v} />)}
            </div>
          </div>
        )}
      </div>

      {checkingIn && (
        <CheckinModal token={token} onClose={() => setCheckingIn(false)}
          onSaved={() => { setCheckingIn(false); load() }} />
      )}
      {checkingOut && (
        <CheckoutModal token={token} visit={checkingOut} onClose={() => setCheckingOut(null)}
          onSaved={() => { setCheckingOut(null); load() }} />
      )}
    </div>
  )
}
