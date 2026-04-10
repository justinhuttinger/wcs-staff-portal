import { useState, useRef } from 'react'
import { downloadStaffTemplate, importStaff } from '../../lib/api'

export default function BulkImportTab() {
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef(null)

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      await downloadStaffTemplate()
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (f) {
      if (!f.name.endsWith('.xlsx') && !f.name.endsWith('.xls')) {
        setError('Please select an Excel file (.xlsx)')
        setFile(null)
        return
      }
      setFile(f)
      setError(null)
      setResult(null)
    }
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const data = await importStaff(file)
      setResult(data)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err.message)
      if (err.data?.row_errors) {
        setResult(err.data)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Download Template Section */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Step 1: Download Template</h3>
        <p className="text-xs text-text-muted mb-4">
          Download the Excel template, fill in staff details, then upload it below.
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {downloading ? 'Downloading...' : 'Download Template'}
        </button>
      </div>

      {/* Upload Section */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Step 2: Upload Filled Template</h3>
        <p className="text-xs text-text-muted mb-4">
          Select your completed Excel file. All staff will be created with &ldquo;must change password&rdquo; enabled.
        </p>

        <div className="flex items-center gap-4">
          <label className="flex-1">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-border file:text-sm file:font-medium file:bg-bg file:text-text-primary hover:file:bg-border/50 file:cursor-pointer cursor-pointer"
            />
          </label>
          <button
            onClick={handleImport}
            disabled={!file || importing}
            className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {importing ? 'Importing...' : 'Import Staff'}
          </button>
        </div>

        {file && (
          <p className="text-xs text-text-muted mt-2">
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Success Result */}
      {result && !result.row_errors && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
          <p className="font-medium">{result.message}</p>
          {result.failures?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.failures.map((f, i) => (
                <li key={i} className="text-xs text-red-600">
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Validation Errors */}
      {result?.row_errors && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-red-50">
            <p className="text-sm font-medium text-wcs-red">
              {result.row_errors.length} row(s) have errors &mdash; {result.valid_count} of {result.total_count} valid
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Row</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Errors</th>
                </tr>
              </thead>
              <tbody>
                {result.row_errors.map((re, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-text-primary font-medium">{re.row}</td>
                    <td className="px-4 py-2 text-wcs-red text-xs">{re.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
