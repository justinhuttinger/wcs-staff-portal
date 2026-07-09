import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings, forms } from '../../lib/api'

// Extract a Google Drive folder ID from a pasted URL or raw ID, mirroring
// extractFolderId in auth/src/routes/driveFolders.js.
function extractFolderId(input) {
  if (!input) return null
  const trimmed = input.trim()
  if (!/[/?=]/.test(trimmed)) return trimmed // looks like a raw ID
  const m = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

export default function FormsAdmin() {
  const [folderInput, setFolderInput] = useState('')
  const [savedFolderId, setSavedFolderId] = useState('')
  const [saving, setSaving] = useState(false)
  const [folderMessage, setFolderMessage] = useState(null)

  const [formList, setFormList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryState, setRetryState] = useState({}) // { [formId]: { busy, result, error } }

  useEffect(() => {
    getAppSettings('forms_drive_folder_id')
      .then(settings => {
        const id = settings?.forms_drive_folder_id || ''
        setSavedFolderId(id)
        setFolderInput(id)
      })
      .catch(() => {})

    forms.list()
      .then(res => setFormList(res?.forms || []))
      .catch(err => setError(err.message || 'Failed to load forms'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSaveFolder() {
    setSaving(true)
    setFolderMessage(null)
    const id = extractFolderId(folderInput)
    if (!id) {
      setFolderMessage({ type: 'error', text: 'Could not read a folder ID from that value.' })
      setSaving(false)
      return
    }
    try {
      await saveAppSettings({ forms_drive_folder_id: id })
      setSavedFolderId(id)
      setFolderInput(id)
      setFolderMessage({ type: 'success', text: 'Saved!' })
    } catch (err) {
      setFolderMessage({ type: 'error', text: err.message || 'Save failed' })
    }
    setSaving(false)
  }

  async function handleRetry(id) {
    setRetryState(prev => ({ ...prev, [id]: { busy: true } }))
    try {
      const result = await forms.retrySync(id)
      setRetryState(prev => ({ ...prev, [id]: { busy: false, result } }))
    } catch (err) {
      setRetryState(prev => ({ ...prev, [id]: { busy: false, error: err.message || 'Retry failed' } }))
    }
  }

  const published = formList.filter(f => f.status === 'published')

  return (
    <div className="space-y-6">
      {/* Google Drive folder setting */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Google Drive Folder</h3>
          <p className="text-xs text-text-muted mt-1">
            Paste the WCS shared drive folder where form spreadsheets should be created. The Google Business account must have access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={folderInput}
            onChange={e => setFolderInput(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/... or a raw folder ID"
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
          />
          <button
            onClick={handleSaveFolder}
            disabled={saving}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-2 font-medium hover:bg-wcs-red/90 disabled:opacity-50 shrink-0"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {folderMessage && (
            <span className={`text-xs font-medium shrink-0 ${folderMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {folderMessage.text}
            </span>
          )}
        </div>
        {savedFolderId && (
          <p className="text-[11px] text-text-muted">
            Current folder ID: <span className="font-mono text-text-primary">{savedFolderId}</span>
          </p>
        )}
      </div>

      {/* Sync health */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Sheet Sync Health</h3>
          <p className="text-xs text-text-muted mt-1">
            Published forms and their linked spreadsheets. Use Retry Sync to push any unsynced submissions to the sheet.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : published.length === 0 ? (
          <p className="text-sm text-text-muted">No published forms yet.</p>
        ) : (
          <div className="space-y-3">
            {published.map(form => {
              const rs = retryState[form.id] || {}
              return (
                <div key={form.id} className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-text-primary truncate">{form.title || 'Untitled Form'}</h4>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-text-muted">
                      {form.location_name && <span>{form.location_name}</span>}
                      <span>{form.submission_count || 0} submissions</span>
                      {form.sheet_id ? (
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${form.sheet_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-wcs-red hover:underline"
                        >
                          Open Sheet
                        </a>
                      ) : (
                        <span className="text-amber-500">No sheet linked</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {rs.result && (
                      <span className="text-[11px] font-medium text-text-muted">
                        {rs.result.retried} synced, {rs.result.failed} failed
                      </span>
                    )}
                    {rs.error && (
                      <span className="text-[11px] font-medium text-red-500">{rs.error}</span>
                    )}
                    <button
                      onClick={() => handleRetry(form.id)}
                      disabled={rs.busy}
                      title="Creates the sheet if needed, then re-appends unsynced submissions"
                      className="text-xs bg-bg border border-border text-text-primary rounded-lg px-3 py-1.5 font-medium hover:border-wcs-red disabled:opacity-50"
                    >
                      {rs.busy ? 'Retrying...' : 'Retry Sync'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
