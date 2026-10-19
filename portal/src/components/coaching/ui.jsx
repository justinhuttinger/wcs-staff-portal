import { useState } from 'react'

// Small shared pieces for the Coaching tile. Every block sits in a card
// (the portal's dark-backdrop rule).

export function Card({ title, hint, action, children, className = '', bodyClass = '' }) {
  return (
    <section className={`border border-border rounded-xl bg-surface overflow-hidden ${className}`}>
      {title ? (
        <header className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <h3 className="font-bold text-text-primary text-sm">{title}</h3>
          {hint ? <span className="text-xs text-text-muted truncate">{hint}</span> : null}
          {action ? <div className="ml-auto shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

const TONES = {
  default: 'text-text-primary',
  good: 'text-green-700',
  warn: 'text-amber-600',
  bad: 'text-wcs-red',
}

export function StatCard({ label, value, sub, tone = 'default', onClick, active }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`text-left border rounded-xl bg-surface px-4 py-3 ${onClick ? 'hover:border-text-muted transition-colors' : ''} ${active ? 'border-wcs-red ring-1 ring-wcs-red/40' : 'border-border'}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-2xl font-bold leading-tight mt-0.5 ${TONES[tone] || TONES.default}`}>{value ?? '-'}</div>
      {sub ? <div className="text-xs text-text-muted mt-0.5">{sub}</div> : null}
    </Tag>
  )
}

export function StatusPill({ status }) {
  const map = {
    active: ['Active', 'bg-green-100 text-green-800'],
    archived: ['Archived', 'bg-bg text-text-muted border border-border'],
    not_client: ['Not a client', 'bg-bg text-text-muted border border-border'],
  }
  const [label, cls] = map[status] || [status, 'bg-bg text-text-muted']
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>
}

export function Initials({ name, size = 'md' }) {
  const letters = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
  const dim = size === 'lg' ? 'w-14 h-14 text-lg' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return <span className={`${dim} shrink-0 rounded-full bg-navy text-white font-bold grid place-items-center`}>{letters}</span>
}

// Copy button with the required "Copied!" confirmation.
export function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      type="button" onClick={copy}
      className={`relative shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${copied ? 'bg-green-100 text-green-700 border-green-300' : 'border-border bg-surface text-text-muted hover:text-text-primary'}`}
    >
      <span className={copied ? 'opacity-0' : ''}>{label}</span>
      {copied ? <span className="absolute inset-0 grid place-items-center text-green-700">Copied!</span> : null}
    </button>
  )
}

export function BackLink({ onClick, children }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      {children}
    </button>
  )
}

export const btn = 'px-3 py-2 rounded-lg border border-border bg-surface text-sm font-semibold hover:border-text-muted disabled:opacity-50'
export const primaryBtn = 'px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover disabled:opacity-50'
export const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm'

/** "2026-10-19" -> "Mon, Oct 19". */
export function prettyDay(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(iso)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A timestamp as "5 min ago", "3 h ago", "2 days ago", else a date. */
export function ago(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Days between a YYYY-MM-DD and today (YYYY-MM-DD). */
export function daysSince(iso, today) {
  if (!iso || !today) return null
  return Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)) / 86400000)
}
