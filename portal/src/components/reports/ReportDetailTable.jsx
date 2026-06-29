import { useMemo, useState } from 'react'
import { exportCSV, exportPDF } from '../../lib/export'

// Generic, Excel-style line-item grid used by every report's "See Detail" tab.
// Driven entirely by a column config + flat row objects (see lib/reportDetail.js).
// Provides: free-text search across all cells, click-to-sort per column, a live
// row count, and CSV / PDF export. Knows nothing about any specific report.

const EMPTY = '—'

function isBlank(v) {
  return v === null || v === undefined || v === ''
}

// Display string for a cell, by column type.
function formatCell(value, type) {
  if (isBlank(value) && type !== 'bool') return EMPTY
  switch (type) {
    case 'bool':
      return value ? 'Yes' : EMPTY
    case 'money':
      return '$' + Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'decimal':
      return Number(value || 0).toFixed(2)
    case 'number':
      return String(value)
    default:
      return String(value)
  }
}

// Plain value for CSV (no "$", no em-dash placeholders, booleans as Yes/No).
function csvValue(value, type) {
  if (type === 'bool') return value ? 'Yes' : 'No'
  if (isBlank(value)) return ''
  if (type === 'money') return Number(value || 0).toFixed(2)
  if (type === 'decimal') return Number(value || 0).toFixed(2)
  return value
}

const NUMERIC_TYPES = new Set(['number', 'decimal', 'money'])

function alignClass(type) {
  if (NUMERIC_TYPES.has(type)) return 'text-right tabular-nums'
  if (type === 'bool') return 'text-center'
  return 'text-left'
}

export default function ReportDetailTable({ columns, rows, filename }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const colByKey = useMemo(() => Object.fromEntries(columns.map(c => [c.key, c])), [columns])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row =>
      columns.some(c => {
        const v = row[c.key]
        if (isBlank(v)) return false
        return formatCell(v, c.type).toLowerCase().includes(q)
      })
    )
  }, [rows, columns, search])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = colByKey[sortKey]
    const numeric = NUMERIC_TYPES.has(col?.type)
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Blanks always sort to the bottom regardless of direction.
      const aBlank = isBlank(av)
      const bBlank = isBlank(bv)
      if (aBlank && bBlank) return 0
      if (aBlank) return 1
      if (bBlank) return -1
      if (col?.type === 'bool') return (Number(!!bv) - Number(!!av)) * -dir
      if (numeric) return (Number(av) - Number(bv)) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [filtered, sortKey, sortDir, colByKey])

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function handleExportCSV() {
    const header = columns.map(c => c.label)
    const body = sorted.map(row => columns.map(c => csvValue(row[c.key], c.type)))
    exportCSV([header, ...body], filename || 'report-detail')
  }

  return (
    <div className="space-y-3">
      {/* Controls: count + search + export */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-text-primary">{sorted.length.toLocaleString()}</span>
          {sorted.length === 1 ? ' row' : ' rows'}
          {search && rows.length !== sorted.length ? ` of ${rows.length.toLocaleString()}` : ''}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search detail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red w-56"
          />
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors"
          >
            CSV
          </button>
          <button
            onClick={() => exportPDF('Report Detail')}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors"
          >
            PDF
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              {columns.map(c => {
                const active = sortKey === c.key
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`px-4 py-3 text-xs font-semibold text-text-muted uppercase whitespace-nowrap cursor-pointer select-none hover:text-text-primary ${alignClass(c.type)}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {NUMERIC_TYPES.has(c.type) && <span className="w-3" />}
                      {c.label}
                      <span className={`text-[10px] ${active ? 'text-wcs-red' : 'text-transparent'}`}>
                        {active && sortDir === 'desc' ? '▼' : '▲'}
                      </span>
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 odd:bg-bg/30 hover:bg-bg/60 transition-colors">
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={`px-4 py-2 whitespace-nowrap ${alignClass(c.type)} ${
                      c.key === 'name' ? 'font-medium text-text-primary' : 'text-text-muted'
                    }`}
                  >
                    {formatCell(row[c.key], c.type)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-text-muted text-sm">
                  {rows.length === 0 ? 'No detail records for this selection.' : 'No rows match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
