import { useState } from 'react'
import { downloadEmployeeRoster } from '../../lib/api'

export default function EmployeeRosterTab() {
  const [downloading, setDownloading] = useState(false)
  const [activeOnly, setActiveOnly] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    setSuccess(false)
    try {
      await downloadEmployeeRoster({ activeOnly })
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Download Employee Roster
        </h3>
        <p className="text-xs text-text-muted mb-4 leading-relaxed">
          Pulls every employee from ABC for all 7 clubs into one Excel workbook
          with a tab per location. Send the file to managers so they can mark
          who still works at their club (the "Still Active?" column) and flag
          anyone whose access should be removed.
        </p>

        <label className="flex items-center gap-2 mb-4 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded border-border"
          />
          Skip employees ABC already has flagged inactive
        </label>

        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {downloading ? 'Building roster…' : 'Download Roster (.xlsx)'}
        </button>

        {error && (
          <p className="mt-4 text-xs text-wcs-red">{error}</p>
        )}
        {success && !error && (
          <p className="mt-4 text-xs text-green-600">
            Done — check your Downloads folder for <code className="font-mono">abc-employee-roster.xlsx</code>.
          </p>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">What managers see</h3>
        <ul className="text-xs text-text-muted leading-relaxed space-y-1 list-disc list-inside">
          <li><strong>Instructions tab</strong> (leftmost) — explains the workflow</li>
          <li><strong>One tab per location</strong> with columns: Employee ID, First Name, Last Name, Position, Department, ABC Status, <strong>Still Active?</strong></li>
          <li>Rows are sorted by Last Name → First Name</li>
          <li>Managers type Yes/No in the "Still Active?" column</li>
        </ul>
        <p className="mt-4 text-xs text-text-muted">
          Upload the file to Google Drive — Drive auto-converts <code className="font-mono">.xlsx</code> to Google Sheets and keeps the tabs.
        </p>
      </div>
    </div>
  )
}
