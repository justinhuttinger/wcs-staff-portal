import React, { useState, useEffect, useCallback } from 'react'
import {
  getCommunicationNotes,
  createCommunicationNote,
  updateCommunicationNote,
  getCommunicationNoteComments,
  addCommunicationNoteComment,
} from '../../lib/api'

const ROLES = ['team_member', 'fd_lead', 'pt_lead', 'manager', 'corporate', 'admin']

const STATUS_TABS = [
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
]

const CATEGORIES = ['member', 'billing', 'cancel', 'equipment', 'other']

const CATEGORY_COLORS = {
  member: 'bg-blue-50 text-blue-700 border-blue-200',
  billing: 'bg-green-50 text-green-700 border-green-200',
  cancel: 'bg-red-50 text-red-700 border-red-200',
  equipment: 'bg-amber-50 text-amber-700 border-amber-200',
  other: 'bg-gray-50 text-gray-600 border-gray-200',
}

const STATUS_COLORS = {
  unresolved: 'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
}

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

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-wcs-red border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function MobileCommunicationNotes({ user }) {
  const role = user?.staff?.role || 'team_member'
  const canViewNotes = ROLES.indexOf(role) >= ROLES.indexOf('fd_lead')
  const userName = user?.staff?.display_name || user?.staff?.first_name || 'Staff'
  const locationId = user?.staff?.locations?.find(l => l.is_primary)?.id || user?.staff?.locations?.[0]?.id

  const [showForm, setShowForm] = useState(false)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusTab, setStatusTab] = useState('unresolved')
  const [categoryFilter, setCategoryFilter] = useState(null)
  const [statusCounts, setStatusCounts] = useState({ unresolved: 0, in_progress: 0, completed: 0 })

  // Form state
  const [formTitle, setFormTitle] = useState('')
  const [formCategory, setFormCategory] = useState('member')
  const [formBody, setFormBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Detail view
  const [selectedNote, setSelectedNote] = useState(null)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const fetchNotes = useCallback(async () => {
    if (!canViewNotes) return
    setLoading(true)
    try {
      const params = { status: statusTab }
      if (categoryFilter) params.category = categoryFilter
      if (locationId) params.location_id = locationId
      const res = await getCommunicationNotes(params)
      const list = res?.notes || res?.data || res || []
      setNotes(list)

      // Update count for current tab
      setStatusCounts(prev => ({ ...prev, [statusTab]: list.length }))
    } catch (err) {
      console.error('Failed to fetch communication notes:', err)
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [canViewNotes, statusTab, categoryFilter, locationId])

  // Fetch counts for all tabs on mount
  useEffect(() => {
    if (!canViewNotes) return
    let cancelled = false
    async function fetchCounts() {
      try {
        const params = {}
        if (locationId) params.location_id = locationId
        const [unresolved, inProgress, completed] = await Promise.all([
          getCommunicationNotes({ ...params, status: 'unresolved' }),
          getCommunicationNotes({ ...params, status: 'in_progress' }),
          getCommunicationNotes({ ...params, status: 'completed' }),
        ])
        if (!cancelled) {
          const toLen = r => (r?.notes || r?.data || r || []).length
          setStatusCounts({
            unresolved: toLen(unresolved),
            in_progress: toLen(inProgress),
            completed: toLen(completed),
          })
        }
      } catch { /* ignore */ }
    }
    fetchCounts()
    return () => { cancelled = true }
  }, [canViewNotes, locationId])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!formTitle.trim() || !formBody.trim()) return
    setSubmitting(true)
    try {
      await createCommunicationNote({
        title: formTitle.trim(),
        category: formCategory,
        body: formBody.trim(),
        location_id: locationId,
      })
      setFormTitle('')
      setFormCategory('member')
      setFormBody('')
      setShowForm(false)
      fetchNotes()
    } catch (err) {
      console.error('Failed to create note:', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function openNoteDetail(note) {
    setSelectedNote(note)
    setCommentsLoading(true)
    try {
      const res = await getCommunicationNoteComments(note.id)
      setComments(res?.comments || res?.data || res || [])
    } catch {
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }

  async function handleAddComment(e) {
    e.preventDefault()
    if (!commentText.trim() || !selectedNote) return
    setCommentSubmitting(true)
    try {
      await addCommunicationNoteComment(selectedNote.id, { body: commentText.trim() })
      setCommentText('')
      const res = await getCommunicationNoteComments(selectedNote.id)
      setComments(res?.comments || res?.data || res || [])
    } catch (err) {
      console.error('Failed to add comment:', err)
    } finally {
      setCommentSubmitting(false)
    }
  }

  async function handleStatusChange(newStatus) {
    if (!selectedNote) return
    setUpdatingStatus(true)
    try {
      await updateCommunicationNote(selectedNote.id, { status: newStatus })
      setSelectedNote(prev => ({ ...prev, status: newStatus }))
      fetchNotes()
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setUpdatingStatus(false)
    }
  }

  // ---------- Note Detail View ----------
  if (selectedNote) {
    const note = selectedNote
    return (
      <div className="flex flex-col h-full bg-bg">
        {/* Header */}
        <div className="bg-surface border-b border-border px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedNote(null)} className="p-1 text-text-muted active:text-text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-text-primary truncate flex-1">Note Detail</h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Note content */}
          <div className="bg-surface rounded-2xl border border-border p-4 mt-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="text-base font-bold text-text-primary flex-1">{note.title}</h3>
              <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[note.category] || CATEGORY_COLORS.other}`}>
                {note.category}
              </span>
            </div>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{note.body}</p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
              <span>by {note.submitted_by_name || note.author_name || 'Unknown'}</span>
              <span>&middot;</span>
              <span>{relativeDate(note.created_at)}</span>
            </div>
            {note.status === 'completed' && note.completed_at && (
              <div className="mt-1 text-[11px] text-green-600">
                Completed {relativeDate(note.completed_at)}
              </div>
            )}
          </div>

          {/* Status buttons */}
          <div className="flex gap-2 mt-3">
            {STATUS_TABS.map(s => {
              const isActive = note.status === s.key
              const color = STATUS_COLORS[s.key]
              return (
                <button
                  key={s.key}
                  onClick={() => !isActive && handleStatusChange(s.key)}
                  disabled={isActive || updatingStatus}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    isActive ? color : 'bg-surface text-text-muted border-border'
                  } ${isActive || updatingStatus ? 'opacity-60' : 'active:scale-95'}`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>

          {/* Comments */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-text-primary mb-2">
              Comments {comments.length > 0 && `(${comments.length})`}
            </h4>
            {commentsLoading ? (
              <Spinner />
            ) : comments.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">No comments yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {comments.map((c, i) => (
                  <div key={c.id || i} className="bg-surface rounded-xl border border-border px-3 py-2">
                    <p className="text-sm text-text-secondary">{c.body}</p>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {c.author_name || c.submitted_by_name || 'Unknown'} &middot; {relativeDate(c.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add comment form */}
          <form onSubmit={handleAddComment} className="mt-3 flex gap-2">
            <input
              type="text"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-wcs-red"
            />
            <button
              type="submit"
              disabled={commentSubmitting || !commentText.trim()}
              className="px-4 py-2 bg-wcs-red text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
            >
              {commentSubmitting ? '...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ---------- Main View ----------
  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="bg-surface border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">Comm Notes</h2>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 bg-wcs-red text-white rounded-xl text-xs font-semibold active:scale-95 transition-transform"
          >
            + New Note
          </button>
        </div>

        {/* Status tabs (leads+ only) */}
        {canViewNotes && (
          <div className="flex gap-2 mt-3">
            {STATUS_TABS.map(s => {
              const isActive = statusTab === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setStatusTab(s.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-surface text-text-muted border-border'
                  }`}
                >
                  {s.label} ({statusCounts[s.key] || 0})
                </button>
              )
            })}
          </div>
        )}

        {/* Category filter (leads+ only) */}
        {canViewNotes && (
          <div className="flex gap-2 mt-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            <button
              onClick={() => setCategoryFilter(null)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap shrink-0 transition-colors ${
                !categoryFilter
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-muted border-border'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => {
              const isActive = categoryFilter === cat
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(isActive ? null : cat)}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap shrink-0 capitalize transition-colors ${
                    isActive
                      ? CATEGORY_COLORS[cat]
                      : 'bg-surface text-text-muted border-border'
                  }`}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!canViewNotes ? (
          /* team_member: just a message encouraging them to submit notes */
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mb-2 opacity-40">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm font-medium">Submit Communication Notes</p>
            <p className="text-xs mt-1">Tap &quot;+ New Note&quot; to create a note</p>
          </div>
        ) : loading ? (
          <Spinner />
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mb-2 opacity-40">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm">No {statusTab.replace('_', ' ')} notes</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            {notes.map((note, i) => (
              <button
                key={note.id || i}
                onClick={() => openNoteDetail(note)}
                className="w-full text-left bg-surface rounded-2xl border border-border p-4 active:scale-[0.98] transition-transform"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-text-primary flex-1 truncate">{note.title}</h3>
                  <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[note.category] || CATEGORY_COLORS.other}`}>
                    {note.category}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2">{note.body}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-text-muted">
                    by {note.submitted_by_name || note.author_name || 'Unknown'} &middot; {relativeDate(note.created_at)}
                  </span>
                  {(note.comment_count != null && note.comment_count > 0) && (
                    <span className="text-[11px] text-text-muted flex items-center gap-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                      </svg>
                      {note.comment_count}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New Note Modal */}
      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div
            className="w-full max-w-lg bg-surface rounded-t-2xl border-t border-border p-4 pb-8 animate-slide-up"
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text-primary">New Communication Note</h3>
              <button onClick={() => setShowForm(false)} className="p-1 text-text-muted active:text-text-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Title</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Note title"
                  required
                  className="w-full px-3 py-2.5 rounded-xl bg-bg border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-wcs-red"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Category</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-wcs-red"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat} className="capitalize">{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Body</label>
                <textarea
                  value={formBody}
                  onChange={e => setFormBody(e.target.value)}
                  placeholder="Describe the issue or note..."
                  required
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-wcs-red resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !formTitle.trim() || !formBody.trim()}
                className="w-full py-3 bg-wcs-red text-white rounded-xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform mt-1"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                ) : (
                  'Submit Note'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
