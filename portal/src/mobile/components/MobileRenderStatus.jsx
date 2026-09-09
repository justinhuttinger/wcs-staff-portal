import React, { useState, useEffect, useCallback } from 'react'
import MobileHeader from './MobileHeader'
import WcsLoadingMark from '../../components/WcsLoadingMark'
import { getRenderStatus, getRenderServiceLogs } from '../../lib/api'

// Admin-only Render infrastructure status. Read-only by design: this screen
// answers "is anything down" and "what is eating the bandwidth quota" from a
// phone. Anything destructive stays in Render's own dashboard.

const STATE_STYLES = {
  failed: { dot: 'bg-red-500', label: 'Deploy failed' },
  deploying: { dot: 'bg-amber-500 animate-pulse', label: 'Deploying' },
  live: { dot: 'bg-emerald-500', label: 'Live' },
  suspended: { dot: 'bg-text-muted', label: 'Suspended' },
  unknown: { dot: 'bg-text-muted', label: 'No recent deploy' },
}

const LEVEL_BAR = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  over: 'bg-red-500',
}

function fmtGb(gb) {
  const n = Number(gb)
  if (!Number.isFinite(n)) return '0 GB'
  if (n >= 10) return n.toFixed(0) + ' GB'
  if (n >= 1) return n.toFixed(1) + ' GB'
  if (n === 0) return '0 GB'
  return (n * 1024).toFixed(0) + ' MB'
}

function fmtBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i]
}

function timeAgo(iso) {
  if (!iso) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  return Math.round(hrs / 24) + 'd ago'
}

function RefreshIcon({ spinning }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"
      className={'w-5 h-5 text-text-secondary ' + (spinning ? 'animate-spin' : '')}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M16.023 9.348h4.992V4.356m-4.992 4.992l3.181-3.183a8.25 8.25 0 00-13.803 3.7M4.031 9.865v4.992m0 0h4.992m-4.993 0l3.182 3.182a8.25 8.25 0 0013.803-3.7" />
    </svg>
  )
}

// Month-to-date bandwidth against the plan's included allowance. This is the
// number that matters: Render bills overage per GB once it is crossed.
function RollupCard({ rollup, window }) {
  if (!rollup) return null
  const pct = rollup.pct
  const width = pct === null ? 0 : Math.min(100, pct)
  const since = window?.startTime
    ? new Date(window.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="bg-surface border border-border rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-text-secondary">Bandwidth this month</span>
        {pct !== null && (
          <span className={'text-sm font-semibold ' + (
            rollup.level === 'over' ? 'text-red-500'
              : rollup.level === 'warn' ? 'text-amber-500'
                : 'text-text-secondary'
          )}>{pct}%</span>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-text-primary">{fmtGb(rollup.totalGb)}</span>
        {rollup.capGb !== null && (
          <span className="text-sm text-text-muted">of {rollup.capGb} GB</span>
        )}
      </div>

      <div className="mt-3 h-2 rounded-full bg-bg overflow-hidden">
        <div
          className={'h-full rounded-full transition-all ' + (LEVEL_BAR[rollup.level] || LEVEL_BAR.ok)}
          style={{ width: width + '%' }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-text-muted">{since ? 'Since ' + since : 'Month to date'}</span>
        {rollup.overageGb > 0 && (
          <span className="text-red-500 font-medium">{fmtGb(rollup.overageGb)} over</span>
        )}
      </div>

      {rollup.unhealthy > 0 && (
        <div className="mt-3 pt-3 border-t border-border text-sm text-red-500 font-medium">
          {rollup.unhealthy} service{rollup.unhealthy === 1 ? '' : 's'} with a failed deploy
        </div>
      )}
    </div>
  )
}

function ErrorLogs({ serviceId }) {
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLogs(null)
    setError(null)
    getRenderServiceLogs(serviceId)
      .then(res => { if (!cancelled) setLogs(res?.logs || []) })
      .catch(err => { if (!cancelled) setError(err?.message || 'Could not load logs') })
    return () => { cancelled = true }
  }, [serviceId])

  if (error) return <p className="text-xs text-text-muted">{error}</p>
  if (logs === null) return <p className="text-xs text-text-muted">Loading logs...</p>
  if (logs.length === 0) return <p className="text-xs text-text-muted">No errors in the last 24 hours.</p>

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="text-xs">
          <div className="text-text-muted">{timeAgo(log.timestamp)}</div>
          <div className="font-mono text-text-secondary break-words whitespace-pre-wrap">{log.message}</div>
        </div>
      ))}
    </div>
  )
}

