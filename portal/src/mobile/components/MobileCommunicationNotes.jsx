import React, { useState, useEffect, useCallback } from 'react'
import {
  getCommunicationNotes,
  createCommunicationNote,
  updateCommunicationNote,
  getCommunicationNoteComments,
  addCommunicationNoteComment,
} from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'
import MobileLoading from './MobileLoading'

const ROLES = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const STATUSES = ['unresolved', 'in_progress', 'completed']
const CATEGORIES = ['member', 'billing', 'cancel', 'equipment', 'other']

const STATUS_LABELS = {
  unresolved: 'Unresolved',
  in_progress: 'In Progress',
  completed: 'Completed',
}

const STATUS_DOT_COLOR = {
  unresolved: 'bg-amber-500',
  in_progress: 'bg-blue-500',
  completed: 'bg-green-500',
}

const STATUS_COLORS = {
  unresolved: 'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
}

const CATEGORY_DOT_COLOR = {
  member: 'bg-blue-500',
  billing: 'bg-green-500',
  cancel: 'bg-red-500',
  equipment: 'bg-amber-500',
  other: 'bg-gray-400',
}

function formatDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(s) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getDefaultDateFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

function getDefaultDateTo() {
  return new Date().toISOString().slice(0, 10)
}

function Spinner() {
  return <MobileLoading variant="comm-notes" count={4} />
}

function CopyButton({ value, onCopy, copied }) {
  if (!value) return null
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onCopy(value) }}
      className="text-wcs-red active:text-wcs-red/70"
      title="Copy"
    >
      {copied ? (
        <span className="text-[10px] text-green-600 font-semibold">Copied!</span>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
        </svg>
      )}
    </button>
  )
}

