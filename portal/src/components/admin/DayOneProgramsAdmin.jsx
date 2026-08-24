import { useState, useEffect, useCallback } from 'react'
import { getDayOnePrograms } from '../../lib/api'

// Public domain the Day One endpoints are served from. Using this host for the
// GHL redirect is what makes the generated program PDF open on
// api.wcstrength.com (the success page links to the PDF relatively, so it
// follows whatever host served the page).
const PUBLIC_BASE = 'https://api.wcstrength.com'
const WEBHOOK_URL = `${PUBLIC_BASE}/day-one-program/webhook`
const REDIRECT_URL = `${PUBLIC_BASE}/day-one-program/success?contactId={{contact.id}}`

// club_code -> friendly name (from auth/src/config/ghlLocations.js)
const CLUB_NAMES = {
  '30935': 'Salem', '31599': 'Keizer', '7655': 'Eugene', '31598': 'Springfield',
  '31600': 'Clackamas', '31601': 'Milwaukie', '32073': 'Medford',
}

const STATUS_STYLES = {
  complete: 'bg-green-100 text-green-700 border-green-300',
  error: 'bg-red-100 text-red-700 border-red-300',
  pending: 'bg-gray-100 text-gray-600 border-gray-300',
  generating: 'bg-blue-100 text-blue-700 border-blue-300',
  rendering: 'bg-blue-100 text-blue-700 border-blue-300',
  ready: 'bg-blue-100 text-blue-700 border-blue-300',
  delivering: 'bg-blue-100 text-blue-700 border-blue-300',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function fmtDuration(start, end) {
  if (!start || !end) return ''
  const ms = new Date(end) - new Date(start)
  if (!(ms > 0)) return ''
  return `${Math.round(ms / 1000)}s`
}

// Copy button with the required "Copied!" confirmation animation.
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      onClick={handleCopy}
      className={`relative shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
        copied
          ? 'bg-green-100 text-green-700 border-green-300'
          : 'border-border bg-surface text-text-primary hover:bg-bg'
      }`}
    >
      <span className={copied ? 'opacity-0' : 'opacity-100'}>Copy</span>
      {copied && (
        <span className="absolute inset-0 flex items-center justify-center gap-1 text-green-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          Copied!
        </span>
      )}
    </button>
  )
}

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'text-text-primary',
    green: 'text-green-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
  }
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-2xl font-bold tabular-nums">
        <span className={tones[tone]}>{value}</span>
      </div>
      <div className="text-xs text-text-muted mt-0.5">{label}</div>
    </div>
  )
}

function Flag({ ok, labelYes, labelNo }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">✓ {labelYes}</span>
    : <span className="text-text-muted text-xs">{labelNo}</span>
}

export default function DayOneProgramsAdmin() {
  const [programs, setPrograms] = useState([])
  const [stats, setStats] = useState({ total: 0, completed: 0, errored: 0, emailed: 0, uploadedAbc: 0 })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getDayOnePrograms({ page, limit, status: statusFilter, search: search.trim() })
      setPrograms(res.programs || [])
      setTotal(res.total || 0)
      if (res.stats) setStats(res.stats)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, search])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-6">
      {/* GHL Setup — values to paste into the PT-Intake automation */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-bold text-text-primary mb-1">GHL Setup</h3>
        <p className="text-xs text-text-muted mb-4">
          Configure the GoHighLevel PT-Intake automation with these values. Using the
          <code className="mx-1 px-1 rounded bg-bg">api.wcstrength.com</code>
          redirect below is what makes the finished program PDF open on
          <code className="mx-1 px-1 rounded bg-bg">api.wcstrength.com</code>
          (not the raw service host).
        </p>

        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold text-text-primary mb-1">Webhook: where to POST</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-primary">{WEBHOOK_URL}</code>
              <CopyButton text={WEBHOOK_URL} />
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-text-primary mb-1">Redirect / Success URL</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-primary">{REDIRECT_URL}</code>
              <CopyButton text={REDIRECT_URL} />
            </div>
            <div className="text-[11px] text-text-muted mt-1">
              The <code className="px-1 rounded bg-bg">{'?contactId={{contact.id}}'}</code> query param is required, so the success page can track progress by contact.
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Created" value={stats.total} />
        <StatCard label="Completed" value={stats.completed} tone="green" />
        <StatCard label="Emailed" value={stats.emailed} tone="blue" />
        <StatCard label="ABC Uploaded" value={stats.uploadedAbc} tone="blue" />
        <StatCard label="Errored" value={stats.errored} tone={stats.errored ? 'red' : 'default'} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => { setPage(1); setSearch(e.target.value) }}
          placeholder="Search client, email, or trainer…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
        />
        <select
          value={statusFilter}
          onChange={e => { setPage(1); setStatusFilter(e.target.value) }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
        >
          <option value="">All statuses</option>
          <option value="complete">Complete</option>
          <option value="error">Error</option>
          <option value="pending">Pending</option>
          <option value="generating">Generating</option>
          <option value="rendering">Rendering</option>
          <option value="delivering">Delivering</option>
        </select>
        <button
          onClick={load}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg text-left text-text-muted">
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Trainer</th>
              <th className="px-4 py-2 font-medium">Club</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">ABC</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">Loading…</td></tr>
            ) : programs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">No programs found.</td></tr>
            ) : programs.map(p => (
              <tr key={p.id} className="border-t border-border align-top">
                <td className="px-4 py-2 whitespace-nowrap text-text-primary">
                  {fmtDate(p.created_at)}
                  {p.completed_at && <span className="text-text-muted"> · {fmtDuration(p.created_at, p.completed_at)}</span>}
                </td>
                <td className="px-4 py-2">
                  <div className="text-text-primary font-medium">{p.contact_name || 'Client'}</div>
                  <div className="text-xs text-text-muted">{p.contact_email || '—'}</div>
                </td>
                <td className="px-4 py-2 text-text-primary">{p.trainer_name || '—'}</td>
                <td className="px-4 py-2 text-text-primary whitespace-nowrap">
                  {CLUB_NAMES[p.club_code] || p.club_code || '—'}
                  {p.brand === 'esac' && (
                    <div className="text-xs text-text-muted">ESAC branding</div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLES[p.status] || STATUS_STYLES.pending}`}>
                    {p.status || 'pending'}
                  </span>
                  {p.status === 'error' && p.error_message && (
                    <div className="text-[11px] text-red-600 mt-1 max-w-xs">{p.error_message}</div>
                  )}
                </td>
                <td className="px-4 py-2"><Flag ok={p.emailed} labelYes="Sent" labelNo="—" /></td>
                <td className="px-4 py-2">
                  {p.abc_member_id
                    ? <Flag ok={p.uploaded_abc} labelYes="Uploaded" labelNo="Failed" />
                    : <span className="text-text-muted text-xs">No member</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-2 text-sm text-text-muted">
          <span>{total} total · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold text-text-primary disabled:opacity-40 hover:bg-bg"
            >Prev</button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold text-text-primary disabled:opacity-40 hover:bg-bg"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
