import { useState, useEffect, useCallback } from 'react'
import {
  createHRDocument,
  getPaychexWorkers,
  getPaychexWorkerDocuments,
  getPaychexLocations,
} from '../lib/api'
import SignaturePad from './SignaturePad'

const REASONS = [
  { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_warning', label: 'Written Warning' },
  { value: 'termination', label: 'Termination' },
]

const REASON_LABELS = {
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  termination: 'Termination',
}

const REASON_COLORS = {
  verbal_warning: 'bg-amber-50 text-amber-700 border-amber-200',
  written_warning: 'bg-orange-50 text-orange-700 border-orange-200',
  termination: 'bg-red-50 text-red-700 border-red-200',
}

const STATUS_LABELS = {
  draft: 'Draft',
  pending_signature: 'Pending Signature',
  completed: 'Completed',
  uploaded: 'Uploaded',
}

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  pending_signature: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  uploaded: 'bg-blue-50 text-blue-700 border-blue-200',
}

const ROLE_LEVELS = { team_member: 0, fd_lead: 1, pt_lead: 2, manager: 3, corporate: 4, admin: 5 }

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DocumentPreview({ employeeName, reason, shortReason, description, managerName, managerSignature, employeeSignature, date }) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden shadow-sm">
      <div className="bg-[#C41E24] px-6 py-4">
        <h3 className="text-white text-lg font-bold tracking-wide">West Coast Strength</h3>
      </div>
      <div className="p-6 space-y-5">
        <h4 className="text-center text-xl font-black text-text-primary uppercase tracking-wide">
          {REASON_LABELS[reason] || 'Document'}
        </h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-text-muted font-medium">Date:</span>
            <span className="ml-2 text-text-primary">{date || formatDate(new Date().toISOString())}</span>
          </div>
          <div>
            <span className="text-text-muted font-medium">Manager:</span>
            <span className="ml-2 text-text-primary">{managerName || '—'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-text-muted font-medium">Employee:</span>
            <span className="ml-2 text-text-primary">{employeeName || '—'}</span>
          </div>
          {shortReason && (
            <div className="col-span-2">
              <span className="text-text-muted font-medium">Reason:</span>
              <span className="ml-2 text-text-primary">{shortReason}</span>
            </div>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Description</p>
          <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {description || '—'}
          </p>
        </div>
        <div className="border-t border-border pt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Manager Signature</p>
            {managerSignature && managerSignature.startsWith('data:image') ? (
              <img src={managerSignature} alt="Manager signature" className="h-16 border-b border-border" />
            ) : (
              <p className="text-sm italic text-text-primary border-b border-border pb-1 inline-block min-w-[200px]">
                {managerName || ''}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Employee Signature</p>
            {employeeSignature && employeeSignature.startsWith('data:image') ? (
              <img src={employeeSignature} alt="Employee signature" className="h-16 border-b border-border" />
            ) : (
              <p className="text-xs text-text-muted italic">
                {employeeSignature ? employeeSignature : 'Not provided'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Worker List — shared between View Docs and Submit Doc flows
// ---------------------------------------------------------------------------
function WorkerList({ user, onSelectWorker, onLocationChange }) {
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [locationSlug, setLocationSlug] = useState('')
  const [locations, setLocations] = useState([])

  const canSeeAll = ROLE_LEVELS[user?.staff?.role] >= ROLE_LEVELS.corporate

  useEffect(() => {
    if (canSeeAll) {
      getPaychexLocations()
        .then(res => setLocations(res.locations || []))
        .catch(() => {})
    }
  }, [canSeeAll])

  const fetchWorkers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getPaychexWorkers(canSeeAll && locationSlug ? locationSlug : undefined)
      setWorkers(res.workers || [])
      if (!locationSlug && res.location) {
        setLocationSlug(res.location)
        onLocationChange?.(res.location)
      }
    } catch (err) {
      setError(err.message || 'Failed to load employees')
    } finally {
      setLoading(false)
    }
  }, [locationSlug, canSeeAll])

  useEffect(() => { fetchWorkers() }, [fetchWorkers])

  const filtered = workers.filter(w => {
    if (!search) return true
    const q = search.toLowerCase()
    return w.displayName.toLowerCase().includes(q) ||
           w.employeeId?.toLowerCase().includes(q) ||
           (w.preferredName && w.preferredName.toLowerCase().includes(q))
  })

  return (
    <div className="space-y-4">
      {canSeeAll && locations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {locations.map(loc => (
            <button
              key={loc.slug}
              onClick={() => { setLocationSlug(loc.slug); onLocationChange?.(loc.slug) }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                locationSlug === loc.slug
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
          />
        </div>
        {!loading && (
          <p className="text-[11px] text-text-muted mt-2">{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</p>
        )}
      </div>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading employees from Paychex...</p>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button onClick={fetchWorkers} className="px-4 py-2 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-text-muted text-sm py-8">No employees found</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(w => (
            <button
              key={w.workerId}
              onClick={() => onSelectWorker(w)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-xl text-left hover:bg-bg/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-wcs-red">
                  {(w.givenName?.[0] || '').toUpperCase()}{(w.familyName?.[0] || '').toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{w.displayName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {w.employeeId && <span className="text-[11px] text-text-muted">ID: {w.employeeId}</span>}
                  {w.email && <span className="text-[11px] text-text-muted">{w.email}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                {w.hireDate && <p className="text-[11px] text-text-muted">Hired {formatDate(w.hireDate)}</p>}
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Submit Document Form — multi-step: employee selected → form → preview → submit
// ---------------------------------------------------------------------------
function SubmitDocumentForm({ worker, user, onBack, onSuccess }) {
  const userName = user?.staff?.display_name || user?.staff?.first_name || ''

  const [reason, setReason] = useState('verbal_warning')
  const [shortReason, setShortReason] = useState('')
  const [description, setDescription] = useState('')
  const [managerSignature, setManagerSignature] = useState('')
  const [employeeSignature, setEmployeeSignature] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState(null)

  async function handleSubmit(e) {
    if (e) e.preventDefault()
    if (!description.trim() || !managerSignature) return
    setSubmitting(true)
    setSubmitMsg(null)
    try {
      await createHRDocument({
        employee_name: worker.displayName,
        worker_id: worker.workerId,
        reason,
        short_reason: shortReason.trim() || null,
        description: description.trim(),
        manager_signature: managerSignature,
        employee_signature: employeeSignature || null,
      })
      setSubmitMsg({ type: 'success', text: 'Document submitted and sent to Paychex.' })
    } catch (err) {
      setSubmitMsg({ type: 'error', text: err.message || 'Failed to submit document.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Worker header */}
      <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
          <span className="text-lg font-bold text-wcs-red">
            {(worker.givenName?.[0] || '').toUpperCase()}{(worker.familyName?.[0] || '').toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-base font-bold text-text-primary">{worker.displayName}</p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
            {worker.employeeId && <span>ID: {worker.employeeId}</span>}
            {worker.hireDate && <span>Hired {formatDate(worker.hireDate)}</span>}
          </div>
        </div>
      </div>

      {submitMsg && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${submitMsg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {submitMsg.text}
          {submitMsg.type === 'success' && (
            <div className="mt-2 flex gap-3">
              <button onClick={onBack} className="text-xs underline hover:no-underline">Back to HR</button>
              {onSuccess && <button onClick={onSuccess} className="text-xs underline hover:no-underline">Submit Another</button>}
            </div>
          )}
        </div>
      )}

      {!submitMsg?.type && !showPreview && (
        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1">Document Type</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
            >
              {REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1">Reason</label>
            <input
              type="text"
              value={shortReason}
              onChange={e => setShortReason(e.target.value)}
              placeholder="e.g. Late to shift, No call no show..."
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the incident in detail..."
              rows={6}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red resize-y"
              required
            />
          </div>

          <SignaturePad
            label="Manager Signature (required)"
            value={managerSignature}
            onChange={setManagerSignature}
          />

          <SignaturePad
            label="Employee Signature (optional)"
            value={employeeSignature}
            onChange={setEmployeeSignature}
          />

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => { if (description.trim() && managerSignature) setShowPreview(true) }}
              disabled={!description.trim() || !managerSignature}
              className="px-5 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Preview
            </button>
            <button
              type="submit"
              disabled={submitting || !description.trim() || !managerSignature}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit & Send to Paychex'}
            </button>
          </div>
        </form>
      )}

      {!submitMsg?.type && showPreview && (
        <div className="space-y-4">
          <DocumentPreview
            employeeName={worker.displayName}
            reason={reason}
            shortReason={shortReason}
            description={description}
            managerName={userName}
            managerSignature={managerSignature}
            employeeSignature={employeeSignature}
            date={formatDate(new Date().toISOString())}
          />
          <div className="flex gap-3">
            <button
              onClick={() => setShowPreview(false)}
              className="px-5 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit & Send to Paychex'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Worker Document Detail — VIEW ONLY, no editing/signing/uploading
// ---------------------------------------------------------------------------
function WorkerDocuments({ worker }) {
  const [paychexDocs, setPaychexDocs] = useState([])
  const [localDocs, setLocalDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getPaychexWorkerDocuments(worker.workerId, worker.displayName)
      setPaychexDocs(res.paychexDocuments || [])
      setLocalDocs(res.localDocuments || [])
    } catch (err) {
      setError(err.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [worker.workerId, worker.displayName])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  return (
    <div className="space-y-4">
      {/* Worker header */}
      <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
          <span className="text-lg font-bold text-wcs-red">
            {(worker.givenName?.[0] || '').toUpperCase()}{(worker.familyName?.[0] || '').toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-base font-bold text-text-primary">{worker.displayName}</p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
            {worker.employeeId && <span>ID: {worker.employeeId}</span>}
            {worker.email && <span>{worker.email}</span>}
            {worker.hireDate && <span>Hired {formatDate(worker.hireDate)}</span>}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading documents...</p>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button onClick={fetchDocs} className="px-4 py-2 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors">Retry</button>
        </div>
      ) : (
        <>
          {paychexDocs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Paychex Documents</h3>
              <div className="space-y-2">
                {paychexDocs.map((doc, i) => (
                  <div key={doc.documentId || i} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-blue-500 shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {doc.description || doc.fileName || doc.documentName || `Document ${i + 1}`}
                      </p>
                      {doc.effectiveDate && <p className="text-[11px] text-text-muted">{formatDate(doc.effectiveDate)}</p>}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">Paychex</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Portal Documents {localDocs.length > 0 && `(${localDocs.length})`}
            </h3>
            {localDocs.length === 0 ? (
              <p className="text-center text-text-muted text-sm py-6 bg-surface border border-border rounded-xl">No portal documents for this employee</p>
            ) : (
              <div className="space-y-2">
                {localDocs.map(doc => {
                  const isExpanded = expandedId === doc.id
                  const reasonColor = REASON_COLORS[doc.reason] || REASON_COLORS.verbal_warning
                  const statusColor = STATUS_COLORS[doc.status] || STATUS_COLORS.draft
                  return (
                    <div key={doc.id} className="bg-surface border border-border rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : doc.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-bg/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${reasonColor}`}>
                              {REASON_LABELS[doc.reason] || doc.reason}
                            </span>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusColor}`}>
                              {STATUS_LABELS[doc.status] || doc.status}
                            </span>
                          </div>
                          {doc.short_reason && <p className="text-xs text-text-muted mt-1">{doc.short_reason}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-text-muted">{formatDate(doc.created_at)}</p>
                          <p className="text-xs text-text-muted">{doc.manager_name || ''}</p>
                        </div>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-border px-4 py-4">
                          <DocumentPreview
                            employeeName={doc.employee_name}
                            reason={doc.reason}
                            shortReason={doc.short_reason}
                            description={doc.body || doc.description}
                            managerName={doc.manager_name}
                            managerSignature={doc.manager_signature}
                            employeeSignature={doc.employee_signature}
                            date={formatDate(doc.created_at)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {paychexDocs.length === 0 && localDocs.length === 0 && (
            <p className="text-center text-text-muted text-sm py-8">No documents found for this employee</p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main HR View
// ---------------------------------------------------------------------------
export default function HRView({ user, onBack }) {
  // Navigation: landing | submit-pick | submit-form | list | worker-detail
  const [view, setView] = useState('landing')
  const [selectedWorker, setSelectedWorker] = useState(null)
  const [currentLocation, setCurrentLocation] = useState('')

  const backToLanding = () => { setView('landing'); setSelectedWorker(null) }

  // Back handler logic
  let currentBackHandler = onBack
  let backLabel = 'Back to Portal'
  if (view === 'submit-pick' || view === 'list') {
    currentBackHandler = backToLanding
    backLabel = 'Back'
  } else if (view === 'submit-form') {
    currentBackHandler = () => { setView('submit-pick'); setSelectedWorker(null) }
    backLabel = 'Back'
  } else if (view === 'worker-detail') {
    currentBackHandler = () => { setView('list'); setSelectedWorker(null) }
    backLabel = 'Back'
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={currentBackHandler}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {backLabel}
        </button>
        <h2 className="text-lg font-bold text-text-primary">HR Documents</h2>
      </div>

      {/* Landing — two tiles */}
      {view === 'landing' && (
        <div className="grid grid-cols-2 gap-6">
          <button
            onClick={() => setView('submit-pick')}
            className="group flex flex-col items-center justify-center gap-4 rounded-[14px] bg-surface border border-border p-10 min-h-[200px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-wcs-red">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
            </div>
            <div className="text-center">
              <span className="block text-lg font-semibold text-text-primary">Submit Document</span>
              <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">Create New</span>
            </div>
          </button>

          <button
            onClick={() => setView('list')}
            className="group flex flex-col items-center justify-center gap-4 rounded-[14px] bg-surface border border-border p-10 min-h-[200px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-wcs-red">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            </div>
            <div className="text-center">
              <span className="block text-lg font-semibold text-text-primary">View Documents</span>
              <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">Employee Files</span>
            </div>
          </button>
        </div>
      )}

      {/* Submit — Step 1: Pick employee */}
      {view === 'submit-pick' && (
        <div>
          <p className="text-sm text-text-muted mb-4">Select an employee to create a document for:</p>
          <WorkerList
            user={user}
            onSelectWorker={w => { setSelectedWorker(w); setView('submit-form') }}
            onLocationChange={setCurrentLocation}
          />
        </div>
      )}

      {/* Submit — Step 2: Fill form */}
      {view === 'submit-form' && selectedWorker && (
        <SubmitDocumentForm
          worker={selectedWorker}
          user={user}
          onBack={backToLanding}
          onSuccess={() => { setSelectedWorker(null); setView('submit-pick') }}
        />
      )}

      {/* View Docs — Worker list */}
      {view === 'list' && (
        <WorkerList
          user={user}
          onSelectWorker={w => { setSelectedWorker(w); setView('worker-detail') }}
          onLocationChange={setCurrentLocation}
        />
      )}

      {/* View Docs — Worker detail */}
      {view === 'worker-detail' && selectedWorker && (
        <WorkerDocuments worker={selectedWorker} />
      )}
    </div>
  )
}
