import React, { useState, useEffect } from 'react'
import { getTicketStatus, refreshTicketStatus } from '../../lib/api'
import MobileLoading from './MobileLoading'

function Dropdown({ title, items, emptyMsg, renderItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-bg border border-border text-sm text-text-primary active:border-text-muted transition-colors"
      >
        <span className="font-medium">{title} <span className="text-text-muted">({items.length})</span></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="bg-bg border border-border rounded-xl mt-2 max-h-72 overflow-y-auto">
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
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <h3 className="text-base font-bold text-text-primary flex-1">{list.name}</h3>
        {list.description && (
          <span className="text-[11px] text-text-muted shrink-0">{list.description}</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 py-3 border-y border-border">
        <div className="text-center">
          <p className="text-[10px] text-text-muted uppercase tracking-wide">Avg Close</p>
          <p className="text-xl font-bold text-text-primary mt-1 leading-none">{list.averageFormatted}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-text-muted uppercase tracking-wide">Outstanding</p>
          <p className="text-xl font-bold text-text-primary mt-1 leading-none">{list.outstandingCount}</p>
          {list.outstandingAvgFormatted && list.outstandingAvgFormatted !== 'N/A' && (
            <p className="text-[10px] text-text-muted mt-1">avg open: {list.outstandingAvgFormatted}</p>
          )}
        </div>
        <div className="text-center">
          <p className="text-[10px] text-text-muted uppercase tracking-wide">Closed</p>
          <p className="text-xl font-bold text-text-primary mt-1 leading-none">{list.closedCount ?? list.tasksWithData}</p>
          <p className="text-[10px] text-text-muted mt-1">of {list.taskCount}</p>
        </div>
      </div>

      <div className="space-y-2 mt-3">
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

export default function MobileTicketsStatus({ onBack }) {
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
    <div className="px-4 pt-4 pb-8">
      {/* Header */}
      <div className="bg-surface border border-border rounded-2xl shadow-sm px-4 py-3 mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 -ml-1 rounded-lg active:bg-bg transition-colors"
            aria-label="Go back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-text-primary">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h2 className="text-lg font-bold text-text-primary truncate flex-1">Ticket Status</h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-wcs-red text-white shadow active:translate-y-px transition disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {refreshing ? '…' : 'Refresh'}
          </button>
        </div>
        {updatedLabel && (
          <p className="text-[10px] text-text-muted mt-2">
            <span className="uppercase tracking-wide">Last updated</span>{' '}
            <span className="font-semibold text-text-primary">{updatedLabel}</span>
          </p>
        )}
      </div>

      {loading && <MobileLoading variant="list" count={2} className="px-0 py-0" />}

      {error && !loading && (
        <div className="bg-surface rounded-2xl border border-wcs-red/30 shadow-sm p-4 mb-3">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {data && (
        <>
          <div className="space-y-3">
            {data.lists.map(list => <ListCard key={list.name} list={list} />)}
          </div>
          <p className="text-center text-[11px] text-text-muted mt-4 bg-surface/95 backdrop-blur-sm rounded-lg px-2.5 py-1 inline-block w-full">Auto-refreshes every hour</p>
        </>
      )}
    </div>
  )
}
