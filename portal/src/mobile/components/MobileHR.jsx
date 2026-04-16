import React, { useState, useEffect, useCallback } from 'react'
import {
  createHRDocument,
  getPaychexWorkers,
  getPaychexWorkerDocuments,
  getPaychexLocations,
} from '../../lib/api'
import SignaturePad from '../../components/SignaturePad'

const ROLES = ['team_member', 'lead', 'manager', 'corporate', 'admin']

const REASON_OPTIONS = [
  { key: 'coaching_conversation', label: 'Coaching' },
  { key: 'verbal_warning', label: 'Verbal' },
  { key: 'written_warning', label: 'Written' },
  { key: 'termination', label: 'Termination' },
]

const REASON_COLORS = {
  coaching_conversation: 'bg-blue-50 text-blue-700 border-blue-200',
  verbal_warning: 'bg-amber-50 text-amber-700 border-amber-200',
  written_warning: 'bg-orange-50 text-orange-700 border-orange-200',
  termination: 'bg-red-50 text-red-700 border-red-200',
}

const REASON_LABELS = {
  coaching_conversation: 'Coaching Conversation',
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  termination: 'Termination',
}

const STATUS_COLORS = {
  draft: 'bg-gray-50 text-gray-600 border-gray-200',
  pending_signature: 'bg-green-50 text-green-700 border-green-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  uploaded: 'bg-blue-50 text-blue-700 border-blue-200',
}

