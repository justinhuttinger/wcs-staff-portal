import { useState, useEffect } from 'react'
import { getTicketStatus, refreshTicketStatus } from '../lib/api'

function Dropdown({ title, items, emptyMsg, renderItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text-primary hover:border-text-muted transition-colors mb-2"
      >
        <span>{title} ({items.length})</span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div className="bg-bg border border-border rounded-lg max-h-72 overflow-y-auto mb-3">
          {items.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">{emptyMsg}</div>
          ) : (
            items.map((item, i) => (
              <div key={i} className="px-4 py-3 border-b border-border last:border-b-0">
                {renderItem(item)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ListCard({ list }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-text-primary">{list.name}</h3>
        {list.description && (
          <span className="text-xs text-text-muted">{list.description}</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 py-4 border-y border-border">
        <div className="text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Avg Time to Close</p>
          <p className="text-3xl font-bold text-text-primary mt-1">{list.averageFormatted}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Outstanding</p>
          <p className="text-3xl font-bold text-text-primary mt-1">{list.outstandingCount}</p>
          {list.outstandingAvgFormatted && list.outstandingAvgFormatted !== 'N/A' && (
            <p className="text-[11px] text-text-muted mt-1">avg open: {list.outstandingAvgFormatted}</p>
          )}
        </div>
        <div className="text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Closed</p>
          <p className="text-3xl font-bold text-text-primary mt-1">{list.closedCount ?? list.tasksWithData}</p>
          <p className="text-[11px] text-text-muted mt-1">of {list.taskCount} total</p>
        </div>
      </div>

      <div className="space-y-1 mt-4">
        <Dropdown
          title="Outstanding Tickets"
          items={list.outstandingTasks}
          emptyMsg="No outstanding tickets"
          renderItem={(t) => (
            <>
              <p className="text-sm font-semibold text-text-primary">{t.name}</p>
              <p className="text-xs text-text-muted mt-1">
                {t.customField !== 'N/A' && <span>{t.customField} · </span>}
                <span className="text-wcs-red font-medium">Waiting: {t.timeWaiting}</span>
              </p>
            </>
          )}
        />
        <Dropdown
          title="Recently Completed"
          items={list.recentlyCompletedTasks}
          emptyMsg="No tickets completed in last 5 days"
          renderItem={(t) => (
            <>
              <p className="text-sm font-semibold text-text-primary">{t.name}</p>
              <p className="text-xs text-text-muted mt-1">
                {t.customField !== 'N/A' && <span>{t.customField} · </span>}
                <span className="text-green-600 font-medium">Completed: {t.completedDate}</span>
              </p>
            </>
          )}
        />
      </div>
    </div>
  )
}

export default function TicketsStatusView({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getTicketStatus()
      .then(res => setData(res))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    setError('')
    try {
      const res = await refreshTicketStatus()
      setData(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  const updatedLabel = data?.updated
    ? new Date(data.updated).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short' }) + ' PT'
    : null

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="text-lg font-bold text-text-primary">Ticket Status</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg bg-wcs-red text-white shadow hover:brightness-110 active:translate-y-px transition disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {refreshing ? 'Refreshing…' : 'Refresh Now'}
        </button>
      </div>

      {loading && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">Loading ticket data… (first load may take ~30s while ClickUp data is gathered)</p>
        </div>
      )}

      {error && !loading && (
        <div className="bg-surface rounded-xl border border-wcs-red/30 p-4 mb-4">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {data && (
        <>
          <div className="space-y-4">
            {data.lists.map(list => <ListCard key={list.name} list={list} />)}
          </div>
          {updatedLabel && (
            <p className="text-center text-xs text-text-muted mt-6">
              Data updated: {updatedLabel}{data.fromCache ? ' (cached)' : ''} · auto-refreshes every hour
            </p>
          )}
        </>
      )}
    </div>
  )
}
