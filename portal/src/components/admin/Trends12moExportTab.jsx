import { useState } from 'react'
import { downloadTrends12moReport } from '../../lib/api'

// Build a list of recent month options for the end-month picker.
// Default = current month; users can pick up to 23 months back.
function buildMonthOptions() {
  const out = []
  const now = new Date()
  const startYear = now.getUTCFullYear()
  const startMonth = now.getUTCMonth() // 0-11
  for (let i = 0; i < 24; i++) {
    let m = startMonth - i
    let y = startYear
    while (m < 0) { m += 12; y -= 1 }
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const label = new Date(Date.UTC(y, m, 1)).toLocaleString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    })
    out.push({ key, label })
  }
  return out
}

const MONTH_OPTIONS = buildMonthOptions()

export default function Trends12moExportTab() {
  const [endMonth, setEndMonth] = useState(MONTH_OPTIONS[0].key)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  async function handleGenerate() {
    setDownloading(true)
    setError(null)
    setSuccess(false)
    try {
      await downloadTrends12moReport({ locationSlug: 'all', endMonth })
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  const rangeStart = (() => {
    const [y, m] = endMonth.split('-').map(Number)
    let sy = y, sm = m - 11
    while (sm < 1) { sm += 12; sy -= 1 }
    return new Date(Date.UTC(sy, sm - 1, 1)).toLocaleString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    })
  })()
  const rangeEnd = MONTH_OPTIONS.find(o => o.key === endMonth)?.label || endMonth

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          12-Month Trends Excel Report
        </h3>
        <p className="text-xs text-text-muted mb-5 leading-relaxed">
          Pulls 12 months of ABC member, agreement, revenue, and demographic
          data across <strong>all 7 locations</strong> into one Excel workbook.
          Every sheet shows the all-locations rollup <em>and</em> a per-location
          breakdown (table + chart). The Demographics sheet reconstructs the
          active roster at each month-end so historical totals work.
        </p>

        <div className="mb-5 max-w-xs">
          <label className="block text-xs font-medium text-text-primary mb-1.5">
            End month
          </label>
          <select
            value={endMonth}
            onChange={(e) => setEndMonth(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-wcs-red/40"
          >
            {MONTH_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-text-muted mb-4">
          Range: <strong>{rangeStart}</strong> → <strong>{rangeEnd}</strong> • All locations
        </p>

        <button
          onClick={handleGenerate}
          disabled={downloading}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {downloading ? 'Generating workbook…' : 'Generate Report (.xlsx)'}
        </button>

        {downloading && (
          <p className="mt-3 text-xs text-text-muted">
            Building 12 monthly snapshots + ~25 charts across all locations.
            This usually takes 15-40 seconds.
          </p>
        )}
        {error && (
          <p className="mt-4 text-xs text-wcs-red whitespace-pre-wrap">{error}</p>
        )}
        {success && !error && (
          <p className="mt-4 text-xs text-green-600">
            Done — check your Downloads folder.
          </p>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">What's in the workbook</h3>
        <ul className="text-xs text-text-muted leading-relaxed space-y-1 list-disc list-inside">
          <li><strong>Summary</strong> — KPI tiles + line charts (members + revenue overall; net change per location; revenue per location)</li>
          <li><strong>Members</strong> — all-locations table + bar chart; per-location pivots & line charts for added, dropped, and active (EOM)</li>
          <li><strong>Agreements</strong> — same shape, by agreement number</li>
          <li><strong>Revenue</strong> — profit-center pivot + stacked bar; per-location pivot + line chart + stacked composition</li>
          <li><strong>Demographics</strong> — age/gender/membership type by month; active members EOM by location; net change by location</li>
          <li><strong>Active Roster (Today)</strong> — three pies + per-club table + comparison bar chart</li>
        </ul>
        <p className="mt-4 text-[11px] text-text-muted leading-relaxed">
          <strong>Caveat:</strong> demographic fields (gender, membership type,
          home club) on ABC members reflect the <em>current</em> row value, not
          the value on the historical date. Age is computed from birth date so
          it is fully historical. Membership-type drift (upgrades/downgrades)
          is the most common source of imprecision in historical demographics.
        </p>
      </div>
    </div>
  )
}
