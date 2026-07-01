import React, { useState } from 'react'
import { previewSalesCommissions, applySalesCommissions } from '../../lib/api'

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

// Default to the previous month (YYYY-MM) — the month you'd normally be loading.
function prevMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return period
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function PayrollCommissionsAdmin() {
  const [file, setFile] = useState(null)
  const [period, setPeriod] = useState(prevMonth())
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [applyResult, setApplyResult] = useState(null)
  const [error, setError] = useState(null)

  function handleFileChange(e) {
    setFile(e.target.files?.[0] || null)
    setPreview(null)
    setApplyResult(null)
    setError(null)
  }

  async function handlePreview() {
    if (!file) return
    setLoading(true); setError(null); setPreview(null); setApplyResult(null)
    try {
      setPreview(await previewSalesCommissions(file))
    } catch (e) {
      setError(e.message || 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    if (!file || !preview || !period) return
    setLoading(true); setError(null); setApplyResult(null)
    try {
      setApplyResult(await applySalesCommissions(file, period))
    } catch (e) {
      setError(e.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  const summary = applyResult || preview

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-base font-semibold text-text-primary mb-1">Monthly Commission Upload</h3>
      <p className="text-xs text-text-muted mb-4">
        Upload the ABC POS commission CSV (columns: Club Nbr, Sales Person, Profit Center, Commission).
        TRAINING rows are skipped automatically — PT commission is synced separately from ABC.
        Loading the same month again is safe; it overwrites that month's rows rather than duplicating.
      </p>

      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="block mx-auto text-sm text-text-primary"
        />
        {file && (
          <p className="text-xs text-text-muted mt-3">{file.name} — {(file.size / 1024).toFixed(1)} KB</p>
        )}
      </div>

      <div className="mb-4 max-w-xs">
        <label className="block text-xs font-medium text-text-muted mb-1">Commission month</label>
        <input
          type="month"
          value={period}
          onChange={e => { setPeriod(e.target.value); setApplyResult(null) }}
          className="w-full text-sm border border-border rounded px-3 py-1.5 bg-bg text-text-primary"
        />
        <p className="text-[11px] text-text-muted mt-1">Loads as {monthLabel(period)}.</p>
      </div>

      <div className="flex gap-3 items-center mb-2">
        <button
          disabled={!file || loading}
          onClick={handlePreview}
          className="bg-wcs-red disabled:bg-gray-300 text-white px-4 py-2 rounded font-medium text-sm"
        >
          {loading && !applyResult ? 'Previewing…' : 'Preview'}
        </button>
        <button
          disabled={!file || !preview || !period || loading || !!applyResult}
          onClick={handleApply}
          className="bg-wcs-red disabled:bg-gray-300 text-white px-4 py-2 rounded font-medium text-sm"
        >
          {loading && preview && !applyResult ? 'Loading…' : `Load ${monthLabel(period)}`}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {applyResult && (
        <div className="mt-4 p-4 rounded bg-green-50 border border-green-300">
          <p className="text-sm font-semibold text-green-800">
            Loaded {applyResult.upserted} commission rows for {monthLabel(applyResult.period?.slice(0, 7) || period)}
            {' '}— {fmtMoney(applyResult.total_commission)} across {applyResult.clubs} clubs.
          </p>
          <p className="text-xs text-green-700 mt-1">
            {applyResult.dropped_training} TRAINING placeholder rows skipped. This now shows in the Payroll report.
          </p>
        </div>
      )}

      {summary && (
        <div className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            {[
              { label: 'Rows to load', value: summary.rows_to_load },
              { label: 'TRAINING skipped', value: summary.dropped_training },
              { label: 'Clubs', value: summary.clubs },
              { label: 'Duplicates', value: summary.duplicates },
              { label: 'Total commission', value: fmtMoney(summary.total_commission) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-bg rounded-lg border border-border p-3 text-center">
                <p className="text-lg font-bold text-text-primary">{value ?? '—'}</p>
                <p className="text-xs text-text-muted mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {summary.duplicates > 0 && (
            <p className="text-xs text-amber-600 mb-3">
              Heads up: {summary.duplicates} duplicate (club + employee + profit center) keys in the file —
              their commission will be merged to the last value on load.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-bg rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-surface">
                <span className="text-xs font-semibold text-text-primary">By club</span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(summary.by_club || {}).map(([club, total]) => (
                    <tr key={club} className="border-t border-border">
                      <td className="py-1.5 px-3 font-mono text-text-primary">{club}</td>
                      <td className="py-1.5 px-3 text-right text-text-primary">{fmtMoney(total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-bg rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-surface">
                <span className="text-xs font-semibold text-text-primary">By profit center</span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(summary.by_profit_center || {}).map(([pc, total]) => (
                    <tr key={pc} className="border-t border-border">
                      <td className="py-1.5 px-3 text-text-primary">{pc}</td>
                      <td className="py-1.5 px-3 text-right text-text-primary">{fmtMoney(total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