const STATUS_LABELS = {
  draft: 'Draft',
  pending_signature: 'Completed',
  completed: 'Completed',
  uploaded: 'Uploaded',
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
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

function BackButton({ onClick }) {
  return (
    <button onClick={onClick} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface border border-border">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
    </button>
  )
}

// --- Worker List (GET employees first) ---
function WorkerList({ user, onSelectWorker, actionLabel }) {
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [locationSlug, setLocationSlug] = useState('')
  const [locations, setLocations] = useState([])

  const canSeeAll = ['corporate', 'admin', 'director'].includes(user?.staff?.role)

  useEffect(() => {
    if (canSeeAll) {
      getPaychexLocations()
        .then(res => setLocations(res.locations || []))
        .catch(() => {})
    }
  }, [canSeeAll])

  const needsLocationPick = canSeeAll && !locationSlug

  const fetchWorkers = useCallback(async () => {
    if (needsLocationPick) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const res = await getPaychexWorkers(canSeeAll && locationSlug ? locationSlug : undefined)
      setWorkers(res.workers || [])
      if (!locationSlug && res.location) setLocationSlug(res.location)
    } catch (err) {
      setError(err.message || 'Failed to load employees')
    } finally {
      setLoading(false)
    }
  }, [locationSlug, canSeeAll, needsLocationPick])

  useEffect(() => { fetchWorkers() }, [fetchWorkers])

  const filtered = workers.filter(w => {
    if (!search) return true
    const q = search.toLowerCase()
    return w.displayName.toLowerCase().includes(q) ||
      w.employeeId?.toLowerCase().includes(q) ||
      (w.preferredName && w.preferredName.toLowerCase().includes(q))
  })

  return (
    <div className="space-y-3">
      {/* Location pills for corporate+ */}
      {canSeeAll && locations.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {locations.map(loc => (
            <button
              key={loc.slug}
              onClick={() => setLocationSlug(loc.slug)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
                locationSlug === loc.slug
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border'
              }`}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {needsLocationPick ? (
        <div className="text-center py-12">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-text-muted mx-auto mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
          <p className="text-sm font-medium text-text-primary">Select a location to begin</p>
          <p className="text-xs text-text-muted mt-1">Choose a location above to view employees</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employees..."
              className="w-full pl-9 pr-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red"
            />
          </div>

          {!loading && <p className="text-[11px] text-text-muted">{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</p>}

          {loading ? (
            <Spinner />
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button onClick={fetchWorkers} className="px-4 py-2 text-xs font-semibold rounded-lg bg-wcs-red text-white">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">No employees found</p>
          ) : (
            <div className="space-y-2">
              {filtered.map(w => (
                <button
                  key={w.workerId}
                  onClick={() => onSelectWorker(w)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-2xl text-left active:scale-[0.98] transition-transform"
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
                      {w.hireDate && <span className="text-[11px] text-text-muted">Hired {formatDate(w.hireDate)}</span>}
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// --- Worker Detail: show docs + submit new doc ---
function WorkerDetail({ worker, user, onBack }) {
  const [paychexDocs, setPaychexDocs] = useState([])
  const [localDocs, setLocalDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSubmit, setShowSubmit] = useState(false)
  const [toast, setToast] = useState(null)
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

  if (showSubmit) {
    return (
      <SubmitDocumentForm
        worker={worker}
        user={user}
        onBack={() => setShowSubmit(false)}
        onSuccess={() => {
          setShowSubmit(false)
          setToast('Document submitted')
          fetchDocs()
        }}
      />
    )
  }

  return (
    <div className="px-4 pt-4 pb-8">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <BackButton onClick={onBack} />
        <h2 className="text-lg font-bold text-text-primary">Employee Details</h2>
      </div>

      {/* Worker card */}
      <div className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
          <span className="text-lg font-bold text-wcs-red">
            {(worker.givenName?.[0] || '').toUpperCase()}{(worker.familyName?.[0] || '').toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-text-primary">{worker.displayName}</p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
            {worker.employeeId && <span>ID: {worker.employeeId}</span>}
            {worker.email && <span>{worker.email}</span>}
            {worker.hireDate && <span>Hired {formatDate(worker.hireDate)}</span>}
          </div>
        </div>
      </div>

      {/* Submit new doc button */}
      <button
        onClick={() => setShowSubmit(true)}
        className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold text-sm mb-4 active:scale-[0.98] transition-transform"
      >
        Submit HR Document
      </button>

      {/* Documents */}
      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button onClick={fetchDocs} className="px-4 py-2 text-xs font-semibold rounded-lg bg-wcs-red text-white">Retry</button>
        </div>
      ) : (
        <>
          {paychexDocs.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Paychex Documents</p>
              <div className="space-y-2">
                {paychexDocs.map((doc, i) => (
                  <div key={doc.documentId || i} className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Portal Documents {localDocs.length > 0 && `(${localDocs.length})`}
            </p>
            {localDocs.length === 0 ? (
              <p className="text-center text-text-muted text-sm py-6 bg-surface border border-border rounded-2xl">No portal documents for this employee</p>
            ) : (
              <div className="space-y-2">
                {localDocs.map(doc => {
                  const isExpanded = expandedId === doc.id
                  return (
                    <div key={doc.id} className="bg-surface border border-border rounded-2xl overflow-hidden">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : doc.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-bg transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${REASON_COLORS[doc.reason] || ''}`}>
                              {REASON_LABELS[doc.reason] || doc.reason}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_COLORS[doc.status] || ''}`}>
                              {STATUS_LABELS[doc.status] || doc.status}
                            </span>
                          </div>
                          {doc.short_reason && <p className="text-xs text-text-muted mt-1">{doc.short_reason}</p>}
                        </div>
                        <span className="text-[11px] text-text-muted shrink-0">{formatDate(doc.created_at)}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-border px-4 py-4 space-y-3 text-sm">
                          <div>
                            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Description</p>
                            <p className="text-text-primary whitespace-pre-wrap">{doc.body || doc.description}</p>
                          </div>
                          {doc.action_plan && (
                            <div>
                              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Action Plan</p>
                              <p className="text-text-primary whitespace-pre-wrap">{doc.action_plan}</p>
                            </div>
                          )}
                          {doc.manager_signature && (
                            <div>
                              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Manager Signature</p>
                              {doc.manager_signature.startsWith('data:image') ? (
                                <img src={doc.manager_signature} alt="Manager signature" className="h-12 border-b border-border" />
                              ) : (
                                <p className="text-text-primary italic">{doc.manager_signature}</p>
                              )}
                            </div>
                          )}
                          {doc.employee_signature && (
                            <div>
                              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Employee Signature</p>
                              {doc.employee_signature.startsWith('data:image') ? (
                                <img src={doc.employee_signature} alt="Employee signature" className="h-12 border-b border-border" />
                              ) : (
                                <p className="text-text-primary italic">{doc.employee_signature}</p>
                              )}
                            </div>
                          )}
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

// --- Submit Document Form ---
function SubmitDocumentForm({ worker, user, onBack, onSuccess }) {
  const [reason, setReason] = useState('coaching_conversation')
  const [description, setDescription] = useState('')
  const [actionPlan, setActionPlan] = useState('')
  const [managerSignature, setManagerSignature] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!description.trim() || !managerSignature) return
    setSubmitting(true)
    setError(null)
    try {
      await createHRDocument({
        employee_name: worker.displayName,
        worker_id: worker.workerId,
        reason,
        description: description.trim(),
        action_plan: actionPlan.trim() || null,
        manager_signature: managerSignature,
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
      <div className="flex items-center gap-3 mb-4">
        <BackButton onClick={onBack} />
        <h2 className="text-lg font-bold text-text-primary">Submit HR Document</h2>
      </div>

      {/* Worker card */}
      <div className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-wcs-red">
            {(worker.givenName?.[0] || '').toUpperCase()}{(worker.familyName?.[0] || '').toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-sm font-bold text-text-primary">{worker.displayName}</p>
          {worker.employeeId && <p className="text-[11px] text-text-muted">ID: {worker.employeeId}</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Reason pills */}
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Reason</label>
          <div className="flex gap-2 flex-wrap">
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

        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the incident or reason..."
            rows={6}
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 resize-none"
            required
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Action Plan / Next Steps</label>
          <textarea
            value={actionPlan}
            onChange={e => setActionPlan(e.target.value)}
            placeholder="Outline expected improvements..."
            rows={4}
            className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 resize-none"
          />
        </div>

        <SignaturePad label="Manager Signature" value={managerSignature} onChange={setManagerSignature} />

        {error && (
          <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <button
          type="submit"
          disabled={submitting || !description.trim() || !managerSignature}
          className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {submitting ? 'Submitting...' : 'Submit Document'}
        </button>
      </form>
    </div>
  )
}

// --- Main Component ---
export default function MobileHR({ user }) {
  const role = user?.staff?.role || 'team_member'
  const isManager = ROLES.indexOf(role) >= ROLES.indexOf('manager')

  // Navigation: landing | submit-pick | worker-detail
  const [view, setView] = useState('landing')
  const [selectedWorker, setSelectedWorker] = useState(null)
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

  // Submit pick — employee list first
  if (view === 'submit-pick') {
    return (
      <div className="px-4 pt-4 pb-8">
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        <div className="flex items-center gap-3 mb-4">
          <BackButton onClick={() => setView('landing')} />
          <h2 className="text-lg font-bold text-text-primary">Submit Document</h2>
        </div>
        <p className="text-sm text-text-muted mb-4">Select an employee:</p>
        <WorkerList
          user={user}
          onSelectWorker={w => { setSelectedWorker(w); setView('submit-form') }}
        />
      </div>
    )
  }

  // Submit form for selected worker
  if (view === 'submit-form' && selectedWorker) {
    return (
      <>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        <SubmitDocumentForm
          worker={selectedWorker}
          user={user}
          onBack={() => setView('submit-pick')}
          onSuccess={() => {
            setToast('Document submitted successfully')
            setView('landing')
            setSelectedWorker(null)
          }}
        />
      </>
    )
  }

  // View documents — employee list first, then detail
  if (view === 'view-pick') {
    return (
      <div className="px-4 pt-4 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <BackButton onClick={() => setView('landing')} />
          <h2 className="text-lg font-bold text-text-primary">View Documents</h2>
        </div>
        <p className="text-sm text-text-muted mb-4">Select an employee to view their documents:</p>
        <WorkerList
          user={user}
          onSelectWorker={w => { setSelectedWorker(w); setView('worker-detail') }}
        />
      </div>
    )
  }

  if (view === 'worker-detail' && selectedWorker) {
    return (
      <WorkerDetail
        worker={selectedWorker}
        user={user}
        onBack={() => { setView('view-pick'); setSelectedWorker(null) }}
      />
    )
  }

  // Landing view — two tiles
  return (
    <div className="px-4 pt-6 pb-8">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div className="bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 mb-6">
        <h1 className="text-xl font-bold text-text-primary">HR Documents</h1>
      </div>

      <div className="space-y-4">
        <button
          onClick={() => setView('submit-pick')}
          className="w-full bg-surface border border-border rounded-2xl p-6 flex items-center gap-4 active:scale-[0.98] transition-transform text-left"
        >
          <div className="w-14 h-14 rounded-full bg-wcs-red/10 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <span className="block text-base font-bold text-text-primary">Submit Document</span>
            <span className="block text-xs text-text-muted mt-0.5">Select employee, then create HR document</span>
          </div>
        </button>

        <button
          onClick={() => setView('view-pick')}
          className="w-full bg-surface border border-border rounded-2xl p-6 flex items-center gap-4 active:scale-[0.98] transition-transform text-left"
        >
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-blue-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <div>
            <span className="block text-base font-bold text-text-primary">View Documents</span>
            <span className="block text-xs text-text-muted mt-0.5">Select employee to view their files</span>
          </div>
        </button>
      </div>
    </div>
  )
}
