import React, { useState } from 'react'
import { previewVendorPriceList, applyVendorPriceList } from '../../lib/api'

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function VendorPriceListAdmin() {
  const [file, setFile] = useState(null)
  const [vendor, setVendor] = useState('Sportlife Distribution')
  const [updateCosts, setUpdateCosts] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [applyResult, setApplyResult] = useState(null)
  const [error, setError] = useState(null)

  function handleFileChange(e) {
    const f = e.target.files?.[0] || null
    setFile(f)
    setPreview(null)
    setApplyResult(null)
    setError(null)
  }

  async function handlePreview() {
    if (!file) return
    setLoading(true)
    setError(null)
    setPreview(null)
    setApplyResult(null)
    try {
      const r = await previewVendorPriceList(file)
      setPreview(r)
    } catch (e) {
      setError(e.message || 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    if (!file || !preview) return
    setLoading(true)
    setError(null)
    setApplyResult(null)
    try {
      const r = await applyVendorPriceList(file, vendor, updateCosts)
      setApplyResult(r)
    } catch (e) {
      setError(e.message || 'Apply failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-base font-semibold text-text-primary mb-1">Vendor Price List</h3>
      <p className="text-xs text-text-muted mb-4">
        Upload a vendor price list (CSV) to match the vendor's SKUs to your catalog by UPC, and optionally set item costs. EDLP is treated as the wholesale cost; per-unit cost = EDLP / pack size.
      </p>

      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="block mx-auto text-sm"
        />
        {file && (
          <p className="text-xs text-text-muted mt-3">
            {file.name} — {(file.size / 1024).toFixed(1)} KB
          </p>
        )}
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-text-muted mb-1">Vendor name</label>
        <input
          type="text"
          value={vendor}
          onChange={e => setVendor(e.target.value)}
          className="w-full text-sm border border-border rounded px-3 py-1.5 bg-bg text-text-primary"
        />
      </div>

      <div className="flex gap-3 items-center mb-4">
        <button
          disabled={!file || loading}
          onClick={handlePreview}
          className="bg-wcs-red disabled:bg-gray-300 text-white px-4 py-2 rounded font-medium text-sm"
        >
          {loading && !preview ? 'Previewing…' : 'Preview'}
        </button>
        <button
          disabled={!file || !preview || loading}
          onClick={handleApply}
          className="bg-wcs-red disabled:bg-gray-300 text-white px-4 py-2 rounded font-medium text-sm"
        >
          {loading && preview ? 'Applying…' : 'Apply'}
        </button>
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={updateCosts}
            onChange={e => setUpdateCosts(e.target.checked)}
            className="rounded"
          />
          Also update item costs from this list
        </label>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {preview && !applyResult && (
        <div className="mt-4">
          <div className="grid grid-cols-5 gap-3 mb-4">
            {[
              { label: 'Total rows', value: preview.total },
              { label: 'Matched', value: preview.matched },
              { label: 'Unmatched', value: preview.unmatched },
              { label: 'With cost', value: preview.with_cost },
              { label: 'Skipped', value: preview.skipped },
            ].map(({ label, value }) => (
              <div key={label} className="bg-bg rounded-lg border border-border p-3 text-center">
                <p className="text-lg font-bold text-text-primary">{value ?? '—'}</p>
                <p className="text-xs text-text-muted mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {Array.isArray(preview.sample) && preview.sample.length > 0 && (
            <div className="overflow-auto max-h-80 rounded border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-text-muted border-b border-border">
                    <th className="text-left py-2 px-2">SKU</th>
                    <th className="text-left py-2 px-2">Product</th>
                    <th className="text-left py-2 px-2">Pack</th>
                    <th className="text-right py-2 px-2">EDLP (case)</th>
                    <th className="text-right py-2 px-2">Unit Cost</th>
                    <th className="text-center py-2 px-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5 px-2 font-mono">{row.sku}</td>
                      <td className="py-1.5 px-2 max-w-[200px] truncate">{row.product_name}</td>
                      <td className="py-1.5 px-2">{row.pack_size ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right">{fmtMoney(row.case_cost)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtMoney(row.unit_cost)}</td>
                      <td className="py-1.5 px-2 text-center">
                        {row.matched
                          ? <span className="inline-block bg-green-100 text-green-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">matched</span>
                          : <span className="inline-block bg-bg text-text-muted text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border">no catalog match</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {applyResult && (
        <div className="mt-4 p-4 rounded bg-green-50 border border-green-300">
          <p className="text-sm font-semibold text-green-800">
            Seeded {applyResult.upserted} SKUs
            {updateCosts && applyResult.cost_updated_items != null
              ? ` · Updated cost on ${applyResult.cost_updated_items} items`
              : ''}
          </p>
        </div>
      )}
    </div>
  )
}