function ServiceCard({ svc, expanded, onToggle }) {
  const style = STATE_STYLES[svc.state] || STATE_STYLES.unknown
  const mem = fmtBytes(svc.memoryBytes?.used)

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 active:bg-bg transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5">
          <span className={'w-2.5 h-2.5 rounded-full flex-shrink-0 ' + style.dot} />
          <span className="font-semibold text-text-primary truncate flex-1">{svc.name}</span>
          <span className="text-sm font-medium text-text-secondary flex-shrink-0">
            {fmtGb(svc.bandwidthGb)}
          </span>
        </div>

        <div className="mt-1 pl-5 flex items-center gap-2 text-xs text-text-muted flex-wrap">
          <span className={svc.state === 'failed' ? 'text-red-500 font-medium' : ''}>{style.label}</span>
          {svc.deploy?.finishedAt && <span>{timeAgo(svc.deploy.finishedAt)}</span>}
          {svc.plan && <span className="capitalize">{svc.plan}</span>}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          <div className="grid grid-cols-2 gap-3 pt-3">
            <div>
              <div className="text-xs text-text-muted">CPU</div>
              <div className="text-sm font-medium text-text-primary">
                {svc.cpu?.pct !== null && svc.cpu?.pct !== undefined
                  ? svc.cpu.pct + '%'
                  : (svc.cpu?.used !== null && svc.cpu?.used !== undefined
                    ? Number(svc.cpu.used).toFixed(2)
                    : 'Not reported')}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Memory</div>
              <div className="text-sm font-medium text-text-primary">
                {svc.memoryBytes?.pct !== null && svc.memoryBytes?.pct !== undefined
                  ? svc.memoryBytes.pct + '%'
                  : (mem || 'Not reported')}
              </div>
            </div>
          </div>

          {svc.deploy?.commitMessage && (
            <div>
              <div className="text-xs text-text-muted">Last deploy</div>
              <div className="text-sm text-text-secondary break-words">{svc.deploy.commitMessage}</div>
            </div>
          )}

          <div>
            <div className="text-xs text-text-muted mb-1.5">Recent errors</div>
            <ErrorLogs serviceId={svc.id} />
          </div>

          {svc.dashboardUrl && (
            <a
              href={svc.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-wcs-red"
            >
              Open in Render
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export default function MobileRenderStatus() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [showSuspended, setShowSuspended] = useState(false)

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true)
    setError(null)
    try {
      const res = await getRenderStatus()
      setData(res)
    } catch (err) {
      setError(err?.message || 'Could not load Render status')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  if (loading) {
    return (
      <div className="pt-2">
        <div className="px-4"><MobileHeader title="Render" /></div>
        <div className="flex items-center justify-center py-20">
          <WcsLoadingMark size={56} className="text-wcs-red" />
        </div>
      </div>
    )
  }

  const services = data?.services || []
  const suspended = data?.suspended || []

  return (
    <div className="pt-2">
      <div className="px-4">
        <MobileHeader
          title="Render"
          rightAction={(
            <button onClick={() => load(true)} aria-label="Refresh" className="p-2 -mr-2 rounded-lg active:bg-bg">
              <RefreshIcon spinning={refreshing} />
            </button>
          )}
        />
      </div>

      <div className="px-4 py-3 space-y-3">
        {error && (
          <div className="bg-surface border border-red-500/40 rounded-2xl p-4">
            <p className="text-sm text-red-500 font-medium">{error}</p>
            <button onClick={() => load(true)} className="mt-2 text-sm font-medium text-wcs-red">
              Try again
            </button>
          </div>
        )}

        {!error && <RollupCard rollup={data?.rollup} window={data?.window} />}

        {services.map(svc => (
          <ServiceCard
            key={svc.id}
            svc={svc}
            expanded={expandedId === svc.id}
            onToggle={() => setExpandedId(expandedId === svc.id ? null : svc.id)}
          />
        ))}

        {!error && services.length === 0 && (
          <p className="text-sm text-text-muted text-center py-6">No active services.</p>
        )}

        {suspended.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowSuspended(!showSuspended)}
              className="text-sm font-medium text-text-secondary"
            >
              {showSuspended ? 'Hide' : 'Show'} suspended ({suspended.length})
            </button>
          </div>
        )}

        {showSuspended && suspended.map(svc => (
          <ServiceCard
            key={svc.id}
            svc={svc}
            expanded={expandedId === svc.id}
            onToggle={() => setExpandedId(expandedId === svc.id ? null : svc.id)}
          />
        ))}

        {data?.fetchedAt && (
          <p className="text-xs text-text-muted text-center pt-2">
            Updated {timeAgo(data.fetchedAt)}
          </p>
        )}
      </div>
    </div>
  )
}
