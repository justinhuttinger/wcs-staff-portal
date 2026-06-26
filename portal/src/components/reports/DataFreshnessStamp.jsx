import { useEffect, useState } from 'react'
import { getDataFreshness } from '../../lib/api'

// "Updated 6 min ago" relative label.
function fmtAgo(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const d = Math.floor(hr / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

// Small "Data updated X ago" cue showing when the sync last refreshed report
// data. Self-fetches; pass a changing `refreshKey` to re-check. Inherits the
// surrounding text color via text-text-muted so it stays readable on the report
// title row (not buried on a dark surface).
export default function DataFreshnessStamp({ refreshKey, className = '' }) {
  const [freshness, setFreshness] = useState(null)
  useEffect(() => {
    let cancelled = false
    getDataFreshness().then(r => { if (!cancelled) setFreshness(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [refreshKey])

  const ago = fmtAgo(freshness?.last_sync_at)
  if (!ago) return null
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap ${className}`}
      title={`Last sync completed ${new Date(freshness.last_sync_at).toLocaleString()}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
      Data updated {ago}
    </span>
  )
}
