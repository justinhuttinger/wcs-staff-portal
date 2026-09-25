import { useEffect, useState } from 'react'
import { saveAdmin } from '../../../lib/api'
import {
  Card, Badge, OutcomeBadge, CLUBS, CLUB_NAME, OUTCOMES, inputClass, btnPrimary, btnSecondary, formatDateTime, money,
} from './shared'

// "Needs action" is not just outcome = needs_staff: a perk is recorded as
// outcome = saved with staff_reason set, and staff still has to hand it out.
// Mirrors needsAction() in auth/src/services/saveOffersSchema.js.
function needsAction(r) {
  return !!r && !r.resolved_at && (r.outcome === 'needs_staff' || !!r.staff_reason)
}

const OWED_FIELDS = [
  ['pastDue', 'Past due'],
  ['lateFee', 'Late fees'],
  ['serviceFee', 'Service fees'],
  ['clubAccountPastDue', 'Club account past due'],
  ['nextDue', 'Next due'],
  ['cancelFee', 'Cancel fee'],
  ['total', 'Total'],
]

function Stat({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs uppercase font-semibold text-text-muted">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${tone === 'alert' ? 'text-wcs-red' : 'text-text-primary'}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function StatsHeader({ stats, error }) {
  if (error) return <Card><p className="text-sm text-wcs-red">{error}</p></Card>
  if (!stats) return <Card><p className="text-sm text-text-muted">Loading stats…</p></Card>
  const rate = stats.save_rate == null ? 'n/a' : `${Math.round(stats.save_rate * 100)}%`
  return (
    <Card className="space-y-4">
      <p className="text-xs uppercase font-semibold text-text-muted">Last {stats.days} days</p>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Stat label="Requests" value={stats.total} />
        <Stat label="Saved" value={stats.by_outcome.saved} />
        <Stat label="Cancelled" value={stats.by_outcome.cancelled} />
        <Stat
          label="Needs action"
          value={stats.needs_action_open_all_time}
          sub={stats.needs_action_open_all_time ? 'open, any date' : 'all caught up'}
          tone={stats.needs_action_open_all_time ? 'alert' : undefined}
        />
        <Stat label="Save rate" value={rate} sub="saved / (saved + cancelled)" />
      </div>
      {(stats.by_offer.length > 0 || stats.by_reason.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {stats.by_offer.length > 0 && (
            <div>
              <p className="text-xs uppercase font-semibold text-text-muted mb-1">Offers taken</p>
              <ul className="text-sm space-y-0.5">
                {stats.by_offer.map(o => (
                  <li key={o.offer_id || o.headline} className="flex justify-between gap-3">
                    <span className="text-text-primary truncate">{o.headline}</span>
                    <span className="tabular-nums text-text-muted">{o.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stats.by_reason.length > 0 && (
            <div>
              <p className="text-xs uppercase font-semibold text-text-muted mb-1">Reasons given</p>
              <ul className="text-sm space-y-0.5">
                {stats.by_reason.map(r => (
                  <li key={r.reason_label} className="flex justify-between gap-3">
                    <span className="text-text-primary truncate">{r.reason_label}</span>
                    <span className="tabular-nums text-text-muted">{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary break-words">{children}</span>
    </div>
  )
}

function JsonBlock({ value }) {
  return (
    <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-bg border border-border p-3 text-xs text-text-primary whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function owedValue(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? money(n) : String(v)
}

function RequestDetail({ id, onClose, onResolved }) {
  const [req, setReq] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    setReq(null)
    setError('')
    saveAdmin.getRequest(id)
      .then(r => setReq(r.request))
      .catch(e => setError(e.message || 'Failed to load request'))
  }, [id])

  async function resolve() {
    setResolving(true)
    setError('')
    try {
      const r = await saveAdmin.resolveRequest(id, note.trim())
      setReq(r.request)
      setNote('')
      onResolved()
    } catch (e) {
      setError(e.message || 'Failed to resolve')
    } finally {
      setResolving(false)
    }
  }

  const plan = req?.offer_snapshot?.plan
  const owed = req?.owed && typeof req.owed === 'object' ? req.owed : null
  const actions = Array.isArray(req?.abc_actions) ? req.abc_actions : []

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-text-primary">{req?.member_name || (req ? `Member ${req.member_id}` : 'Request')}</h3>
          {req && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <OutcomeBadge outcome={req.outcome} />
              {req.dry_run && <Badge tone="purple">DRY RUN</Badge>}
              {needsAction(req) && <Badge tone="orange">Needs action</Badge>}
              {req.resolved_at && <Badge tone="green">Resolved</Badge>}
            </div>
          )}
        </div>
        <button onClick={onClose} className={btnSecondary}>Close</button>
      </div>

      {error && <p className="text-sm text-wcs-red">{error}</p>}
      {!req && !error && <p className="text-sm text-text-muted">Loading…</p>}

      {req && (
        <>
          {req.staff_reason && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-3">
              <p className="text-xs uppercase font-semibold text-orange-700">For staff</p>
              <p className="text-sm text-gray-900 mt-1">{req.staff_reason}</p>
            </div>
          )}

          <div>
            <Row label="Started">{formatDateTime(req.created_at)}</Row>
            <Row label="Completed">{formatDateTime(req.completed_at)}</Row>
            <Row label="Club">{CLUB_NAME[req.club_number] ? `${CLUB_NAME[req.club_number]} (${req.club_number})` : req.club_number}</Row>
            <Row label="Member ID">{req.member_id}</Row>
            <Row label="Email">{req.email}</Row>
            <Row label="Email verified">{formatDateTime(req.verified_at)}</Row>
            <Row label="Reason">{req.reason_label}</Row>
            <Row label="Member note">{req.reason_note}</Row>
            <Row label="Offers shown">{(req.offers_shown || []).length || null}</Row>
            <Row label="Offer taken">{req.offer_snapshot?.headline}</Row>
            <Row label="Plan">{plan == null ? null : typeof plan === 'object' ? JSON.stringify(plan) : String(plan)}</Row>
            <Row label="Cancel date">{req.cancel_date}</Row>
          </div>

          {owed && (
            <div>
              <p className="text-xs uppercase font-semibold text-text-muted mb-1">Owed at cancel</p>
              {OWED_FIELDS.map(([k, label]) => (
                <Row key={k} label={label}>{owedValue(owed[k])}</Row>
              ))}
            </div>
          )}

          {req.resolved_at && (
            <div>
              <p className="text-xs uppercase font-semibold text-text-muted mb-1">Resolution</p>
              <Row label="Resolved">{formatDateTime(req.resolved_at)}</Row>
              <Row label="Note">{req.resolution_note}</Row>
            </div>
          )}

          {needsAction(req) && (
            <div className="space-y-2">
              <p className="text-xs uppercase font-semibold text-text-muted">Mark as handled</p>
              <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder="What did you do? (optional)" className={inputClass(false)} />
              <button onClick={resolve} disabled={resolving} className={btnPrimary}>{resolving ? 'Saving…' : 'Resolve'}</button>
            </div>
          )}

          <div>
            <p className="text-xs uppercase font-semibold text-text-muted">
              ABC actions ({actions.length}){req.dry_run ? ', simulated' : ''}
            </p>
            {actions.length ? <JsonBlock value={actions} /> : <p className="text-sm text-text-muted mt-1">None.</p>}
          </div>

          {req.agreement && (
            <details>
              <summary className="text-xs uppercase font-semibold text-text-muted cursor-pointer">Agreement snapshot</summary>
              <JsonBlock value={req.agreement} />
            </details>
          )}
          {req.offer_snapshot && (
            <details>
              <summary className="text-xs uppercase font-semibold text-text-muted cursor-pointer">Offer snapshot</summary>
              <JsonBlock value={req.offer_snapshot} />
            </details>
          )}
        </>
      )}
    </Card>
  )
}

export default function ActivityTab() {
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState('')
  const [club, setClub] = useState('')
  const [selected, setSelected] = useState(null)

  function loadStats() {
    saveAdmin.stats(30)
      .then(s => { setStats(s); setStatsError('') })
      .catch(e => setStatsError(e.message || 'Failed to load stats'))
  }

  async function loadRows() {
    setLoading(true)
    setError('')
    try {
      const params = outcome === 'needs_action'
        ? { club, limit: 200, needs_action: true }
        : { outcome, club, limit: 200 }
      const r = await saveAdmin.listRequests(params)
      setRows(r.requests || [])
    } catch (e) {
      setError(e.message || 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStats() }, [])
  useEffect(() => { loadRows() }, [outcome, club]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <StatsHeader stats={stats} error={statsError} />

      {selected && (
        <RequestDetail
          id={selected}
          onClose={() => setSelected(null)}
          onResolved={() => { loadStats(); loadRows() }}
        />
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Outcome</label>
            <select value={outcome} onChange={e => setOutcome(e.target.value)} className={inputClass(false)}>
              <option value="">All outcomes</option>
              <option value="needs_action">Needs action (open)</option>
              {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Club</label>
            <select value={club} onChange={e => setClub(e.target.value)} className={inputClass(false)}>
              <option value="">All clubs</option>
              {CLUBS.map(c => <option key={c.number} value={c.number}>{c.name}</option>)}
            </select>
          </div>
          <button onClick={() => { loadStats(); loadRows() }} className={btnSecondary}>Refresh</button>
        </div>

        {error && <p className="text-sm text-wcs-red">{error}</p>}

        {loading ? (
          <p className="text-sm text-text-muted">Loading activity…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">No requests match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-text-muted border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Club</th>
                  <th className="py-2 pr-3 font-semibold">Member</th>
                  <th className="py-2 pr-3 font-semibold">Reason</th>
                  <th className="py-2 pr-3 font-semibold">Offer</th>
                  <th className="py-2 pr-3 font-semibold">Outcome</th>
                  <th className="py-2 font-semibold">For staff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-bg align-top ${
                      selected === r.id ? 'bg-bg' : ''
                    }`}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-text-muted">{formatDateTime(r.created_at)}</td>
                    <td className="py-2 pr-3 text-text-primary">{CLUB_NAME[r.club_number] || r.club_number}</td>
                    <td className="py-2 pr-3 text-text-primary">{r.member_name || r.member_id}</td>
                    <td className="py-2 pr-3 text-text-muted">{r.reason_label || ''}</td>
                    <td className="py-2 pr-3 text-text-muted">{r.offer_snapshot?.headline || ''}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        <OutcomeBadge outcome={r.outcome} />
                        {r.dry_run && <Badge tone="purple">DRY RUN</Badge>}
                        {needsAction(r) && <Badge tone="orange">Needs action</Badge>}
                        {r.resolved_at && (r.outcome === 'needs_staff' || r.staff_reason) && <Badge tone="green">Resolved</Badge>}
                      </div>
                    </td>
                    <td className="py-2 text-text-muted max-w-[18rem]">{r.staff_reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
