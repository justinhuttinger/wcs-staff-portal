import { useState } from 'react'
import { getSMSMessages, syncSMSMessages, searchSMSHistory } from '../../lib/api'

const QUICK_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'last_7', label: 'Last 7 Days' },
  { key: 'last_30', label: 'Last 30 Days' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  switch (key) {
    case 'today':
      return { start: today, end: today }
    case 'last_7': {
      const s = new Date(now)
      s.setDate(s.getDate() - 7)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'last_30': {
      const s = new Date(now)
      s.setDate(s.getDate() - 30)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    default:
      return { start: today, end: today }
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatPhone(phone) {
  if (!phone) return '—'
  // Format +1XXXXXXXXXX to (XXX) XXX-XXXX
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

export default function SMSHistoryTab() {
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [search, setSearch] = useState('')
  const [activeQuick, setActiveQuick] = useState('last_7')
  const [messages, setMessages] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [syncResult, setSyncResult] = useState(null)
  const [source, setSource] = useState('live') // 'live' or 'db'

  function applyQuickRange(key) {
    setActiveQuick(key)
    const range = getQuickRange(key)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  async function handleFetch() {
    setLoading(true)
    setError(null)
    setSyncResult(null)
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (search) params.search = search

      let data
      if (source === 'db') {
        data = await searchSMSHistory(params)
      } else {
        data = await getSMSMessages(params)
      }
      setMessages(data.messages || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      const data = await syncSMSMessages({
        start_date: startDate,
        end_date: endDate,
      })
      setSyncResult(data.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
        {/* Quick Ranges + Source Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {QUICK_RANGES.map(qr => (
              <button
                key={qr.key}
                onClick={() => applyQuickRange(qr.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  activeQuick === qr.key
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary'
                }`}
              >
                {qr.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Source:</span>
            <button
              onClick={() => setSource(s => s === 'live' ? 'db' : 'live')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                source === 'live'
                  ? 'bg-wcs-red/10 text-wcs-red border-wcs-red/30'
                  : 'bg-bg text-text-muted border-border'
              }`}
            >
              {source === 'live' ? 'Twilio (Live)' : 'Database'}
            </button>
          </div>
        </div>

        {/* Date Range + Search */}
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setActiveQuick(null) }}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setActiveQuick(null) }}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-text-muted mb-1">Search Body</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
              placeholder="Keyword search..."
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={loading}
            className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? 'Loading...' : 'Fetch'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-bg text-text-primary text-sm font-medium rounded-lg border border-border hover:border-wcs-red transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? 'Syncing...' : 'Sync to DB'}
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {syncResult && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
          {syncResult}
        </div>
      )}

      {/* Results */}
      {messages.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-text-muted font-medium">
              {total} message{total !== 1 ? 's' : ''} found
              <span className="ml-2 text-text-muted/60">({source === 'live' ? 'from Twilio' : 'from database'})</span>
            </p>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted w-[160px]">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted w-[140px]">From</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Message</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted w-[80px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {messages.map(m => (
                  <tr key={m.sid} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                    <td className="px-4 py-2.5 text-text-muted text-xs whitespace-nowrap">
                      {formatDate(m.date_sent)}
                    </td>
                    <td className="px-4 py-2.5 text-text-primary text-xs font-medium whitespace-nowrap">
                      {formatPhone(m.from || m.from_number)}
                    </td>
                    <td className="px-4 py-2.5 text-text-primary text-xs">
                      {m.body}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        m.status === 'received' ? 'bg-green-100 text-green-700' :
                        m.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-bg text-text-muted border border-border'
                      }`}>
                        {m.status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && messages.length === 0 && !error && (
        <div className="text-center py-12 text-text-muted text-sm">
          Select a date range and click Fetch to pull SMS messages from Twilio.
        </div>
      )}
    </div>
  )
}
