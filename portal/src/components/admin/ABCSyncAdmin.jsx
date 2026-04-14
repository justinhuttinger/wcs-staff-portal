import { useState, useEffect } from 'react'
import { getABCSyncSummary, getABCSyncRuns, getABCSyncChangelog, getABCSyncUnmatched, getABCMembershipBreakdown, triggerABCSync } from '../../lib/api'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ABCSyncAdmin() {
  const [summary, setSummary] = useState(null)
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Tabs
  const [tab, setTab] = useState('overview') // overview | changelog | unmatched

  // Changelog state
  const [changelog, setChangelog] = useState({ data: [], total: 0 })
  const [clPage, setClPage] = useState(1)
  const [clFilters, setClFilters] = useState({ club_number: '', action: '', search: '' })
  const [clLoading, setClLoading] = useState(false)

  // Unmatched state
  const [unmatched, setUnmatched] = useState({ data: [], total: 0 })
  const [umPage, setUmPage] = useState(1)
  const [umClub, setUmClub] = useState('')
  const [umLoading, setUmLoading] = useState(false)

  // Membership breakdown
  const [expandedClub, setExpandedClub] = useState(null)
  const [breakdown, setBreakdown] = useState([])
  const [bdLoading, setBdLoading] = useState(false)

  useEffect(() => { loadInitial() }, [])

  async function loadInitial() {
    try {
      setLoading(true)
      const [summaryData, runsData] = await Promise.all([
        getABCSyncSummary(),
        getABCSyncRuns(),
      ])
      setSummary(summaryData)
      setRuns(runsData)
      setSelectedRun(summaryData.run_id)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function loadRun(runId) {
    try {
      setLoading(true)
      setSelectedRun(runId)
      const data = await getABCSyncSummary(runId)
      setSummary(data)
      setTab('overview')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function loadChangelog(page = 1, filterOverrides = {}) {
    if (!selectedRun) return
    setClLoading(true)
    try {
      const filters = { ...clFilters, ...filterOverrides }
      const params = { run_id: selectedRun, page, limit: 50 }
      if (filters.club_number) params.club_number = filters.club_number
      if (filters.action) params.action = filters.action
      if (filters.search) params.search = filters.search
      const data = await getABCSyncChangelog(params)
      setChangelog(data)
      setClPage(page)
    } catch (err) {
      setError(err.message)
    }
    setClLoading(false)
  }

  async function loadUnmatched(page = 1) {
    if (!selectedRun) return
    setUmLoading(true)
    try {
      const params = { run_id: selectedRun, page, limit: 50 }
      if (umClub) params.club_number = umClub
      const data = await getABCSyncUnmatched(params)
      setUnmatched(data)
      setUmPage(page)
    } catch (err) {
      setError(err.message)
    }
    setUmLoading(false)
  }

  async function loadBreakdown(clubNumber) {
    if (expandedClub === clubNumber) { setExpandedClub(null); return }
    setBdLoading(true)
    setExpandedClub(clubNumber)
    try {
      const data = await getABCMembershipBreakdown(clubNumber)
      setBreakdown(data)
    } catch (err) {
      setError(err.message)
    }
    setBdLoading(false)
  }

  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState(null)

  async function handleTrigger() {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      await triggerABCSync()
      setTriggerMsg('Sync started — refresh in a few minutes to see results.')
    } catch (err) {
      setTriggerMsg('Failed: ' + err.message)
    }
    setTriggering(false)
  }

  useEffect(() => {
    if (tab === 'changelog') loadChangelog(1)
    if (tab === 'unmatched') loadUnmatched(1)
  }, [tab, selectedRun])

  if (loading && !summary) return <div className="text-text-muted text-sm p-4">Loading ABC sync data...</div>
  if (error && !summary) return <div className="text-red-500 text-sm p-4">{error}</div>
  if (!summary || !summary.run_id) return <div className="text-text-muted text-sm p-4">No sync runs found yet. The ABC sync runs every 30 minutes — data will appear after the first run.</div>

  const { totals, clubs, dry_run, run_at } = summary

  return (
    <div className="space-y-6">
      {/* Dry Run Banner */}
      {dry_run ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 font-bold text-sm uppercase tracking-wide">DRY RUN MODE</span>
          </div>
          <p className="text-red-300 text-xs mt-1">No changes are being made to GHL. Review the data below, then set DRY_RUN=false to go live.</p>
        </div>
      ) : (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-green-400 font-bold text-sm uppercase tracking-wide">LIVE MODE</span>
          </div>
          <p className="text-green-300 text-xs mt-1">Changes are being applied to GHL contacts.</p>
        </div>
      )}

      {/* Run Selector + Summary Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">Last Sync</p>
          <p className="text-sm text-text-primary font-medium">{formatDate(run_at)}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {triggering ? 'Starting...' : 'Run Sync Now'}
          </button>
          {triggerMsg && <span className="text-xs text-text-muted">{triggerMsg}</span>}
          <button onClick={loadInitial} className="text-xs text-wcs-red hover:underline">Refresh</button>
          {runs.length > 1 && (
            <select
              value={selectedRun || ''}
              onChange={e => loadRun(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-primary"
            >
              {runs.map(r => (
                <option key={r.run_id} value={r.run_id}>
                  {formatDate(r.run_at)} {r.dry_run ? '(dry)' : '(live)'}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Totals Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: 'ABC Members', value: totals.total_abc_members },
          { label: 'GHL Matched', value: totals.matched },
          { label: 'Unmatched', value: totals.unmatched, warn: totals.unmatched > 0 },
          { label: 'Tag Changes', value: totals.tag_changes },
          { label: 'Field Updates', value: totals.field_updates },
          { label: 'Errors', value: totals.errors, warn: totals.errors > 0 },
        ].map(card => (
          <div key={card.label} className="bg-surface border border-border rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-text-primary">{(card.value || 0).toLocaleString()}</p>
            <p className={`text-xs uppercase tracking-wide mt-1 ${card.warn ? 'text-orange-400 font-semibold' : 'text-text-muted'}`}>{card.label}</p>
          </div>
        ))}
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'overview', label: 'Per-Club Breakdown' },
          { key: 'changelog', label: `Change Log (${totals.tag_changes + totals.field_updates})` },
          { key: 'unmatched', label: `Unmatched (${totals.unmatched})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-wcs-red text-wcs-red' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-8 gap-2 px-4 py-2 text-xs text-text-muted uppercase tracking-wide font-semibold">
            <span className="col-span-2">Club</span>
            <span className="text-right">ABC Total</span>
            <span className="text-right">Active</span>
            <span className="text-right">Inactive</span>
            <span className="text-right">Matched</span>
            <span className="text-right">Unmatched</span>
            <span className="text-right">Changes</span>
          </div>
          {clubs.map(club => (
            <div key={club.club_number}>
              <button
                onClick={() => loadBreakdown(club.club_number)}
                className="w-full grid grid-cols-8 gap-2 px-4 py-3 bg-surface border border-border rounded-xl text-sm hover:bg-bg/50 transition-colors items-center"
              >
                <span className="col-span-2 text-left font-medium text-text-primary flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 text-text-muted transition-transform ${expandedClub === club.club_number ? 'rotate-90' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  {club.club_name}
                </span>
                <span className="text-right text-text-primary">{club.abc_total.toLocaleString()}</span>
                <span className="text-right text-green-400">{club.abc_active.toLocaleString()}</span>
                <span className="text-right text-text-muted">{club.abc_inactive.toLocaleString()}</span>
                <span className="text-right text-text-primary">{club.matched}</span>
                <span className={`text-right ${club.unmatched > 0 ? 'text-orange-400' : 'text-text-muted'}`}>{club.unmatched}</span>
                <span className="text-right text-text-muted">{club.tag_changes + club.field_updates}</span>
              </button>

              {/* Membership type breakdown */}
              {expandedClub === club.club_number && (
                <div className="ml-8 mr-4 my-2 bg-bg rounded-xl border border-border overflow-hidden">
                  {bdLoading ? (
                    <p className="text-xs text-text-muted p-3">Loading...</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-4 gap-2 px-4 py-2 text-xs text-text-muted uppercase tracking-wide font-semibold border-b border-border">
                        <span>Membership Type</span>
                        <span className="text-right">Active</span>
                        <span className="text-right">Inactive</span>
                        <span className="text-right">Total</span>
                      </div>
                      {breakdown
                        .filter(b => b.club_number === club.club_number)
                        .sort((a, b) => b.total - a.total)
                        .map(b => (
                          <div key={b.membership_type} className="grid grid-cols-4 gap-2 px-4 py-2 text-sm border-b border-border last:border-0">
                            <span className="text-text-primary">{b.membership_type}</span>
                            <span className="text-right text-green-400">{b.active}</span>
                            <span className="text-right text-text-muted">{b.inactive}</span>
                            <span className="text-right text-text-primary font-medium">{b.total}</span>
                          </div>
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'changelog' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <select
              value={clFilters.club_number}
              onChange={e => { const v = e.target.value; setClFilters(f => ({ ...f, club_number: v })); loadChangelog(1, { club_number: v }) }}
              className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-primary"
            >
              <option value="">All Clubs</option>
              {clubs.map(c => <option key={c.club_number} value={c.club_number}>{c.club_name}</option>)}
            </select>
            <select
              value={clFilters.action}
              onChange={e => { const v = e.target.value; setClFilters(f => ({ ...f, action: v })); loadChangelog(1, { action: v }) }}
              className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-primary"
            >
              <option value="">All Actions</option>
              <option value="add_tag">Add Tag</option>
              <option value="remove_tag">Remove Tag</option>
              <option value="update_field">Update Field</option>
            </select>
            <input
              type="text"
              placeholder="Search name or email..."
              value={clFilters.search}
              onChange={e => setClFilters(f => ({ ...f, search: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && loadChangelog(1)}
              className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-primary flex-1 min-w-[180px]"
            />
            <button onClick={() => loadChangelog(1)} className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90">Search</button>
          </div>

          {clLoading ? <p className="text-xs text-text-muted">Loading...</p> : (
            <>
              <div className="text-xs text-text-muted">{changelog.total} results</div>
              <div className="space-y-1">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-text-muted uppercase tracking-wide font-semibold">
                  <span className="col-span-2">Club</span>
                  <span className="col-span-3">Contact</span>
                  <span className="col-span-2">Action</span>
                  <span className="col-span-3">Detail</span>
                  <span className="text-center">Applied</span>
                  <span className="text-center">Error</span>
                </div>
                {changelog.data.map((entry, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-xs items-center">
                    <span className="col-span-2 text-text-muted truncate">{entry.club_name}</span>
                    <div className="col-span-3 truncate">
                      <span className="text-text-primary">{entry.ghl_contact_name}</span>
                      {entry.ghl_contact_email && <span className="text-text-muted block truncate">{entry.ghl_contact_email}</span>}
                    </div>
                    <span className="col-span-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.action === 'add_tag' ? 'bg-green-500/10 text-green-400' :
                        entry.action === 'remove_tag' ? 'bg-red-500/10 text-red-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>{entry.action.replace('_', ' ')}</span>
                    </span>
                    <span className="col-span-3 text-text-muted truncate">
                      {entry.detail?.tag && `Tag: ${entry.detail.tag}`}
                      {entry.detail?.field && `${entry.detail.field}: ${entry.detail.from || '—'} → ${entry.detail.to}`}
                    </span>
                    <span className="text-center">{entry.applied ? '✅' : '⏸'}</span>
                    <span className="text-center">{entry.error ? '❌' : ''}</span>
                  </div>
                ))}
              </div>
              {/* Pagination */}
              {changelog.total > 50 && (
                <div className="flex justify-center gap-2 pt-2">
                  <button disabled={clPage <= 1} onClick={() => loadChangelog(clPage - 1)} className="text-xs px-3 py-1 border border-border rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30">Prev</button>
                  <span className="text-xs text-text-muted py-1">Page {clPage} of {Math.ceil(changelog.total / 50)}</span>
                  <button disabled={clPage >= Math.ceil(changelog.total / 50)} onClick={() => loadChangelog(clPage + 1)} className="text-xs px-3 py-1 border border-border rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30">Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'unmatched' && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <select
              value={umClub}
              onChange={e => { setUmClub(e.target.value); loadUnmatched(1) }}
              className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-primary"
            >
              <option value="">All Clubs</option>
              {clubs.map(c => <option key={c.club_number} value={c.club_number}>{c.club_name}</option>)}
            </select>
            <span className="text-xs text-text-muted py-1.5">{unmatched.total} unmatched members</span>
          </div>

          {umLoading ? <p className="text-xs text-text-muted">Loading...</p> : (
            <>
              <div className="space-y-1">
                <div className="grid grid-cols-6 gap-2 px-4 py-2 text-xs text-text-muted uppercase tracking-wide font-semibold">
                  <span className="col-span-2">Name</span>
                  <span className="col-span-2">Email</span>
                  <span>Club</span>
                  <span>ABC Member ID</span>
                </div>
                {unmatched.data.map((entry, i) => (
                  <div key={i} className="grid grid-cols-6 gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-xs items-center">
                    <span className="col-span-2 text-text-primary">{entry.detail?.abc_name || '—'}</span>
                    <span className="col-span-2 text-text-muted truncate">{entry.detail?.abc_email || '—'}</span>
                    <span className="text-text-muted">{entry.club_name}</span>
                    <span className="text-text-muted truncate">{entry.abc_member_id}</span>
                  </div>
                ))}
              </div>
              {unmatched.total > 50 && (
                <div className="flex justify-center gap-2 pt-2">
                  <button disabled={umPage <= 1} onClick={() => loadUnmatched(umPage - 1)} className="text-xs px-3 py-1 border border-border rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30">Prev</button>
                  <span className="text-xs text-text-muted py-1">Page {umPage} of {Math.ceil(unmatched.total / 50)}</span>
                  <button disabled={umPage >= Math.ceil(unmatched.total / 50)} onClick={() => loadUnmatched(umPage + 1)} className="text-xs px-3 py-1 border border-border rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30">Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
