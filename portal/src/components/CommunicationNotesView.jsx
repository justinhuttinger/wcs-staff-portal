import { useState, useEffect, useCallback } from 'react'
import {
  getCommunicationNotes,
  createCommunicationNote,
  updateCommunicationNote,
  getCommunicationNoteComments,
  addCommunicationNoteComment,
} from '../lib/api'

const CATEGORIES = ['Member', 'Billing', 'Cancel', 'Equipment', 'Other']
const STATUSES = ['unresolved', 'in_progress', 'completed']

const CATEGORY_COLORS = {
  Member: 'bg-blue-50 text-blue-700 border-blue-200',
  Billing: 'bg-green-50 text-green-700 border-green-200',
  Cancel: 'bg-red-50 text-red-700 border-red-200',
  Equipment: 'bg-amber-50 text-amber-700 border-amber-200',
  Other: 'bg-gray-100 text-gray-600 border-gray-200',
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

const ROLE_LEVELS = { team_member: 0, fd_lead: 1, pt_lead: 2, manager: 3, corporate: 4, admin: 5 }

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
  const isLeadPlus = roleIdx >= ROLE_LEVELS.fd_lead
  const userName = user?.staff?.display_name || user?.staff?.first_name || ''

  // Submit form state
  const [formOpen, setFormOpen] = useState(!isLeadPlus)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Member')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState(null)

  // List state
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('unresolved')
  const [categoryFilter, setCategoryFilter] = useState('All')

  // Expanded note state
  const [expandedId, setExpandedId] = useState(null)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const fetchNotes = useCallback(() => {
    if (!isLeadPlus) return
    setLoading(true)
    getCommunicationNotes()
      .then(res => setNotes(res.notes || []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false))
  }, [isLeadPlus])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setSubmitting(true)
    setSubmitMsg(null)
    createCommunicationNote({ title: title.trim(), category, body: body.trim() })
      .then(() => {
        setTitle('')
        setCategory('Member')
        setBody('')
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
        return getCommunicationNoteComments(noteId)
      })
      .then(res => setComments(res.comments || []))
      .catch(() => {})
      .finally(() => setCommentSubmitting(false))
  }

  // Filter notes
  const filteredNotes = notes.filter(n => {
    if (n.status !== statusFilter) return false
    if (categoryFilter !== 'All' && n.category !== categoryFilter) return false
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

      {/* Submit Form */}
      <div className="bg-surface border border-border rounded-xl mb-6 overflow-hidden">
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
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Body</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Describe the issue or note in detail..."
                rows={4}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red resize-none"
                required
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !title.trim() || !body.trim()}
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
      </div>

      {/* Notes List (fd_lead+ only) */}
      {isLeadPlus && (
        <>
          {/* Status Tabs */}
          <div className="flex gap-2 mb-4">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setExpandedId(null) }}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                  statusFilter === s
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-muted border-border hover:border-text-muted'
                }`}
              >
                {STATUS_LABELS[s]}
                <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[11px] font-bold px-1 ${
                  statusFilter === s ? 'bg-white/20 text-white' : 'bg-bg text-text-muted'
                }`}>
                  {statusCounts[s] || 0}
                </span>
              </button>
            ))}
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {['All', ...CATEGORIES].map(c => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
                  categoryFilter === c
                    ? 'bg-wcs-red/10 text-wcs-red border-wcs-red/30'
                    : 'bg-surface text-text-muted border-border hover:border-text-muted'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Notes */}
          {loading ? (
            <p className="text-sm text-text-muted text-center py-8">Loading notes...</p>
          ) : filteredNotes.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No {STATUS_LABELS[statusFilter].toLowerCase()} notes{categoryFilter !== 'All' ? ` in ${categoryFilter}` : ''}</p>
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
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${CATEGORY_COLORS[note.category] || CATEGORY_COLORS.Other}`}>
                              {note.category}
                            </span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[note.status] || STATUS_COLORS.unresolved}`}>
                              {STATUS_LABELS[note.status] || note.status}
                            </span>
                          </div>
                          <p className={`text-sm text-text-muted ${isExpanded ? '' : 'line-clamp-2'}`}>
                            {note.body}
                          </p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
                            <span>Submitted by {note.submitted_by || 'Unknown'}</span>
                            <span>·</span>
                            <span>{formatDate(note.created_at)}</span>
                            {note.status === 'completed' && note.completed_by && (
                              <>
                                <span>·</span>
                                <span className="text-green-600">Completed by {note.completed_by} · {formatDate(note.completed_at)}</span>
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
                        {/* Status Action Buttons */}
                        <div className="flex gap-2">
                          {note.status !== 'in_progress' && (
                            <button
                              onClick={() => handleStatusChange(note, 'in_progress')}
                              disabled={updatingStatus}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 disabled:opacity-50 transition-colors"
                            >
                              Mark In Progress
                            </button>
                          )}
                          {note.status !== 'completed' && (
                            <button
                              onClick={() => handleStatusChange(note, 'completed')}
                              disabled={updatingStatus}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                            >
                              Mark Completed
                            </button>
                          )}
                          {note.status !== 'unresolved' && (
                            <button
                              onClick={() => handleStatusChange(note, 'unresolved')}
                              disabled={updatingStatus}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:bg-bg disabled:opacity-50 transition-colors"
                            >
                              Reopen
                            </button>
                          )}
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
                                    <span className="text-xs font-semibold text-text-primary">{c.author || 'Unknown'}</span>
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
