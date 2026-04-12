import React, { useState, useEffect, useCallback } from 'react'
import {
  getHRDocuments,
  createHRDocument,
  getHRDocument,
  acknowledgeHRDocument,
  uploadHRDocumentToPaychex,
} from '../../lib/api'

const ROLES = ['team_member', 'fd_lead', 'pt_lead', 'manager', 'corporate', 'admin']

const REASON_OPTIONS = [
  { key: 'verbal_warning', label: 'Verbal Warning' },
  { key: 'written_warning', label: 'Written Warning' },
  { key: 'termination', label: 'Termination' },
]

const REASON_COLORS = {
  verbal_warning: 'bg-amber-50 text-amber-700 border-amber-200',
  written_warning: 'bg-orange-50 text-orange-700 border-orange-200',
  termination: 'bg-red-50 text-red-700 border-red-200',
}

const REASON_LABELS = {
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  termination: 'Termination',
}

const STATUS_COLORS = {
  pending_signature: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  uploaded: 'bg-blue-50 text-blue-700 border-blue-200',
}

const STATUS_LABELS = {
  pending_signature: 'Pending',
  completed: 'Completed',
  uploaded: 'Uploaded',
}

const STATUS_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending_signature', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'uploaded', label: 'Uploaded' },
]

const REASON_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'verbal_warning', label: 'Verbal' },
  { key: 'written_warning', label: 'Written' },
  { key: 'termination', label: 'Termination' },
]

function relativeDate(dateStr) {
  if (!dateStr) return ''
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-wcs-red border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="fixed top-4 left-4 right-4 z-[999] flex justify-center animate-fade-in">
      <div className="bg-green-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium">
        {message}
      </div>
    </div>
  )
}

// --- Sub-views ---

