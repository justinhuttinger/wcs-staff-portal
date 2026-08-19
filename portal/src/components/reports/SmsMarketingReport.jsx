import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getSmsMarketingTemplates, setSmsTemplateLabel } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// SMS engagement per automated text. GHL attaches no workflow id to a message,
// so each distinct text is identified by a fingerprint of its body; templates
// are GLOBAL (one row spans every club that sent it), with a per-club
// breakdown available via by_club. The label column is a human name for that
// cluster when one has been set.

function fmtInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}
function fmtPct(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'
}
function fmtMinutes(v) {
  // Explicit null/undefined check first: Number(null) is 0 (not NaN), so
  // relying on Number.isFinite alone would silently turn "no replies yet"
  // (median_reply_minutes: null) into a plausible-looking "0m".
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n < 60) return `${Math.round(n)}m`
  if (n < 1440) return `${(n / 60).toFixed(1)}h`
  return `${(n / 1440).toFixed(1)}d`
}
function preview(body) {
  const s = (body || '').replace(/\s+/g, ' ').trim()
  return s.length > 90 ? s.slice(0, 90) + '…' : s || '—'
}
function clubRate(sends, replies) {
  const s = Number(sends) || 0
  const r = Number(replies) || 0
  return s > 0 ? (r / s) * 100 : 0
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1 text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function ChevronIcon({ expanded }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}

function PencilIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 flex-shrink-0 ${className}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 18.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L15.813 5.6z" />
    </svg>
  )
}

const KINDS = [
  { key: 'automated', label: 'Automated' },
  { key: 'staff', label: 'Staff sent' },
  { key: 'all', label: 'All' },
]

