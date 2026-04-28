import { useState, useEffect, useCallback } from 'react'
import { getDriveFolders, listDriveContents } from '../lib/api'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

function fileIcon(mimeType) {
  if (mimeType === FOLDER_MIME) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-amber-500">
        <path d="M19.5 21a3 3 0 0 0 3-3v-7.5A3 3 0 0 0 19.5 7.5h-7.875a1.125 1.125 0 0 1-.9-.45l-1.05-1.4a3 3 0 0 0-2.4-1.2H4.5a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h15Z" />
      </svg>
    )
  }
  if (mimeType?.startsWith('application/vnd.google-apps.document')) {
    return <FileGlyph color="#1A73E8" letter="D" />
  }
  if (mimeType?.startsWith('application/vnd.google-apps.spreadsheet')) {
    return <FileGlyph color="#0F9D58" letter="S" />
  }
  if (mimeType?.startsWith('application/vnd.google-apps.presentation')) {
    return <FileGlyph color="#F4B400" letter="P" />
  }
  if (mimeType?.startsWith('image/')) {
    return <FileGlyph color="#9c27b0" letter="🖼" />
  }
  if (mimeType === 'application/pdf') {
    return <FileGlyph color="#DB4437" letter="P" />
  }
  if (mimeType?.startsWith('video/')) {
    return <FileGlyph color="#DB4437" letter="V" />
  }
  return <FileGlyph color="#5f6368" letter="📄" />
}

function FileGlyph({ color, letter }) {
  return (
    <div className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: color }}>
      {letter}
    </div>
  )
}

function fmtSize(bytes) {
  if (!bytes) return ''
  const n = parseInt(bytes, 10)
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DriveView({ onBack }) {
  const [folders, setFolders] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getDriveFolders()
      .then(res => setFolders(res.folders || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (selected) {
    return <DriveBrowser root={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <h2 className="text-lg font-bold text-text-primary">Shared Drive</h2>
      </div>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading...</p>
      ) : error ? (
        <p className="text-wcs-red text-sm py-4 text-center">{error}</p>
      ) : folders.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-xl border border-border">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-text-muted mx-auto mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
          <p className="text-sm font-medium text-text-primary">No drive folders available</p>
          <p className="text-xs text-text-muted mt-1">Ask your admin to add some</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {folders.map(folder => (
            <button
              key={folder.id}
              onClick={() => setSelected(folder)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                </svg>
              </div>
              <div className="text-center">
                <span className="block text-base font-semibold text-text-primary">{folder.name}</span>
                {folder.description && (
                  <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{folder.description}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// In-portal Drive browser
// ---------------------------------------------------------------------------

function DriveBrowser({ root, onBack }) {
  const [path, setPath] = useState([{ id: root.folder_id, name: root.name }])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [previewFile, setPreviewFile] = useState(null)

  const currentFolderId = path[path.length - 1].id

  const load = useCallback((folderId) => {
    setLoading(true)
    setError('')
    listDriveContents(folderId)
      .then(res => setFiles(res.files || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(currentFolderId) }, [currentFolderId, load])

  function openItem(file) {
    if (file.mimeType === FOLDER_MIME) {
      setPath(p => [...p, { id: file.id, name: file.name }])
    } else {
      setPreviewFile(file)
    }
  }

  function navigateTo(idx) {
    setPath(p => p.slice(0, idx + 1))
  }

  if (previewFile) {
    return (
      <div className="w-full flex flex-col px-8 pb-4" style={{ height: 'calc(100vh - 80px)' }}>
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-4 shrink-0 flex items-center gap-3">
          <button
            onClick={() => setPreviewFile(null)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Folder
          </button>
          <h2 className="text-lg font-bold text-text-primary truncate flex-1">{previewFile.name}</h2>
          <a
            href={previewFile.webViewLink || `https://drive.google.com/file/d/${previewFile.id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-wcs-red hover:underline shrink-0"
          >
            Open in Drive ↗
          </a>
        </div>
        <div className="flex-1 rounded-xl border border-border overflow-hidden bg-white">
          <iframe
            src={`https://drive.google.com/file/d/${previewFile.id}/preview`}
            title={previewFile.name}
            className="w-full h-full border-0"
            allow="autoplay"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Drives
        </button>
        <div className="flex items-center gap-1 text-sm flex-wrap">
          {path.map((seg, i) => (
            <span key={seg.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-text-muted">/</span>}
              {i === path.length - 1 ? (
                <span className="font-semibold text-text-primary">{seg.name}</span>
              ) : (
                <button
                  onClick={() => navigateTo(i)}
                  className="text-text-muted hover:text-wcs-red hover:underline"
                >
                  {seg.name}
                </button>
              )}
            </span>
          ))}
        </div>
        <a
          href={`https://drive.google.com/drive/folders/${currentFolderId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs font-semibold text-wcs-red hover:underline"
        >
          Open in Drive ↗
        </a>
      </div>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading...</p>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
          {error.toLowerCase().includes('insufficient') && (
            <p className="mt-2 text-xs">
              The Google account connected to the portal needs the Drive scope. Open
              <code className="bg-white px-1 mx-1 rounded">/google-business/authorize</code>
              on the auth API to reconnect with the new scope.
            </p>
          )}
        </div>
      ) : files.length === 0 ? (
        <p className="text-center text-text-muted text-sm py-8">This folder is empty.</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide">Name</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide w-32">Modified</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide w-24">Size</th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr
                  key={file.id}
                  onClick={() => openItem(file)}
                  className="border-t border-border hover:bg-bg cursor-pointer"
                >
                  <td className="px-4 py-2 flex items-center gap-3">
                    {fileIcon(file.mimeType)}
                    <span className="font-medium text-text-primary truncate">{file.name}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-text-muted">{fmtDate(file.modifiedTime)}</td>
                  <td className="px-4 py-2 text-right text-xs text-text-muted">{file.mimeType === FOLDER_MIME ? '—' : fmtSize(file.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
