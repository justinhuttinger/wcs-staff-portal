import { useState } from 'react'
import { getPTReport } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell } from './StatBlock'

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function formatDate(val) {
  if (!val) return '—'
  if (typeof val === 'number' || (typeof val === 'string' && /^\d{10,}$/.test(val))) {
    // GHL date-picker values are the calendar date at midnight UTC — render in
    // UTC or the browser's Pacific offset shows the previous day.
    return new Date(parseInt(val)).toLocaleDateString('en-US', { timeZone: 'UTC' })
  }
  return val
}

// Click-to-sort arrow indicator (mirrors the Payroll/commissions report).
function SortArrow({ active, dir }) {
  if (!active) return null
  return <span className="ml-1 text-wcs-red">{dir === 'asc' ? '▲' : '▼'}</span>
}

// Sort value for each Trainer Stats column. Rows are [name, stats] entries.
const TRAINER_SORT = {
  trainer: ([name]) => (name || '').toLowerCase(),
  set: ([, s]) => s.total || 0,
  completed: ([, s]) => s.completed || 0,
  no_show: ([, s]) => s.no_show || 0,
  sales: ([, s]) => s.sales || 0,
  no_sale: ([, s]) => s.no_sales || 0,
  show_pct: ([, s]) => (s.total > 0 ? (s.completed || 0) / s.total : 0),
  close_pct: ([, s]) => (s.completed > 0 ? (s.sales || 0) / s.completed : 0),
}

// Sort value for each Day One Breakdown column.
const DAY_ONE_SORT = {
  name: c => `${c.last_name || ''} ${c.first_name || ''}`.trim().toLowerCase(),
  booking_team_member: c => (c.day_one_booking_team_member || '').toLowerCase(),
  booking_date: c => c.day_one_booking_date || '',
  day_one_date: c => c.day_one_date || '',
  trainer: c => (c.day_one_trainer || '').toLowerCase(),
  status: c => (c.day_one_status || '').toLowerCase(),
  sale: c => (c.day_one_sale || '').toLowerCase(),
}

function StatusPill({ status }) {
  const s = (status || '').toLowerCase()
  if (s === 'show' || s === 'completed' || s === 'complete') {
    return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">{status}</span>
  }
  if (s === 'no show' || s === 'no-show' || s === 'noshow') {
    return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs border border-red-200">{status}</span>
  }
  return <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">{status || '—'}</span>
}

