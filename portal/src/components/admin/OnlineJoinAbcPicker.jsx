import { useEffect, useMemo, useState } from 'react'
import { onlineJoin } from '../../lib/api'
import { guessFromName, summarizeAbcPlan, unwrapAbcDetail, termLabel } from '../../lib/abcPlan'

// ABC's plan list per club rarely changes within a session; cache it so the
// picker opens instantly the second time.
const listCache = new Map()

export async function loadAbcPlanList(clubNumber) {
  if (listCache.has(clubNumber)) return listCache.get(clubNumber)
  const r = await onlineJoin.abcPlans(clubNumber)
  const list = (Array.isArray(r) && r) || r.plans || r.paymentPlans || r.result?.plans || r.result || []
  const rows = (Array.isArray(list) ? list : [])
    .map(p => ({ planId: p.planId || p.paymentPlanId || p.id, name: p.planName || p.name || '' }))
    .filter(p => p.planId)
  listCache.set(clubNumber, rows)
  return rows
}

export async function loadAbcPlanSummary(clubNumber, planId) {
  const r = await onlineJoin.abcPlanDetails(clubNumber, planId)
  return summarizeAbcPlan(unwrapAbcDetail(r))
}

const METHOD_LABEL = { cc: 'Card', ach: 'Bank (ACH)' }

// Searchable list of the club's ABC plans. `want` ({ term, method, hint })
// floats matching plans to the top so the right one is usually first.
export default function AbcPlanPicker({ clubNumber, clubName, want = {}, onPick, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState(want.hint || '')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let alive = true
    loadAbcPlanList(clubNumber)
      .then(r => { if (alive) setRows(r) })
      .catch(e => { if (alive) setError(e.message || 'Could not load plans from ABC') })
    return () => { alive = false }
  }, [clubNumber])

  const shown = useMemo(() => {
    if (!rows) return []
    const words = q.trim().toUpperCase().split(/[\s-]+/).filter(Boolean)
    const scored = rows
      .filter(r => words.every(w => r.name.toUpperCase().includes(w)))
      .map(r => {
        const g = guessFromName(r.name)
        let score = 0
        if (want.method && g.method === want.method) score += 2
        if (want.term && g.term === want.term) score += 2
        if (/^WEB/i.test(r.name)) score += 1
        return { ...r, ...g, score }
      })
    return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  }, [rows, q, want.method, want.term])

  async function choose(row) {
    setBusyId(row.planId)
    try {
      const s = await loadAbcPlanSummary(clubNumber, row.planId)
      onPick(s || { planId: row.planId, name: row.name })
    } catch (e) {
      setError(e.message || 'Could not load that plan from ABC')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-text-primary">
                Choose the {want.method ? METHOD_LABEL[want.method] : ''} plan from ABC
              </h3>
              <p className="text-xs text-text-muted">
                {clubName} · club #{clubNumber}
                {want.term ? ` · looking for ${termLabel(want.term)}` : ''}
              </p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search ABC plan names, e.g. halfoff 1yr"
            className="mt-3 w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
          />
        </div>

        <div className="overflow-y-auto p-3 space-y-1.5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{String(error)}</div>}
          {!rows && !error && <p className="text-sm text-text-muted text-center py-10">Loading plans from ABC…</p>}
          {rows && shown.length === 0 && <p className="text-sm text-text-muted text-center py-10">No ABC plans match “{q}”.</p>}
          {shown.map(r => {
            const matches = (want.method ? r.method === want.method : true) && (want.term ? r.term === want.term : true)
            return (
              <button
                key={r.planId}
                onClick={() => choose(r)}
                disabled={!!busyId}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors disabled:opacity-60 ${matches && (want.method || want.term) ? 'border-wcs-red/40 bg-wcs-red/5 hover:border-wcs-red' : 'border-border bg-bg hover:border-wcs-red'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-text-primary font-mono truncate">{r.name || r.planId}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {r.term && <Tag>{r.term === '1yr' ? '1-Year' : 'M2M'}</Tag>}
                    {r.method && <Tag>{r.method === 'cc' ? 'Card' : 'Bank'}</Tag>}
                    {busyId === r.planId && <span className="text-[11px] text-text-muted ml-1">Loading…</span>}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Tag({ children }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface border border-border text-text-muted font-medium">{children}</span>
}
