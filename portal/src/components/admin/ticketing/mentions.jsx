// @mention helpers + composer for ticket comments.
//
// A mention is stored inline in the comment body as a stable token:
//     @[Display Name](user:<uuid>)
// The uuid is the source of truth (names change); rendering resolves the label
// from the token. This mirrors auth/src/services/ticketMentions.js so the client
// and server agree on exactly what a mention is.

import { useEffect, useMemo, useRef, useState } from 'react'

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export const MENTION_RE = new RegExp(`@\\[([^\\]]*)\\]\\(user:(${UUID})\\)`, 'g')

// The token string for a picked person.
export function mentionToken(person) {
  return `@[${person.name}](user:${person.id})`
}

// Unique {id, name} pairs mentioned in a body, first-seen order.
export function parseMentions(body) {
  const text = String(body || '')
  const seen = new Set()
  const out = []
  let m
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    const id = m[2].toLowerCase()
    if (!seen.has(id)) { seen.add(id); out.push({ id, name: m[1] }) }
  }
  return out
}

// Render a body with mention tokens as highlighted chips, plain text otherwise.
// `currentUserId` highlights mentions of the viewer more strongly.
export function MentionText({ body, currentUserId }) {
  const parts = []
  const text = String(body || '')
  let last = 0
  let m
  MENTION_RE.lastIndex = 0
  let key = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const isMe = currentUserId && m[2].toLowerCase() === String(currentUserId).toLowerCase()
    parts.push(
      <span key={`mt${key++}`}
        className={`inline-flex items-center rounded px-1 font-semibold ${isMe ? 'bg-wcs-red/15 text-wcs-red' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
        @{m[1]}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className="whitespace-pre-wrap">{parts}</span>
}

// Composer: a textarea whose value is the raw body (may contain tokens). Typing
// `@` opens a picker sourced from `staff`; choosing someone inserts a token at
// the caret. A live "Mentioning" strip shows who's currently tagged. `onEnter`
// fires on Enter when the picker is closed (Shift+Enter always newlines).
export function MentionComposer({
  value, onChange, staff = [], currentUserId, placeholder, rows = 2, disabled, onEnter,
}) {
  const taRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState(0) // index of the '@' being completed

  const matches = useMemo(() => {
    if (!open) return []
    const q = query.toLowerCase()
    return staff
      .filter(s => !q || s.name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [open, query, staff])

  const mentioned = useMemo(() => parseMentions(value), [value])

  // After the value/caret changes, decide whether an @-token is being typed.
  function refreshPicker(el) {
    const caret = el.selectionStart
    const upto = el.value.slice(0, caret)
    // Match a trailing "@word" not preceded by a word char (so emails don't trigger).
    const m = /(^|\s)@([\w.\-]*)$/.exec(upto)
    if (m) {
      setAnchor(caret - m[2].length - 1)
      setQuery(m[2])
      setActive(0)
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  function handleChange(e) {
    onChange(e.target.value)
    refreshPicker(e.target)
  }

  function insert(person) {
    const el = taRef.current
    const caret = el ? el.selectionStart : value.length
    const before = value.slice(0, anchor)
    const after = value.slice(caret)
    const token = mentionToken(person) + ' '
    const next = before + token + after
    onChange(next)
    setOpen(false)
    // Restore caret just after the inserted token.
    requestAnimationFrame(() => {
      if (!el) return
      const pos = (before + token).length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(e) {
    if (open && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !open && onEnter) {
      e.preventDefault()
      onEnter()
    }
  }

  useEffect(() => { /* close picker if staff empties */ if (!staff.length) setOpen(false) }, [staff.length])

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={e => refreshPicker(e.target)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder || 'Add a note… use @ to mention someone'}
        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 left-2 right-2 mt-1 max-h-56 overflow-auto bg-surface border border-border rounded-lg shadow-lg">
          {matches.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); insert(s) }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 ${i === active ? 'bg-wcs-red/10 text-text-primary' : 'text-text-muted hover:bg-bg'}`}>
                <span className="font-medium text-text-primary truncate">{s.name}</span>
                {s.email && <span className="text-[11px] text-text-muted truncate">{s.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {mentioned.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-text-muted">Mentioning:</span>
          {mentioned.map(p => (
            <span key={p.id}
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${currentUserId && p.id === String(currentUserId).toLowerCase() ? 'bg-wcs-red/15 text-wcs-red' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
              @{p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