function SubmitDocumentView({ user, onBack, onSuccess }) {
  const [employeeName, setEmployeeName] = useState('')
  const [reason, setReason] = useState('verbal_warning')
  const [description, setDescription] = useState('')
  const [managerSignature, setManagerSignature] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const userName = user?.staff?.display_name || user?.staff?.first_name || 'Manager'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!employeeName.trim() || !description.trim() || !managerSignature.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await createHRDocument({
        employee_name: employeeName.trim(),
        reason,
        description: description.trim(),
        manager_signature: managerSignature.trim(),
      })
      onSuccess()
    } catch (err) {
      setError(err.message || 'Failed to submit document')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface border border-border">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-text-primary">Submit HR Document</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Employee Name */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employee Name</label>
          <input
            type="text"
            value={employeeName}
            onChange={e => setEmployeeName(e.target.value)}
            placeholder="Enter employee name"
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red"
            required
          />
        </div>

        {/* Reason pills */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Reason</label>
          <div className="flex gap-2">
            {REASON_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setReason(opt.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  reason === opt.key
                    ? REASON_COLORS[opt.key]
                    : 'bg-surface border-border text-text-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the incident or reason..."
            rows={6}
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red resize-none"
            required
          />
        </div>

        {/* Manager Signature */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Manager Signature</label>
          <input
            type="text"
            value={managerSignature}
            onChange={e => setManagerSignature(e.target.value)}
            placeholder="Type your full name"
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red"
            required
          />
        </div>

        {error && (
          <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !employeeName.trim() || !description.trim() || !managerSignature.trim()}
          className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {submitting ? 'Submitting...' : 'Submit Document'}
        </button>
      </form>
    </div>
  )
}

function ViewDocumentsView({ user, onBack }) {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedDoc, setSelectedDoc] = useState(null)

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (search.trim()) params.employee_name = search.trim()
      if (reasonFilter !== 'all') params.reason = reasonFilter
      if (statusFilter !== 'all') params.status = statusFilter
      const res = await getHRDocuments(params)
      setDocuments(Array.isArray(res) ? res : res?.documents || res?.data || [])
    } catch (err) {
      setError(err.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [search, reasonFilter, statusFilter])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  if (selectedDoc) {
    return (
      <DocumentDetailView
        docId={selectedDoc.id}
        onBack={() => { setSelectedDoc(null); fetchDocuments() }}
      />
    )
  }

  return (
    <div className="px-4 pt-4 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface border border-border">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-text-primary">HR Documents</h2>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search employee name..."
          className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red"
        />
      </div>

      {/* Reason filter pills */}
      <div className="mb-2">
        <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Reason</label>
        <div className="flex gap-1.5 flex-wrap">
          {REASON_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setReasonFilter(opt.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                reasonFilter === opt.key
                  ? opt.key === 'all' ? 'bg-gray-700 text-white border-gray-700' : REASON_COLORS[opt.key]
                  : 'bg-surface border-border text-text-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status filter pills */}
      <div className="mb-4">
        <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Status</label>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setStatusFilter(opt.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                statusFilter === opt.key
                  ? opt.key === 'all' ? 'bg-gray-700 text-white border-gray-700' : STATUS_COLORS[opt.key]
                  : 'bg-surface border-border text-text-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Document list */}
      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center text-text-muted text-sm py-12">No documents found</div>
      ) : (
        <div className="space-y-3">
          {documents.map(doc => (
            <button
              key={doc.id}
              onClick={() => setSelectedDoc(doc)}
              className="w-full text-left bg-surface border border-border rounded-2xl p-4 active:scale-[0.98] transition-transform"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="font-semibold text-sm text-text-primary">{doc.employee_name}</span>
                <div className="flex gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${REASON_COLORS[doc.reason] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {REASON_LABELS[doc.reason] || doc.reason}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_COLORS[doc.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {STATUS_LABELS[doc.status] || doc.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <span>{relativeDate(doc.created_at)}</span>
                {doc.manager_signature && (
                  <>
                    <span className="text-text-muted">-</span>
                    <span>{doc.manager_signature}</span>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentDetailView({ docId, onBack }) {
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getHRDocument(docId)
      .then(res => { if (!cancelled) setDoc(res) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load document') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [docId])

  async function handleAcknowledge() {
    setActionLoading(true)
    try {
      const res = await acknowledgeHRDocument(docId, { acknowledged: true })
      setDoc(prev => ({ ...prev, ...res, status: res?.status || 'completed' }))
      setToast('Document acknowledged')
    } catch (err) {
      setToast(err.message || 'Failed to acknowledge')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleUploadPaychex() {
    setActionLoading(true)
    try {
      const res = await uploadHRDocumentToPaychex(docId)
      setDoc(prev => ({ ...prev, ...res, status: res?.status || 'uploaded' }))
      setToast('Uploaded to Paychex')
    } catch (err) {
      setToast(err.message || 'Failed to upload')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <Spinner />
  if (error) {
    return (
      <div className="px-4 pt-4">
        <button onClick={onBack} className="mb-4 w-8 h-8 flex items-center justify-center rounded-full bg-surface border border-border">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      </div>
    )
  }

  if (!doc) return null

  return (
    <div className="px-4 pt-4 pb-8">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface border border-border">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-text-primary">Document Detail</h2>
      </div>

      {/* Document card */}
      <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
        {/* Employee + pills */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Employee</label>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-text-primary">{doc.employee_name}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${REASON_COLORS[doc.reason] || ''}`}>
              {REASON_LABELS[doc.reason] || doc.reason}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_COLORS[doc.status] || ''}`}>
              {STATUS_LABELS[doc.status] || doc.status}
            </span>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Description</label>
          <p className="text-sm text-text-primary whitespace-pre-wrap">{doc.description}</p>
        </div>

        {/* Manager Signature */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Manager Signature</label>
          <p className="text-sm text-text-primary italic">{doc.manager_signature}</p>
        </div>

        {/* Employee Signature if exists */}
        {doc.employee_signature && (
          <div>
            <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Employee Signature</label>
            <p className="text-sm text-text-primary italic">{doc.employee_signature}</p>
          </div>
        )}

        {/* Dates */}
        <div className="flex gap-6">
          <div>
            <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-0.5">Created</label>
            <span className="text-xs text-text-secondary">{formatDate(doc.created_at)}</span>
          </div>
          {doc.acknowledged_at && (
            <div>
              <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-0.5">Acknowledged</label>
              <span className="text-xs text-text-secondary">{formatDate(doc.acknowledged_at)}</span>
            </div>
          )}
          {doc.uploaded_at && (
            <div>
              <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-0.5">Uploaded</label>
              <span className="text-xs text-text-secondary">{formatDate(doc.uploaded_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-4 space-y-3">
        {doc.status === 'pending_signature' && (
          <button
            onClick={handleAcknowledge}
            disabled={actionLoading}
            className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {actionLoading ? 'Processing...' : 'Mark as Acknowledged'}
          </button>
        )}
        {doc.status === 'completed' && (
          <button
            onClick={handleUploadPaychex}
            disabled={actionLoading}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {actionLoading ? 'Uploading...' : 'Upload to Paychex'}
          </button>
        )}
      </div>
    </div>
  )
}

// --- Main Component ---

export default function MobileHR({ user }) {
  const role = user?.staff?.role || 'team_member'
  const isManager = ROLES.indexOf(role) >= ROLES.indexOf('manager')

  const [view, setView] = useState('landing') // landing | submit | documents
  const [toast, setToast] = useState(null)

  if (!isManager) {
    return (
      <div className="px-4 pt-16 text-center">
        <div className="bg-surface border border-border rounded-2xl p-8">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto text-text-muted mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h2 className="text-lg font-bold text-text-primary mb-1">Access Restricted</h2>
          <p className="text-sm text-text-muted">HR documents are only available to managers and above.</p>
        </div>
      </div>
    )
  }

  if (view === 'submit') {
    return (
      <>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        <SubmitDocumentView
          user={user}
          onBack={() => setView('landing')}
          onSuccess={() => {
            setToast('Document submitted successfully')
            setView('landing')
          }}
        />
      </>
    )
  }

  if (view === 'documents') {
    return <ViewDocumentsView user={user} onBack={() => setView('landing')} />
  }

  // Landing view
  return (
    <div className="px-4 pt-6 pb-8">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <h1 className="text-xl font-bold text-text-primary mb-6">HR Documents</h1>

      <div className="space-y-4">
        {/* Submit Document card */}
        <button
          onClick={() => setView('submit')}
          className="w-full bg-surface border border-border rounded-2xl p-6 flex items-center gap-4 active:scale-[0.98] transition-transform text-left"
        >
          <div className="w-14 h-14 rounded-full bg-wcs-red/10 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <span className="block text-base font-bold text-text-primary">Submit Document</span>
            <span className="block text-xs text-text-muted mt-0.5">Create a new HR document</span>
          </div>
        </button>

        {/* View Documents card */}
        <button
          onClick={() => setView('documents')}
          className="w-full bg-surface border border-border rounded-2xl p-6 flex items-center gap-4 active:scale-[0.98] transition-transform text-left"
        >
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-blue-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <div>
            <span className="block text-base font-bold text-text-primary">View Documents</span>
            <span className="block text-xs text-text-muted mt-0.5">Search and manage HR documents</span>
          </div>
        </button>
      </div>
    </div>
  )
}
