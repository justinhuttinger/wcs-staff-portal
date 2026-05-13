import React, { useEffect, useState } from 'react'
import { uploadRevenueCsv, getRevenueImports } from '../../lib/api'

function fmtMoney(n) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function RevenueBackfillTile() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, filename: '' })
  const [results, setResults] = useState([])
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
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    setResults([])
    const collected = []
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress({ current: i + 1, total: files.length, filename: f.name })
        try {
          const r = await uploadRevenueCsv(f)
          collected.push({ ok: true, filename: f.name, ...r })
        } catch (e) {
          collected.push({ ok: false, filename: f.name, error: e.message || 'upload failed' })
        }
        setResults([...collected])
      }
      setFiles([])
      await refreshImports()
    } finally {
      setUploading(false)
      setProgress({ current: 0, total: 0, filename: '' })
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-base font-semibold text-text-primary mb-1">Revenue Backfill</h3>
      <p className="text-xs text-text-muted mb-4">
        Upload one or more ABC "Revenue by Profit Center" CSVs. Each file's date window is reset before its rows are inserted, so re-uploads are safe and overlapping windows are won by the newest file.
      </p>

      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={e => { setFiles(Array.from(e.target.files || [])); setResults([]); setError(null) }}
          className="block mx-auto text-sm"
        />
        {files.length > 0 && (
          <ul className="text-xs text-text-muted mt-3 space-y-1 text-left max-w-md mx-auto">
            {files.map((f, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        disabled={files.length === 0 || uploading}
        onClick={handleUpload}
        className="w-full bg-wcs-red disabled:bg-gray-300 text-white py-2 rounded font-medium"
      >
        {uploading
          ? `Uploading ${progress.current}/${progress.total}: ${progress.filename}…`
          : files.length > 1
            ? `Upload & Ingest ${files.length} files`
            : 'Upload & Ingest'}
      </button>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          {results.map((r, i) => {
            if (!r.ok) {
              return (
                <div key={i} className="p-3 rounded bg-red-50 border border-red-300">
                  <p className="text-sm font-semibold text-red-700">Failed: {r.filename}</p>
                  <p className="text-xs text-red-700/80 mt-1">{r.error}</p>
                </div>
              )
            }
            const drift = Math.abs((r.computed_total || 0) - (r.reported_total || 0))
            const reconciled = r.reconciled
            return (
              <div key={i} className={`p-3 rounded ${reconciled ? 'bg-green-50 border border-green-300' : 'bg-yellow-50 border border-yellow-300'}`}>
                <p className="text-sm font-semibold">
                  {r.filename} — {reconciled ? 'Matches reported total' : `Drift ${fmtMoney(drift)}`}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Period: {r.period_start} → {r.period_end} · Rows: {r.row_count} · Computed: {fmtMoney(r.computed_total)} · Reported: {fmtMoney(r.reported_total)}
                </p>
              </div>
            )
          })}
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