function DetailModal({ contact, onClose }) {
  const c = contact
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text-primary">{capitalize(c.first_name)} {capitalize(c.last_name)}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Booking Team Member</span>
            <span className="text-text-primary font-medium">{c.day_one_booking_team_member || '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Date Scheduled</span>
            <span className="text-text-primary font-medium">{formatDate(c.day_one_booking_date)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Day One Date</span>
            <span className="text-text-primary font-medium">{formatDate(c.day_one_date)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Trainer</span>
            <span className="text-text-primary font-medium">{c.day_one_trainer || '—'}</span>
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-text-muted">Status</span>
            <StatusPill status={c.day_one_status} />
          </div>
          {(c.day_one_status || '').toLowerCase() !== 'scheduled' && (
            <>
              <div className="flex justify-between text-sm items-center">
                <span className="text-text-muted">Sale Result</span>
                <span className="text-text-primary font-medium">
                  {c.day_one_sale === 'Sale'
                    ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs">Sale</span>
                    : c.day_one_sale || '—'
                  }
                </span>
              </div>
              {c.pt_sale_type && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">PT Sale Type</span>
                  <span className="text-text-primary font-medium">{c.pt_sale_type}</span>
                </div>
              )}
              {c.why_no_sale && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Why No Sale</span>
                  <span className="text-text-primary font-medium">{c.why_no_sale}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PTReport({ startDate, endDate, locationSlug }) {
  const [expandedTrainer, setExpandedTrainer] = useState(null)
  const [detailContact, setDetailContact] = useState(null)
  const [sort, setSort] = useState({ key: null, dir: null })          // Day One Breakdown sort
  const [trainerSort, setTrainerSort] = useState({ key: null, dir: null }) // Trainer Stats sort

  // Click a header: new column → desc, then desc → asc, then back to unsorted.
  function cycle(prev, key) {
    if (prev.key !== key) return { key, dir: 'desc' }
    if (prev.dir === 'desc') return { key, dir: 'asc' }
    return { key: null, dir: null }
  }
  const toggleSort = (key) => setSort(prev => cycle(prev, key))
  const toggleTrainerSort = (key) => setTrainerSort(prev => cycle(prev, key))

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getPTReport(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  const totalDayOnes = data.total_day_ones || 0
  const completionRate = data.completion_rate || 0
  const closeRate = data.close_rate || 0

  const contacts = data.contacts || []
  // Apply the Day One Breakdown column sort (empties always sink to the bottom).
  const sortedContacts = (() => {
    if (!sort.key || !DAY_ONE_SORT[sort.key]) return contacts
    const get = DAY_ONE_SORT[sort.key]
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...contacts].sort((a, b) => {
      const av = get(a), bv = get(b)
      const aEmpty = av === '' || av == null
      const bEmpty = bv === '' || bv == null
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * mul
    })
  })()
  const byStatus = data.by_status || {}
  const totalCompleted = byStatus['Completed'] || 0
  const totalSales = Object.values(data.by_trainer || {}).reduce((sum, t) => sum + (t.sales || 0), 0)

  const trainerEntries = Object.entries(data.by_trainer || {})
  const trainerRows = (() => {
    if (!trainerSort.key || !TRAINER_SORT[trainerSort.key]) {
      return trainerEntries.sort((a, b) => b[1].total - a[1].total) // default: most Set first
    }
    const get = TRAINER_SORT[trainerSort.key]
    const mul = trainerSort.dir === 'asc' ? 1 : -1
    return [...trainerEntries].sort((a, b) => {
      const av = get(a), bv = get(b)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * mul
      }
      return (av - bv) * mul
    })
  })()

  const totals = trainerRows.reduce((acc, [, s]) => {
    acc.total += s.total || 0
    acc.scheduled += s.scheduled || 0
    acc.completed += s.completed || 0
    acc.no_show += s.no_show || 0
    acc.sales += s.sales || 0
    acc.no_sales += s.no_sales || 0
    return acc
  }, { total: 0, scheduled: 0, completed: 0, no_show: 0, sales: 0, no_sales: 0 })

  return (
    <div className="space-y-6">
      {/* Stat Cards — Set / Show / Close */}
      <StatBlock cols={3}>
        <StatCell label="Set" value={totalDayOnes} sub="Total Day Ones" />
        <StatCell label="Show" value={totalCompleted} sub={`${completionRate}% of ${totalDayOnes} set`} />
        <StatCell label="Close" value={totalSales} sub={`${closeRate}% of ${totalCompleted} shown`} />
      </StatBlock>

      {/* Trainer Summary Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Trainer Stats</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              {[
                { key: 'trainer', label: 'Trainer', align: 'left' },
                { key: 'set', label: 'Set', align: 'center' },
                { key: 'completed', label: 'Completed', align: 'center' },
                { key: 'no_show', label: 'No Show', align: 'center' },
                { key: 'sales', label: 'Sales', align: 'center' },
                { key: 'no_sale', label: 'No Sale', align: 'center' },
                { key: 'show_pct', label: 'Show %', align: 'center' },
                { key: 'close_pct', label: 'Close %', align: 'center' },
              ].map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleTrainerSort(col.key)}
                  className={`text-${col.align} px-4 py-3 text-xs font-semibold uppercase cursor-pointer select-none hover:text-wcs-red transition-colors ${trainerSort.key === col.key ? 'text-wcs-red' : 'text-text-muted'}`}
                  title="Click to sort"
                >
                  {col.label}<SortArrow active={trainerSort.key === col.key} dir={trainerSort.dir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trainerRows.map(([name, stats]) => {
              const rowTotal = stats.total || 0
              const rowCompleted = stats.completed || 0
              const rowNoShow = stats.no_show || 0
              const rowSales = stats.sales || 0
              const rowNoSales = stats.no_sales || 0
              const showPct = rowTotal > 0 ? Math.round((rowCompleted / rowTotal) * 100) : 0
              const closePct = rowCompleted > 0 ? Math.round((rowSales / rowCompleted) * 100) : 0
              return (
                <tr key={name} className="border-b border-border hover:bg-bg/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                  <td className="px-4 py-3 text-center font-semibold text-text-primary">{rowTotal}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">{rowCompleted}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs border border-red-200">{rowNoShow}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-wcs-red font-semibold">{rowSales}</td>
                  <td className="px-4 py-3 text-center text-text-muted">{rowNoSales}</td>
                  <td className="px-4 py-3 text-center text-text-primary font-medium">{showPct}%</td>
                  <td className="px-4 py-3 text-center text-text-primary font-medium">{closePct}%</td>
                </tr>
              )
            })}
            {trainerRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
            {trainerRows.length > 0 && (
              <tr className="border-t-2 border-border font-bold bg-bg/30">
                <td className="px-4 py-3 text-text-primary">Total</td>
                <td className="px-4 py-3 text-center text-text-primary">{totals.total}</td>
                <td className="px-4 py-3 text-center text-green-700">{totals.completed}</td>
                <td className="px-4 py-3 text-center text-red-500">{totals.no_show}</td>
                <td className="px-4 py-3 text-center text-wcs-red">{totals.sales}</td>
                <td className="px-4 py-3 text-center text-text-muted">{totals.no_sales}</td>
                <td className="px-4 py-3 text-center">{totals.total > 0 ? Math.round((totals.completed / totals.total) * 100) : 0}%</td>
                <td className="px-4 py-3 text-center">{totals.completed > 0 ? Math.round((totals.sales / totals.completed) * 100) : 0}%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Day One Breakdown — clickable rows */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Day One Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-border">
                {[
                  { key: 'name', label: 'Member Name' },
                  { key: 'booking_team_member', label: 'Booking Team Member' },
                  { key: 'booking_date', label: 'Date Scheduled' },
                  { key: 'day_one_date', label: 'Day One Date' },
                  { key: 'trainer', label: 'Trainer' },
                  { key: 'status', label: 'Status' },
                  { key: 'sale', label: 'Sale' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`text-left px-4 py-3 text-xs font-semibold uppercase cursor-pointer select-none hover:text-wcs-red transition-colors ${sort.key === col.key ? 'text-wcs-red' : 'text-text-muted'}`}
                    title="Click to sort"
                  >
                    {col.label}<SortArrow active={sort.key === col.key} dir={sort.dir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedContacts.map((c, i) => (
                <tr
                  key={i}
                  onClick={() => setDetailContact(c)}
                  className="border-b border-border hover:bg-bg/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-text-primary">{capitalize(c.first_name)} {capitalize(c.last_name)}</td>
                  <td className="px-4 py-2 text-text-muted">{c.day_one_booking_team_member || '—'}</td>
                  <td className="px-4 py-2 text-text-muted">{formatDate(c.day_one_booking_date)}</td>
                  <td className="px-4 py-2 text-text-muted">{formatDate(c.day_one_date)}</td>
                  <td className="px-4 py-2 text-text-muted">{c.day_one_trainer || '—'}</td>
                  <td className="px-4 py-2"><StatusPill status={c.day_one_status} /></td>
                  <td className="px-4 py-2">
                    {(c.day_one_status || '').toLowerCase() === 'scheduled' ? '—' :
                      c.day_one_sale === 'Sale'
                        ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs">Sale</span>
                        : <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 text-xs">{c.day_one_sale || 'No Sale'}</span>
                    }
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">No Day One data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Controls */}
      <div className="flex justify-end gap-2">
        <button onClick={() => {
          const csvRows = [
            ['Member Name', 'Booking Team Member', 'Date Scheduled', 'Day One Date', 'Trainer', 'Status', 'Sale'],
            ...contacts.map(c => [
              (c.first_name || '') + ' ' + (c.last_name || ''),
              c.day_one_booking_team_member || '',
              formatDate(c.day_one_booking_date),
              formatDate(c.day_one_date),
              c.day_one_trainer || '',
              c.day_one_status || '',
              c.day_one_sale || '',
            ]),
          ]
          exportCSV(csvRows, `pt-day-one-report-${startDate}-${endDate}`)
        }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">CSV</button>
        <button onClick={() => exportPDF('PT / Day One Report')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
      </div>

      {/* Detail Modal */}
      {detailContact && (
        <DetailModal contact={detailContact} onClose={() => setDetailContact(null)} />
      )}
    </div>
  )
}
