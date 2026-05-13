import React, { useEffect, useState } from 'react'
import { uploadRevenueCsv, getRevenueImports } from '../../lib/api'

function fmtMoney(n) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function RevenueBackfillTile() {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [imports, setImports] = useState([])

  async function refreshImports() {
    try {
      const r = await getRevenueImports(20)
      setImports(r.rows || [])
    } catch (e) {
      // Non-fatal — just leave the table empty.
    }
  }

  useEffect(() => { refreshImports() }, [])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const r = await uploadRevenueCsv(file)
      setResult(r)
      setFile(null)
      await refreshImports()
    } catch (e) {
      setError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const reconciled = result?.reconciled
  const drift = result ? Math.abs((result.computed_total || 0) - (result.reported_total || 0)) : 0

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-base font-semibold text-text-primary mb-1">Revenue Backfill</h3>
      <p className="text-xs text-text-muted mb-4">
        Upload an ABC "Revenue by Profit Center" CSV. Window is reset for the period in the file, then rows are re-inserted.
      </p>

      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(null) }}
          className="block mx-auto text-sm"
        />
        {file && <p className="text-xs text-text-muted mt-2">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
      </div>

      <button
        disabled={!file || uploading}
        onClick={handleUpload}
        className="w-full bg-wcs-red disabled:bg-gray-300 text-white py-2 rounded font-medium"
      >
        {uploading ? 'Uploading…' : 'Upload & Ingest'}
      </button>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {result && (
        <div className={`mt-4 p-3 rounded ${reconciled ? 'bg-green-50 border border-green-300' : 'bg-yellow-50 border border-yellow-300'}`}>
          <p className="text-sm font-semibold">
            {reconciled ? 'Matches reported total' : `Drift ${fmtMoney(drift)}`}
          </p>
          <p className="text-xs text-text-muted mt-1">
            Period: {result.period_start} → {result.period_end} · Rows: {result.row_count} · Computed: {fmtMoney(result.computed_total)} · Reported: {fmtMoney(result.reported_total)}
          </p>
        </div>
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Recent Imports</p>
        <table className="w-full text-xs">
          <thead className="text-text-muted">
            <tr><th className="text-left py-1">When</th><th className="text-left">Source</th><th className="text-left">Period</th><th className="text-right">Rows</th><th className="text-right">Computed</th><th className="text-left">Status</th></tr>
          </thead>
          <tbody>
            {imports.map(r => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1">{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.source}</td>
                <td>{r.period_start}..{r.period_end}</td>
                <td className="text-right">{r.row_count}</td>
                <td className="text-right">{fmtMoney(r.computed_total)}</td>
                <td className={r.status === 'success' ? 'text-green-600' : r.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}>{r.status}</td>
              </tr>
            ))}
            {imports.length === 0 && (
              <tr><td colSpan="6" className="py-4 text-center text-text-muted">No imports yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
