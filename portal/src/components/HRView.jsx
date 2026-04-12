import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getHRDocuments,
  createHRDocument,
  uploadHRDocumentToPaychex,
  acknowledgeHRDocument,
  getStaff,
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

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function EmployeeSearch({ staffList, value, onChange }) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = staffList.filter(s => {
    const name = (s.display_name || [s.first_name, s.last_name].filter(Boolean).join(' ')).toLowerCase()
    return name.includes(query.toLowerCase())
  }).slice(0, 10)

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-semibold text-text-primary mb-1">Employee Name</label>
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); onChange('') }}
        onFocus={() => setOpen(true)}
        placeholder="Search employees..."
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
        autoComplete="off"
      />
      {open && query.length > 0 && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(s => {
            const name = s.display_name || [s.first_name, s.last_name].filter(Boolean).join(' ')
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onChange(name); setQuery(name); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg transition-colors"
              >
                <span className="font-medium">{name}</span>
                {s.role && <span className="ml-2 text-xs text-text-muted">{s.role.replace(/_/g, ' ')}</span>}
              </button>
            )
          })}
        </div>
      )}
      {open && query.length > 0 && filtered.length === 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-sm text-text-muted">
          No employees found
        </div>
      )}
    </div>
  )
}

function DocumentPreview({ employeeName, reason, description, managerName, managerSignature, date }) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden shadow-sm">
      {/* Red header bar */}
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Employee Acknowledgment</p>
            <p className="text-xs text-text-muted italic">Pending employee signature</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function HRView({ user, onBack }) {
  const userName = user?.staff?.display_name || user?.staff?.first_name || ''

  // Staff list for employee search
  const [staffList, setStaffList] = useState([])
  useEffect(() => {
    getStaff().then(res => setStaffList(res?.staff || res || [])).catch(() => {})
  }, [])

  // Navigation state: 'landing' | 'submit' | 'list'
  const [view, setView] = useState('landing')

  // Submit form state
  const [employeeName, setEmployeeName] = useState('')
  const [reason, setReason] = useState('verbal_warning')
  const [description, setDescription] = useState('')
  const [managerSignature, setManagerSignature] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState(null)

  // List state
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterReason, setFilterReason] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [uploading, setUploading] = useState(null)
  const [acknowledging, setAcknowledging] = useState(null)
  const [employeeSig, setEmployeeSig] = useState('')

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (searchQuery.trim()) params.employee_name = searchQuery.trim()
      if (filterReason !== 'all') params.reason = filterReason
      if (filterStatus !== 'all') params.status = filterStatus
      const res = await getHRDocuments(params)
      setDocuments(res.documents || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [searchQuery, filterReason, filterStatus])

  useEffect(() => {
    if (view === 'list') {
      fetchDocuments()
    }
  }, [view, fetchDocuments])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!employeeName.trim() || !description.trim() || !managerSignature) return
    setSubmitting(true)
    setSubmitMsg(null)
    try {
      await createHRDocument({
        employee_name: employeeName.trim(),
        reason,
        description: description.trim(),
        manager_signature: managerSignature.trim(),
      })
      setSubmitMsg({ type: 'success', text: 'Document submitted successfully.' })
      setEmployeeName('')
      setDescription('')
      setReason('verbal_warning')
      setShowPreview(false)
    } catch (err) {
      setSubmitMsg({ type: 'error', text: err.message || 'Failed to submit document.' })
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setEmployeeName('')
    setReason('verbal_warning')
    setDescription('')
    setManagerSignature('')
    setShowPreview(false)
    setSubmitMsg(null)
  }

  async function handleUploadToPaychex(docId) {
    setUploading(docId)
    try {
      await uploadHRDocumentToPaychex(docId)
      await fetchDocuments()
    } catch {
      // silent
    } finally {
      setUploading(null)
    }
  }

  async function handleAcknowledge(docId) {
    if (!employeeSig) return
    setAcknowledging(docId)
    try {
      await acknowledgeHRDocument(docId, { employee_signature: employeeSig })
      setEmployeeSig('')
      await fetchDocuments()
    } catch {
      // silent
    } finally {
      setAcknowledging(null)
    }
  }

  // Back button for sub-views
  const backToLanding = () => {
    setView('landing')
    resetForm()
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={view === 'landing' ? onBack : backToLanding}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {view === 'landing' ? 'Back to Portal' : 'Back'}
        </button>
        <h2 className="text-lg font-bold text-text-primary">HR Documents</h2>
      </div>

      {/* Landing — two tiles */}
      {view === 'landing' && (
        <div className="grid grid-cols-2 gap-6">
          <button
            onClick={() => setView('submit')}
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
              </svg>
            </div>
            <div className="text-center">
              <span className="block text-lg font-semibold text-text-primary">View Documents</span>
              <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">Search & Review</span>
            </div>
          </button>
        </div>
      )}

      {/* Submit Document Form */}
      {view === 'submit' && (
        <div className="space-y-6">
          {submitMsg && (
            <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${submitMsg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {submitMsg.text}
              {submitMsg.type === 'success' && (
                <div className="mt-2 flex gap-3">
                  <button onClick={backToLanding} className="text-xs underline hover:no-underline">Back to HR</button>
                  <button onClick={resetForm} className="text-xs underline hover:no-underline">Submit Another</button>
                </div>
              )}
            </div>
          )}

          {!showPreview ? (
            <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-6 space-y-5">
              <EmployeeSearch
                staffList={staffList}
                value={employeeName}
                onChange={setEmployeeName}
              />

              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Reason</label>
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
                <label className="block text-sm font-semibold text-text-primary mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what happened..."
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red resize-y"
                  required
                />
              </div>

              <SignaturePad
                label="Manager Signature"
                value={managerSignature}
                onChange={setManagerSignature}
              />

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (employeeName.trim() && description.trim()) setShowPreview(true)
                  }}
                  disabled={!employeeName.trim() || !description.trim()}
                  className="px-5 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Preview
                </button>
                <button
                  type="submit"
                  disabled={submitting || !employeeName.trim() || !description.trim() || !managerSignature}
                  className="px-5 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting...' : 'Submit Document'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <DocumentPreview
                employeeName={employeeName}
                reason={reason}
                description={description}
                managerName={userName}
                managerSignature={managerSignature}
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
                  {submitting ? 'Submitting...' : 'Submit Document'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* View Documents */}
      {view === 'list' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by employee name..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
              />
            </div>
            <div className="flex gap-3">
              <select
                value={filterReason}
                onChange={e => setFilterReason(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:border-wcs-red"
              >
                <option value="all">All Reasons</option>
                {REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:border-wcs-red"
              >
                <option value="all">All Statuses</option>
                <option value="pending_signature">Pending Signature</option>
                <option value="completed">Completed</option>
                <option value="uploaded">Uploaded</option>
              </select>
            </div>
          </div>

          {/* Document list */}
          {loading ? (
            <p className="text-center text-text-muted text-sm py-8">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">No documents found</p>
          ) : (
            <div className="space-y-3">
              {documents.map(doc => {
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
                        <span className="font-semibold text-sm text-text-primary">{doc.employee_name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${reasonColor}`}>
                            {REASON_LABELS[doc.reason] || doc.reason}
                          </span>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusColor}`}>
                            {STATUS_LABELS[doc.status] || doc.status}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-text-muted">{formatDate(doc.created_at)}</p>
                        <p className="text-xs text-text-muted">{doc.manager_name || doc.manager_signature || ''}</p>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border px-4 py-4 space-y-4">
                        <DocumentPreview
                          employeeName={doc.employee_name}
                          reason={doc.reason}
                          description={doc.description}
                          managerName={doc.manager_name}
                          managerSignature={doc.manager_signature}
                          date={formatDate(doc.created_at)}
                        />

                        {doc.employee_signature && (
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Employee Signature</p>
                            {doc.employee_signature.startsWith('data:image') ? (
                              <img src={doc.employee_signature} alt="Employee signature" className="h-16 border-b border-border" />
                            ) : (
                              <p className="text-sm italic text-text-primary">{doc.employee_signature}</p>
                            )}
                            {doc.employee_acknowledged_at && (
                              <p className="text-[10px] text-text-muted mt-1">Acknowledged {formatDate(doc.employee_acknowledged_at)}</p>
                            )}
                          </div>
                        )}

                        {doc.status === 'pending_signature' && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-3">
                            <p className="text-xs font-semibold text-yellow-700">Employee Acknowledgment Required</p>
                            <SignaturePad
                              label="Employee Signature"
                              value={employeeSig}
                              onChange={setEmployeeSig}
                            />
                            <button
                              onClick={() => handleAcknowledge(doc.id)}
                              disabled={!employeeSig || acknowledging === doc.id}
                              className="px-4 py-2 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {acknowledging === doc.id ? 'Acknowledging...' : 'Sign & Acknowledge'}
                            </button>
                          </div>
                        )}

                        {doc.status === 'completed' && (
                          <button
                            onClick={() => handleUploadToPaychex(doc.id)}
                            disabled={uploading === doc.id}
                            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {uploading === doc.id ? 'Uploading...' : 'Upload to Paychex'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
