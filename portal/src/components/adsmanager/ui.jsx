import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { statusTone, prettyStatus } from './constants'

// Modals portal to <body>: the ads manager renders inside a z-10 wrapper, and
// anything less escapes neither that stacking context nor the mobile tab bar.
export function Modal({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4 sm:p-8">
      <div className={`w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} bg-surface border border-border rounded-2xl shadow-2xl my-auto`}>
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{title}</h3>
            {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-2xl leading-none px-2 -mt-1"
            aria-label="Close"
          >×</button>
        </div>
        <div className="px-6 py-5 space-y-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Field({ label, hint, children, required, error }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-text-primary mb-1.5">
        {label}{required && <span className="text-wcs-red ml-0.5">*</span>}
      </span>
      {children}
      {error
        ? <span className="block text-[11px] text-red-600 mt-1">{error}</span>
        : hint && <span className="block text-[11px] text-text-muted mt-1">{hint}</span>}
    </label>
  )
}

const inputBase = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red/40'

export function TextInput(props) {
  return <input {...props} className={`${inputBase} ${props.className || ''}`} />
}

export function TextArea(props) {
  return <textarea {...props} className={`${inputBase} resize-y ${props.className || ''}`} />
}

export function Select({ options, ...props }) {
  return (
    <select {...props} className={`${inputBase} ${props.className || ''}`}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Button({ variant = 'primary', children, ...props }) {
  const styles = {
    primary: 'bg-wcs-red text-white hover:bg-wcs-red/90 disabled:bg-wcs-red/40',
    secondary: 'bg-bg border border-border text-text-primary hover:bg-border/40',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/40',
    ghost: 'text-text-muted hover:text-text-primary',
  }
  return (
    <button
      {...props}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${props.className || ''}`}
    >{children}</button>
  )
}

export function StatusPill({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusTone(status)}`}>
      {prettyStatus(status)}
    </span>
  )
}

// A live counter that goes amber once copy passes the point where Meta starts
// truncating. Not a hard block — sometimes a long primary text is deliberate.
export function CharCount({ value, limit }) {
  const len = (value || '').length
  const over = len > limit
  return (
    <span className={`text-[11px] tabular-nums ${over ? 'text-amber-600 font-semibold' : 'text-text-muted'}`}>
      {len}/{limit}{over ? ' — may truncate' : ''}
    </span>
  )
}

export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
      <p className="text-sm text-red-700">{error}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-700/60 hover:text-red-700 text-lg leading-none">×</button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {hint && <p className="text-xs text-text-muted mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-text-muted">
      <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      <span className="text-xs">{label || 'Loading…'}</span>
    </div>
  )
}
