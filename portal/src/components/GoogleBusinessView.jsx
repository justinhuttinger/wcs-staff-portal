import { useState, useEffect } from 'react'
import { getGoogleBusinessStatus, getGoogleBusinessPerformance } from '../lib/api'

const QUICK_RANGES = [
  { key: 'last_7', label: '7 Days' },
  { key: 'last_30', label: '30 Days' },
  { key: 'last_90', label: '90 Days' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const days = key === 'last_7' ? 7 : key === 'last_30' ? 30 : 90
  const s = new Date(now); s.setDate(s.getDate() - days)
  return { start: s.toISOString().split('T')[0], end: today }
}

function fmtNum(val) { return Number(val || 0).toLocaleString() }

function StatCard({ label, value }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mt-1">{label}</p>
    </div>
  )
}

// Extract location display name from title like "West Coast Strength - Salem"
function locDisplayName(title) {
  if (!title) return 'Unknown'
  const dash = title.lastIndexOf('-')
  if (dash > 0) return title.substring(dash + 1).trim()
  return title
}

export default function GoogleBusinessView({ onBack }) {
  const [authorized, setAuthorized] = useState(null)
  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeQuick, setActiveQuick] = useState('last_30')
  const [startDate, setStartDate] = useState(() => getQuickRange('last_30').start)
  const [endDate, setEndDate] = useState(() => getQuickRange('last_30').end)

  useEffect(() => { checkStatus() }, [])

  async function checkStatus() {
    try {
      const res = await getGoogleBusinessStatus()
      setAuthorized(res.authorized)
      if (res.authorized) loadData()
      else setLoading(false)
    } catch {
      setAuthorized(false)
      setLoading(false)
    }
  }

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await getGoogleBusinessPerformance({ start_date: startDate, end_date: endDate })
      setMetrics(res.metrics || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function applyQuickRange(key) {
    setActiveQuick(key)
    const range = getQuickRange(key)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  useEffect(() => { if (authorized && activeQuick) loadData() }, [activeQuick])

  // Compute totals across all locations
  const totals = { searches: 0, website_clicks: 0, calls: 0, directions: 0 }
  for (const m of metrics) {
    if (!m.error) {
      totals.searches += m.searches || 0
      totals.website_clicks += m.website_clicks || 0
      totals.calls += m.calls || 0
      totals.directions += m.directions || 0
    }
  }

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

  return (
    <div className="max-w-5xl mx-auto w-full px-8 py-6">
      <div className="mb-5">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Marketing
        </button>
        <h2 className="text-xl font-bold text-text-primary">Google Business Profile</h2>
        <p className="text-sm text-text-muted">Search performance across all locations</p>
      </div>

      {/* Not authorized */}
      {authorized === false && (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-text-muted text-sm mb-4">Google Business Profile is not connected yet.</p>
          <a
            href={API_URL + '/google-business/authorize'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-6 py-3 bg-wcs-red text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            Connect Google Business Profile
          </a>
        </div>
      )}

      {/* Authorized — show data */}
      {authorized && (
        <>
          {/* Date Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex gap-1">
              {QUICK_RANGES.map(qr => (
                <button key={qr.key} onClick={() => applyQuickRange(qr.key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    activeQuick === qr.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-surface text-text-muted border-border hover:text-text-primary'
                  }`}>
                  {qr.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setActiveQuick(null) }}
                className="px-2 py-1 bg-bg border border-border rounded-lg text-xs text-text-primary" />
              <span className="text-text-muted text-xs">to</span>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setActiveQuick(null) }}
                className="px-2 py-1 bg-bg border border-border rounded-lg text-xs text-text-primary" />
              {!activeQuick && <button onClick={loadData} className="px-3 py-1 bg-wcs-red text-white text-xs font-medium rounded-lg">Apply</button>}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm mb-5">{error}</div>}
          {loading && <p className="text-text-muted text-sm py-12 text-center">Loading Google Business data...</p>}

          {!loading && (
            <>
              {/* Totals */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <StatCard label="Search Views" value={fmtNum(totals.searches)} />
                <StatCard label="Website Clicks" value={fmtNum(totals.website_clicks)} />
                <StatCard label="Phone Calls" value={fmtNum(totals.calls)} />
                <StatCard label="Direction Requests" value={fmtNum(totals.directions)} />
              </div>

              {/* Per-Location Table */}
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-xs text-text-muted font-semibold uppercase">By Location ({metrics.filter(m => !m.error).length})</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Location</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Searches</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Website</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Calls</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Directions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No location data found</td></tr>
                    )}
                    {metrics.map((m, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                        <td className="px-4 py-2.5 text-text-primary font-medium text-xs">
                          {m.error ? <span className="text-wcs-red">{locDisplayName(m.title || m.location)} (error)</span> : locDisplayName(m.title || m.location)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-primary text-xs">{m.error ? '—' : fmtNum(m.searches)}</td>
                        <td className="px-4 py-2.5 text-right text-text-muted text-xs">{m.error ? '—' : fmtNum(m.website_clicks)}</td>
                        <td className="px-4 py-2.5 text-right text-text-muted text-xs">{m.error ? '—' : fmtNum(m.calls)}</td>
                        <td className="px-4 py-2.5 text-right text-text-muted text-xs">{m.error ? '—' : fmtNum(m.directions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
