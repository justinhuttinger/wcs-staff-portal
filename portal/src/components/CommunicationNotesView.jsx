import { useState, useEffect, useCallback } from 'react'
import { LOCATION_NAMES } from '../config/locations'
import {
  getCommunicationNotes,
  createCommunicationNote,
  updateCommunicationNote,
  getCommunicationNoteComments,
  addCommunicationNoteComment,
} from '../lib/api'

const CATEGORIES = ['member', 'billing', 'cancel', 'equipment', 'other']
const STATUSES = ['unresolved', 'in_progress', 'completed']

const CATEGORY_COLORS = {
  member: 'bg-blue-50 text-blue-700 border-blue-200',
  billing: 'bg-green-50 text-green-700 border-green-200',
  cancel: 'bg-red-50 text-red-700 border-red-200',
  equipment: 'bg-amber-50 text-amber-700 border-amber-200',
  other: 'bg-gray-100 text-gray-600 border-gray-200',
}

const STATUS_COLORS = {
  unresolved: 'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
}

const STATUS_LABELS = {
  unresolved: 'Unresolved',
  in_progress: 'In Progress',
  completed: 'Completed',
}

const ROLE_LEVELS = { team_member: 0, lead: 1, manager: 2, corporate: 3, admin: 4 }

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function CommunicationNotesView({ user, onBack }) {
  const role = user?.staff?.role || 'team_member'
  const roleIdx = ROLE_LEVELS[role] ?? 0
  const isLeadPlus = roleIdx >= ROLE_LEVELS.lead
  const canSeeAll = role === 'corporate' || role === 'admin'
  const userName = user?.staff?.display_name || user?.staff?.first_name || ''
  const ALL_LOCATIONS = LOCATION_NAMES

  // Date filter helpers
  function getDefaultDateFrom() {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  }
  function getDefaultDateTo() {
    return new Date().toISOString().slice(0, 10)
  }

  // Submit form state
  const [formOpen, setFormOpen] = useState(!isLeadPlus)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberPhone, setMemberPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState(null)

  // List state
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('unresolved')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom)
  const [dateTo, setDateTo] = useState(getDefaultDateTo)

  // Expanded note state
  const [expandedId, setExpandedId] = useState(null)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [copiedField, setCopiedField] = useState(null)

  function copyToClipboard(text, fieldKey) {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldKey)
    setTimeout(() => setCopiedField(null), 1500)
  }

  const fetchNotes = useCallback(() => {
    if (!isLeadPlus) return
    setLoading(true)
    const params = {}
    if (canSeeAll && locationFilter !== 'all') params.location_slug = locationFilter
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    getCommunicationNotes(params)
      .then(res => setNotes(res.notes || []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false))
  }, [isLeadPlus, canSeeAll, locationFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !body.trim() || !category) return
    setSubmitting(true)
    setSubmitMsg(null)
    const payload = { title: title.trim(), category, body: body.trim() }
    if (category === 'member') {
      if (memberName.trim()) payload.member_name = memberName.trim()
      if (memberPhone.trim()) payload.member_phone = memberPhone.trim()
    }
    createCommunicationNote(payload)
      .then(() => {
        setTitle('')
        setCategory('')
        setBody('')
        setMemberName('')
        setMemberPhone('')
        setSubmitMsg({ type: 'success', text: 'Note submitted successfully' })
        fetchNotes()
        if (!isLeadPlus) setTimeout(() => setSubmitMsg(null), 3000)
      })
      .catch(err => {
        setSubmitMsg({ type: 'error', text: err.message || 'Failed to submit' })
      })
      .finally(() => setSubmitting(false))
  }

  function handleStatusChange(note, newStatus) {
    setUpdatingStatus(true)
    const updateData = { status: newStatus }
    if (newStatus === 'completed') {
      updateData.completed_by = userName
      updateData.completed_at = new Date().toISOString()
    }
    updateCommunicationNote(note.id, updateData)
      .then(() => fetchNotes())
      .catch(() => {})
      .finally(() => setUpdatingStatus(false))
  }

  function toggleExpand(noteId) {
    if (expandedId === noteId) {
      setExpandedId(null)
      setComments([])
      setCommentText('')
      return
    }
    setExpandedId(noteId)
    setCommentsLoading(true)
    getCommunicationNoteComments(noteId)
      .then(res => setComments(res.comments || []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false))
  }

  function handleAddComment(noteId) {
    if (!commentText.trim()) return
    setCommentSubmitting(true)
    addCommunicationNoteComment(noteId, { body: commentText.trim() })
      .then(() => {
        setCommentText('')
        setNotes(prev => prev.map(n => n.id === noteId ? { ...n, comment_count: (n.comment_count || 0) + 1 } : n))
        return getCommunicationNoteComments(noteId)
      })
      .then(res => setComments(res.comments || []))
      .catch(() => {})
      .finally(() => setCommentSubmitting(false))
  }

  // Filter notes
  const filteredNotes = notes.filter(n => {
    if (n.status !== statusFilter) return false
    if (categoryFilter !== 'all' && n.category !== categoryFilter) return false
    return true
  })

  // Count badges per status
  const statusCounts = {}
  for (const s of STATUSES) {
    statusCounts[s] = notes.filter(n => n.status === s).length
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}
        <h2 className="text-xl font-black text-text-primary tracking-[-0.5px]">Communication Notes</h2>
      </div>

      {/* Submit Form — team_member only */}
      {!isLeadPlus && <div className="bg-surface border border-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="w-full flex items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-semibold text-text-primary">Submit a Note</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`w-4 h-4 text-text-muted transition-transform ${formOpen ? 'rotate-180' : ''}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {formOpen && (
          <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-3 border-t border-border pt-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Brief summary..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                required
              >
                <option value="" disabled>Select a category...</option>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            {category === 'member' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Member Name</label>
                  <input
                    type="text"
                    value={memberName}
                    onChange={e => setMemberName(e.target.value)}
                    placeholder="Member full name"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Member Phone</label>
                  <input
                    type="tel"
                    value={memberPhone}
                    onChange={e => setMemberPhone(e.target.value)}
                    placeholder="(555) 555-5555"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Body</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Type your message here..."
                rows={4}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red resize-none"
                required
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !title.trim() || !body.trim() || !category}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Note'}
              </button>
              {submitMsg && (
                <span className={`text-xs font-medium ${submitMsg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                  {submitMsg.text}
                </span>
              )}
            </div>
          </form>
        )}
      </div>}

      {/* Notes List (lead+ only) */}
      {isLeadPlus && (
        <>
          {/* Status Tabs + Date Range (inline) */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex gap-1.5 shrink-0">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setExpandedId(null) }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                    statusFilter === s
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-surface text-text-muted border-border hover:border-text-muted'
                  }`}
                >
                  {STATUS_LABELS[s]}
                  <span className={`min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[10px] font-bold px-0.5 ${
                    statusFilter === s ? 'bg-white/20 text-white' : 'bg-bg text-text-muted'
                  }`}>
                    {statusCounts[s] || 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[108px] px-1 py-1 text-[11px] rounded border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red" />
              <span className="text-[10px] text-text-muted">–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[108px] px-1 py-1 text-[11px] rounded border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red" />
              {[
                { label: '7d', days: 7 },
                { label: '30d', days: 30 },
                { label: '90d', days: 90 },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - days)
                    setDateFrom(d.toISOString().slice(0, 10))
                    setDateTo(new Date().toISOString().slice(0, 10))
                  }}
                  className="px-1.5 py-1 text-[10px] font-semibold rounded-md border border-border bg-surface text-text-muted hover:border-text-muted transition-colors"
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="px-1.5 py-1 text-[10px] font-semibold rounded-md border border-border bg-surface text-text-muted hover:border-text-muted transition-colors"
              >
                All
              </button>
            </div>
          </div>

          {/* Location Filter (corp/admin only) */}
          {canSeeAll && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {['all', ...ALL_LOCATIONS.map(l => l.toLowerCase())].map(loc => (
                <button
                  key={loc}
                  onClick={() => setLocationFilter(loc)}
                  className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
                    locationFilter === loc
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-surface text-text-muted border-border hover:border-text-muted'
                  }`}
                >
                  {loc === 'all' ? 'All Locations' : loc.charAt(0).toUpperCase() + loc.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {['all', ...CATEGORIES].map(c => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
                  categoryFilter === c
                    ? 'bg-wcs-red/10 text-wcs-red border-wcs-red/30'
                    : 'bg-surface text-text-muted border-border hover:border-text-muted'
                }`}
              >
                {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>

          {/* Notes */}
          {loading ? (
            <p className="text-sm text-text-muted text-center py-8">Loading notes...</p>
          ) : filteredNotes.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No {STATUS_LABELS[statusFilter].toLowerCase()} notes{categoryFilter !== 'all' ? ` in ${categoryFilter}` : ''}</p>
          ) : (
            <div className="space-y-3">
              {filteredNotes.map(note => {
                const isExpanded = expandedId === note.id
                return (
                  <div
                    key={note.id}
                    className="bg-surface border border-border rounded-xl overflow-hidden"
                  >
                    {/* Note Card Header */}
                    <button
                      onClick={() => toggleExpand(note.id)}
                      className="w-full text-left px-5 py-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-bold text-text-primary">{note.title}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${CATEGORY_COLORS[note.category] || CATEGORY_COLORS.other}`}>
                              {note.category}
                            </span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[note.status] || STATUS_COLORS.unresolved}`}>
                              {STATUS_LABELS[note.status] || note.status}
                            </span>
                          </div>
                          {note.member_name && (
                            <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
                              <span className="font-medium">Member: {note.member_name}</span>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); copyToClipboard(note.member_name, `name-${note.id}`) }}
                                className="text-wcs-red hover:text-wcs-red/70 transition-colors relative"
                                title="Copy name"
                              >
                                {copiedField === `name-${note.id}` ? (
                                  <span className="text-[10px] text-green-600 font-semibold animate-pulse">Copied!</span>
                                ) : (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                                  </svg>
                                )}
                              </button>
                              {note.member_phone && (
                                <>
                                  <span>·</span>
                                  <span>{note.member_phone}</span>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); copyToClipboard(note.member_phone, `phone-${note.id}`) }}
                                    className="text-wcs-red hover:text-wcs-red/70 transition-colors"
                                    title="Copy phone"
                                  >
                                    {copiedField === `phone-${note.id}` ? (
                                      <span className="text-[10px] text-green-600 font-semibold animate-pulse">Copied!</span>
                                    ) : (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                                      </svg>
                                    )}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          <p className={`text-sm text-text-muted ${isExpanded ? '' : 'line-clamp-2'}`}>
                            {note.body}
                          </p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
                            <span>Submitted by {note.submitted_by_name || 'Unknown'}</span>
                            <span>·</span>
                            <span>{formatDate(note.created_at)}</span>
                            {note.status === 'completed' && note.completed_by && (
                              <>
                                <span>·</span>
                                <span className="text-green-600">Completed by {note.completed_by_name || 'Unknown'} · {formatDate(note.completed_at)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {(note.comment_count > 0) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg text-text-muted text-[11px] font-semibold">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.399-.49c1.583-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                              </svg>
                              {note.comment_count}
                            </span>
                          )}
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="border-t border-border px-5 py-4 space-y-4">
                        {/* Status Dropdown */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Status</span>
                          <select
                            value={note.status}
                            onChange={e => handleStatusChange(note, e.target.value)}
                            disabled={updatingStatus}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer focus:outline-none focus:border-wcs-red ${STATUS_COLORS[note.status] || ''}`}
                          >
                            {STATUSES.map(s => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </div>

                        {/* Comments Section */}
                        <div>
                          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Comments</h4>
                          {commentsLoading ? (
                            <p className="text-xs text-text-muted">Loading comments...</p>
                          ) : comments.length === 0 ? (
                            <p className="text-xs text-text-muted mb-3">No comments yet</p>
                          ) : (
                            <div className="space-y-2 mb-3">
                              {comments.map(c => (
                                <div key={c.id} className="bg-bg rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold text-text-primary">{c.author_name || 'Unknown'}</span>
                                    <span className="text-[10px] text-text-muted">{formatDateTime(c.created_at)}</span>
                                  </div>
                                  <p className="text-sm text-text-primary">{c.body}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <textarea
                              value={commentText}
                              onChange={e => setCommentText(e.target.value)}
                              placeholder="Add a comment..."
                              rows={2}
                              className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red resize-none"
                            />
                            <button
                              onClick={() => handleAddComment(note.id)}
                              disabled={commentSubmitting || !commentText.trim()}
                              className="px-4 py-2 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
                            >
                              {commentSubmitting ? '...' : 'Post'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