// Per-club breakdown, rendered nested and visually subordinate to the parent
// template row (indented, tinted, no outer card of its own).
function ClubBreakdown({ byClub }) {
  const clubs = Object.entries(byClub).sort((a, b) => (Number(b[1].sends) || 0) - (Number(a[1].sends) || 0))
  return (
    <div className="ml-6 my-2 border-l-2 border-border pl-4">
      <div className="rounded-lg bg-bg/60 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-text-muted border-b border-border/70">
            <tr>
              <th className="py-1.5 px-3 text-left">Club</th>
              <th className="py-1.5 px-2 text-right">Sends</th>
              <th className="py-1.5 px-2 text-right">Delivered</th>
              <th className="py-1.5 px-2 text-right">Failed</th>
              <th className="py-1.5 px-2 text-right">Replies</th>
              <th className="py-1.5 px-2 text-right">Reply %</th>
            </tr>
          </thead>
          <tbody>
            {clubs.map(([slug, c]) => (
              <tr key={slug} className="border-b border-border/40 last:border-0">
                <td className="py-1.5 px-3 capitalize text-text-muted">{slug}</td>
                <td className="py-1.5 px-2 text-right text-text-primary">{fmtInt(c.sends)}</td>
                <td className="py-1.5 px-2 text-right text-text-primary">{fmtInt(c.delivered)}</td>
                <td className="py-1.5 px-2 text-right text-text-primary">{fmtInt(c.failed)}</td>
                <td className="py-1.5 px-2 text-right text-text-primary">{fmtInt(c.replies)}</td>
                <td className="py-1.5 px-2 text-right font-semibold text-text-primary">{fmtPct(clubRate(c.sends, c.replies))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function SmsMarketingReport({ startDate, endDate, locationSlug, isAdmin }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('automated')
  const [expanded, setExpanded] = useState(() => new Set())
  const [editingKey, setEditingKey] = useState(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [renameError, setRenameError] = useState('')
  // Enter and Escape both unmount the input (Enter via saveEdit's
  // setEditingKey(null), Escape via cancelEdit's setEditingKey(null)), and
  // either can trigger a synchronous onBlur before the unmount completes.
  // Without this guard, Escape's blur would call saveEdit and persist the
  // draft the user just asked to discard. Set before either branch's state
  // change so the blur handler sees it regardless of ordering.
  const skipBlurRef = useRef(false)

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, start_date: startDate, end_date: endDate, kind }),
    [allLoc, locationSlug, startDate, endDate, kind]
  )

  const load = useCallback(() => {
    let ignore = false
    setLoading(true)
    setError('')
    setRenameError('')
    getSmsMarketingTemplates(params)
      .then(d => { if (!ignore) setData(d) })
      .catch(e => { if (!ignore) setError(e.message || 'Failed to load SMS engagement') })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [params])

  useEffect(() => load(), [load])
  // Stale group keys from a previous filter set should not re-expand rows
  // that happen to share a key under the new filters.
  useEffect(() => { setExpanded(new Set()) }, [params])

  const rows = data?.templates || []
  const totals = data?.totals

  function toggleExpand(groupKey) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  function startEdit(r) {
    if (!isAdmin) return
    setRenameError('')
    skipBlurRef.current = false
    setEditingKey(r.group_key)
    setDraftLabel(r.label || '')
  }

  function cancelEdit() {
    skipBlurRef.current = true
    setEditingKey(null)
    setDraftLabel('')
  }

  async function saveEdit(r) {
    const nextLabel = draftLabel.trim()
    const prevLabel = r.label
    setEditingKey(null)

    // Optimistic update so the row reflects the new name immediately.
    setData(d => d && {
      ...d,
      templates: d.templates.map(t => t.group_key === r.group_key ? { ...t, label: nextLabel || null } : t),
    })

    const urlKey = (r.template_keys && r.template_keys[0]) || r.group_key
    try {
      await setSmsTemplateLabel(urlKey, nextLabel, r.template_keys, prevLabel)
      // A rename can collide with another group's label, merging them on the
      // backend into a single row — refetch rather than trust local state.
      load()
    } catch (e) {
      setData(d => d && {
        ...d,
        templates: d.templates.map(t => t.group_key === r.group_key ? { ...t, label: prevLabel } : t),
      })
      setRenameError(e.message || 'Failed to rename template')
    }
  }

  function handleExport() {
    exportCSV(
      [
        ['Text', 'Clubs', 'Club Count', 'Sends', 'Delivered', 'Failed', 'Replies', 'Reply %', 'Opt-outs', 'Median reply (min)'],
        ...rows.map(r => [
          r.label || r.sample_body || '',
          (r.clubs || []).join('; '),
          r.clubs?.length || 0,
          r.sends,
          r.delivered,
          r.failed,
          r.replies,
          r.reply_rate,
          r.opt_outs,
          r.median_reply_minutes ?? '',
        ]),
      ],
      `sms-engagement-${kind}-${startDate}_to_${endDate}`
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-3 flex items-center gap-2 flex-wrap">
        {KINDS.map(k => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              kind === k.key
                ? 'bg-wcs-red text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {k.label}
          </button>
        ))}
        <div className="flex-1" />
        {rows.length > 0 && (
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            Export CSV
          </button>
        )}
      </div>

      {(error || renameError) && (
        <div className="bg-surface rounded-xl border border-border p-4">
          {error && <p className="text-sm text-wcs-red">{error}</p>}
          {renameError && <p className="text-sm text-wcs-red">{renameError}</p>}
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Sends" value={fmtInt(totals.sends)} sub={`${fmtInt(totals.templates)} distinct texts`} />
          <StatCard label="Replies" value={fmtInt(totals.replies)} />
          <StatCard label="Reply Rate" value={fmtPct(totals.reply_rate)} />
          <StatCard label="Opt-outs" value={fmtInt(totals.opt_outs)} sub={fmtPct(totals.opt_out_rate)} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-muted border-b border-border">
                <tr>
                  <th className="py-2.5 px-4 text-left">Text</th>
                  <th className="py-2.5 px-2 text-right">Sends</th>
                  <th className="py-2.5 px-2 text-right">Delivered</th>
                  <th className="py-2.5 px-2 text-right">Failed</th>
                  <th className="py-2.5 px-2 text-right">Replies</th>
                  <th className="py-2.5 px-2 text-right">Reply %</th>
                  <th className="py-2.5 px-2 text-right">Opt-outs</th>
                  <th className="py-2.5 px-2 text-right">Median Reply</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const clubCount = r.clubs?.length || 0
                  const byClubCount = Object.keys(r.by_club || {}).length
                  const canExpand = byClubCount > 1
                  const isExpanded = canExpand && expanded.has(r.group_key)
                  const isEditing = editingKey === r.group_key

                  return (
                    <Fragment key={r.group_key}>
                      <tr className="border-b border-border/50 last:border-0 align-top">
                        <td className="py-2.5 px-4 max-w-md">
                          <div className="flex items-center gap-1.5">
                            {canExpand && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(r.group_key)}
                                className="text-text-muted hover:text-text-primary flex-shrink-0"
                                aria-label={isExpanded ? 'Collapse club breakdown' : 'Expand club breakdown'}
                              >
                                <ChevronIcon expanded={isExpanded} />
                              </button>
                            )}
                            {isEditing ? (
                              <input
                                autoFocus
                                type="text"
                                value={draftLabel}
                                onChange={e => setDraftLabel(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); skipBlurRef.current = true; saveEdit(r) }
                                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                                }}
                                onBlur={() => { if (!skipBlurRef.current) saveEdit(r) }}
                                placeholder={preview(r.sample_body)}
                                className="flex-1 min-w-0 bg-bg border border-border rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-wcs-red"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEdit(r)}
                                disabled={!isAdmin}
                                className={`group flex items-center gap-1.5 min-w-0 text-left ${isAdmin ? 'cursor-text' : 'cursor-default'}`}
                              >
                                <span className="text-text-primary font-medium truncate">{r.label || preview(r.sample_body)}</span>
                                {isAdmin && <PencilIcon className="opacity-0 group-hover:opacity-60" />}
                              </button>
                            )}
                            {clubCount > 1 && (
                              <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-bg text-text-muted border border-border">
                                {clubCount} clubs
                              </span>
                            )}
                          </div>
                          {r.label && <p className="text-xs text-text-muted mt-0.5">{preview(r.sample_body)}</p>}
                        </td>
                        <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.sends)}</td>
                        <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.delivered)}</td>
                        <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.failed)}</td>
                        <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.replies)}</td>
                        <td className="py-2.5 px-2 text-right font-semibold text-text-primary">{fmtPct(r.reply_rate)}</td>
                        <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.opt_outs)}</td>
                        <td className="py-2.5 px-2 text-right text-text-primary">{fmtMinutes(r.median_reply_minutes)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border/50 last:border-0">
                          <td colSpan={8} className="py-0 px-4">
                            <ClubBreakdown byClub={r.by_club} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && !rows.length && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">No SMS sends in this range yet.</p>
        </div>
      )}
    </div>
  )
}