export default function MobileCommunicationNotes({ user }) {
  const role = user?.staff?.role || 'team_member'
  const isLeadPlus = ROLES.indexOf(role) >= ROLES.indexOf('lead')
  const canSeeAll = role === 'corporate' || role === 'admin'
  const userName = user?.staff?.display_name || user?.staff?.first_name || 'Staff'

  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('unresolved')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom)
  const [dateTo, setDateTo] = useState(getDefaultDateTo)
  const [statusCounts, setStatusCounts] = useState({ unresolved: 0, in_progress: 0, completed: 0 })

  // Submit form
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formMemberName, setFormMemberName] = useState('')
  const [formMemberPhone, setFormMemberPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Detail
  const [selectedNote, setSelectedNote] = useState(null)
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

  const fetchNotes = useCallback(async () => {
    if (!isLeadPlus) return
    setLoading(true)
    try {
      const params = { status: statusFilter }
      if (categoryFilter !== 'all') params.category = categoryFilter
      if (canSeeAll && locationFilter !== 'all') params.location_slug = locationFilter
      // Date filter only for completed (matches desktop)
      if (statusFilter === 'completed') {
        if (dateFrom) params.date_from = dateFrom
        if (dateTo) params.date_to = dateTo
      }
      const res = await getCommunicationNotes(params)
      setNotes(res?.notes || res?.data || res || [])
    } catch (err) {
      console.error('Failed to fetch communication notes:', err)
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [isLeadPlus, statusFilter, categoryFilter, canSeeAll, locationFilter, dateFrom, dateTo])

  // Counts for tab badges
  useEffect(() => {
    if (!isLeadPlus) return
    let cancelled = false
    async function fetchCounts() {
      try {
        const baseParams = {}
        if (canSeeAll && locationFilter !== 'all') baseParams.location_slug = locationFilter
        const completedParams = { ...baseParams }
        if (dateFrom) completedParams.date_from = dateFrom
        if (dateTo) completedParams.date_to = dateTo
        const [unresolved, inProgress, completed] = await Promise.all([
          getCommunicationNotes({ ...baseParams, status: 'unresolved' }),
          getCommunicationNotes({ ...baseParams, status: 'in_progress' }),
          getCommunicationNotes({ ...completedParams, status: 'completed' }),
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
  }, [isLeadPlus, canSeeAll, locationFilter, dateFrom, dateTo])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!formTitle.trim() || !formBody.trim() || !formCategory) return
    setSubmitting(true)
    try {
      const payload = {
        title: formTitle.trim(),
        category: formCategory,
        body: formBody.trim(),
      }
      if (formCategory === 'member') {
        if (formMemberName.trim()) payload.member_name = formMemberName.trim()
        if (formMemberPhone.trim()) payload.member_phone = formMemberPhone.trim()
      }
      await createCommunicationNote(payload)
      setFormTitle(''); setFormCategory(''); setFormBody('')
      setFormMemberName(''); setFormMemberPhone('')
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
      const updateData = { status: newStatus }
      if (newStatus === 'completed') {
        updateData.completed_by = userName
        updateData.completed_at = new Date().toISOString()
      }
      await updateCommunicationNote(selectedNote.id, updateData)
      setSelectedNote(prev => ({ ...prev, ...updateData }))
      fetchNotes()
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setUpdatingStatus(false)
    }
  }

  // ---------- Note Detail (modal) ----------
  if (selectedNote) {
    const note = selectedNote
    return (
      <div className="flex flex-col h-full bg-bg">
        <div className="mx-4 mt-4 bg-surface rounded-2xl border border-border shadow-sm p-4">
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
          <div className="bg-surface rounded-2xl border border-border p-4 mt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOT_COLOR[note.category] || CATEGORY_DOT_COLOR.other}`} />
              <h3 className="text-base font-bold text-text-primary flex-1">{note.title}</h3>
              <span className="text-[11px] text-text-muted capitalize shrink-0">{note.category}</span>
            </div>
            {note.member_name && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted mb-2">
                <span className="font-medium text-text-primary">{note.member_name}</span>
                <CopyButton
                  value={note.member_name}
                  copied={copiedField === `name-${note.id}`}
                  onCopy={v => copyToClipboard(v, `name-${note.id}`)}
                />
                {note.member_phone && (
                  <>
                    <span>·</span>
                    <span className="text-text-primary">{note.member_phone}</span>
                    <CopyButton
                      value={note.member_phone}
                      copied={copiedField === `phone-${note.id}`}
                      onCopy={v => copyToClipboard(v, `phone-${note.id}`)}
                    />
                  </>
                )}
              </div>
            )}
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{note.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span>Submitted by {note.submitted_by_name || note.author_name || 'Unknown'}</span>
              <span>·</span>
              <span>{formatDate(note.created_at)}</span>
            </div>
            {note.status === 'completed' && note.completed_by && (
              <div className="mt-1 text-[11px] text-green-600">
                Completed by {note.completed_by_name || note.completed_by} · {formatDate(note.completed_at)}
              </div>
            )}
          </div>

          {/* Status dropdown — matches desktop */}
          <div className="flex items-center gap-3 mt-3 px-1">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Status</span>
            <select
              value={note.status}
              onChange={e => handleStatusChange(e.target.value)}
              disabled={updatingStatus}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border focus:outline-none focus:border-wcs-red ${STATUS_COLORS[note.status] || ''}`}
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Comments */}
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Comments</h4>
            {commentsLoading ? (
              <Spinner />
            ) : comments.length === 0 ? (
              <p className="text-xs text-text-muted py-3 text-center">No comments yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {comments.map((c, i) => (
                  <div key={c.id || i} className="bg-bg rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-text-primary">{c.author_name || c.submitted_by_name || 'Unknown'}</span>
                      <span className="text-[10px] text-text-muted">{formatDateTime(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

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
              {commentSubmitting ? '...' : 'Post'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ---------- Main view ----------
  return (
    <div className="flex flex-col h-full">
      {/* Header card */}
      <div className="mx-4 mt-4 mb-2 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-lg font-bold text-text-primary">Comm Notes</h2>
          {!isLeadPlus && (
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 bg-wcs-red text-white rounded-xl text-xs font-semibold active:scale-95 transition-transform"
            >
              + New Note
            </button>
          )}
        </div>

        {/* Status tabs — compact, dot + count, like desktop */}
        {isLeadPlus && (
          <div className="flex items-center border-t border-border">
            {STATUSES.map(s => {
              const active = statusFilter === s
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors flex-1 justify-center ${
                    active ? 'text-text-primary' : 'text-text-muted'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLOR[s]}`} />
                  <span>{STATUS_LABELS[s]}</span>
                  <span className={`text-[10px] ${active ? 'font-bold' : ''}`}>
                    {statusCounts[s] || 0}
                  </span>
                  {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-wcs-red rounded-full" />}
                </button>
              )
            })}
          </div>
        )}

        {/* Filter row: category + location + date (only for completed) */}
        {isLeadPlus && (
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap border-t border-border">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-2 py-1.5 text-[11px] rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>

            {canSeeAll && (
              <select
                value={locationFilter}
                onChange={e => setLocationFilter(e.target.value)}
                className="px-2 py-1.5 text-[11px] rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
              >
                <option value="all">All Locations</option>
                {LOCATION_NAMES.map(loc => (
                  <option key={loc} value={loc.toLowerCase()}>{loc}</option>
                ))}
              </select>
            )}

            {statusFilter === 'completed' && (
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-[105px] px-1.5 py-1 text-[10px] rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                />
                <span className="text-[10px] text-text-muted">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-[105px] px-1.5 py-1 text-[10px] rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!isLeadPlus ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mb-2 opacity-40">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm font-medium">Submit Communication Notes</p>
            <p className="text-xs mt-1">Tap "+ New Note" to create a note</p>
          </div>
        ) : loading ? (
          <Spinner />
        ) : notes.length === 0 ? (
          <p className="text-text-muted text-sm py-12 text-center">
            No {STATUS_LABELS[statusFilter].toLowerCase()} notes
            {categoryFilter !== 'all' ? ` in ${categoryFilter}` : ''}
          </p>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            {notes.map(note => (
              <button
                key={note.id}
                onClick={() => openNoteDetail(note)}
                className="w-full text-left bg-surface rounded-2xl border border-border p-4 active:scale-[0.98] transition-transform"
              >
                <div className="flex items-start gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${CATEGORY_DOT_COLOR[note.category] || CATEGORY_DOT_COLOR.other}`} />
                  <h3 className="text-sm font-semibold text-text-primary flex-1 truncate">{note.title}</h3>
                  <span className="text-[11px] text-text-muted capitalize shrink-0">· {note.category}</span>
                </div>
                {note.member_name && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted mb-1 ml-4">
                    <span className="font-medium">Member: {note.member_name}</span>
                    <CopyButton
                      value={note.member_name}
                      copied={copiedField === `name-${note.id}`}
                      onCopy={v => copyToClipboard(v, `name-${note.id}`)}
                    />
                    {note.member_phone && (
                      <>
                        <span>·</span>
                        <span>{note.member_phone}</span>
                        <CopyButton
                          value={note.member_phone}
                          copied={copiedField === `phone-${note.id}`}
                          onCopy={v => copyToClipboard(v, `phone-${note.id}`)}
                        />
                      </>
                    )}
                  </div>
                )}
                <p className="text-xs text-text-secondary line-clamp-2 ml-4">{note.body}</p>
                <div className="mt-2 ml-4 flex items-center justify-between text-[11px] text-text-muted">
                  <span>
                    by {note.submitted_by_name || note.author_name || 'Unknown'} · {formatDate(note.created_at)}
                    {note.status === 'completed' && note.completed_at && (
                      <span className="text-green-600"> · Completed {formatDate(note.completed_at)}</span>
                    )}
                  </span>
                  {(note.comment_count != null && note.comment_count > 0) && (
                    <span className="flex items-center gap-0.5 shrink-0 ml-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.399-.49c1.583-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
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

      {/* New Note bottom sheet */}
      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div
            className="w-full max-w-lg bg-surface rounded-t-2xl border-t border-border p-4 pb-8"
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
                  required
                >
                  <option value="" disabled>Select a category...</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>

              {formCategory === 'member' && (
                <>
                  <div>
                    <label className="text-[11px] font-medium text-text-muted mb-1 block">Member Name</label>
                    <input
                      type="text"
                      value={formMemberName}
                      onChange={e => setFormMemberName(e.target.value)}
                      placeholder="Member full name"
                      className="w-full px-3 py-2.5 rounded-xl bg-bg border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-wcs-red"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-text-muted mb-1 block">Member Phone</label>
                    <input
                      type="tel"
                      value={formMemberPhone}
                      onChange={e => setFormMemberPhone(e.target.value)}
                      placeholder="(555) 555-5555"
                      className="w-full px-3 py-2.5 rounded-xl bg-bg border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-wcs-red"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Body</label>
                <textarea
                  value={formBody}
                  onChange={e => setFormBody(e.target.value)}
                  placeholder="Type your message here..."
                  required
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-wcs-red resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !formTitle.trim() || !formBody.trim() || !formCategory}
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
