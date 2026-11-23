import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Dropdowns for Projects, styled like LocationMultiSelect: a trigger button
// and a panel portalled to <body>, positioned fixed from the trigger and
// clamped to the viewport (so it works inside the full-screen task view and
// near any edge). Multi-select stages its picks and commits on Apply.
//
// While a panel is open it marks <body data-pm-dropdown>, so the task view's
// Escape handler leaves the first Escape to the dropdown.

const MARGIN = 8
const GAP = 4
const MIN_H = 180

const TRIGGER = {
  pill: 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-bg text-text-primary border-border hover:border-text-muted',
  field: 'flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm border bg-bg text-text-primary border-border hover:border-text-muted',
  ghost: 'flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-sm border border-transparent text-text-primary hover:bg-bg',
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0 text-text-muted ml-auto" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25 12 15.75 4.5 8.25" />
    </svg>
  )
}

function usePanel(width) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const buttonRef = useRef(null)
  const panelRef = useRef(null)

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return }
    function place() {
      const btn = buttonRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = Math.min(Math.max(width, r.width), vw - MARGIN * 2)
      const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN))
      const below = vh - r.bottom - MARGIN
      const above = r.top - MARGIN
      const up = below < MIN_H && above > below
      setCoords({
        left, width: w,
        top: up ? undefined : r.bottom + GAP,
        bottom: up ? vh - r.top + GAP : undefined,
        maxHeight: Math.max(MIN_H, (up ? above : below) - GAP),
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, width])

  useEffect(() => {
    if (!open) return
    document.body.dataset.pmDropdown = '1'
    const onDown = e => {
      if (panelRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); buttonRef.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      delete document.body.dataset.pmDropdown
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const panelStyle = coords
    ? { position: 'fixed', left: coords.left, top: coords.top, bottom: coords.bottom, width: coords.width, maxHeight: coords.maxHeight }
    : { position: 'fixed', visibility: 'hidden' }
  return { open, setOpen, buttonRef, panelRef, panelStyle }
}

const PANEL = 'z-[130] overflow-y-auto bg-surface border border-border rounded-xl shadow-lg p-1.5'

function Trigger({ variant, buttonRef, open, onClick, label, children, title }) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} aria-haspopup="listbox" aria-expanded={open} title={title}
      className={`${TRIGGER[variant] || TRIGGER.pill} transition-colors min-w-0`}>
      {label && <span className="text-text-muted shrink-0">{label}</span>}
      <span className="truncate text-left min-w-0">{children}</span>
      <Chevron />
    </button>
  )
}

// options: [{ value, label, icon?, hint? }]
export function SingleSelect({ value, onChange, options, label, variant = 'pill', width = 220, disabled }) {
  const { open, setOpen, buttonRef, panelRef, panelStyle } = usePanel(width)
  const cur = options.find(o => o.value === value)
  return (
    <div className={variant === 'pill' ? 'inline-block' : 'block'}>
      <Trigger variant={variant} buttonRef={buttonRef} open={open} label={label} title={cur?.label}
        onClick={() => !disabled && setOpen(v => !v)}>
        <span className="inline-flex items-center gap-2">{cur?.icon}{cur?.label || 'Choose'}</span>
      </Trigger>
      {open && createPortal(
        <div ref={panelRef} role="listbox" style={panelStyle} className={PANEL}>
          {options.map(o => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-left hover:bg-bg ${o.value === value ? 'text-text-primary font-semibold' : 'text-text-primary'}`}>
              <span className={`w-4 h-4 rounded-full border shrink-0 ${o.value === value ? 'border-[5px] border-wcs-red' : 'border-border'}`} />
              {o.icon}
              <span className="truncate">{o.label}</span>
              {o.hint != null && <span className="ml-auto text-[11px] text-text-muted">{o.hint}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

// value: array of selected values, or null for "all". onChange gets null
// when everything is picked (if nullForAll), else the array in option order.
export function MultiSelect({
  value, onChange, options, label, variant = 'pill', width = 256, noun = 'items',
  allLabel, noneLabel, applyLabel = 'Apply', allowEmpty = false, nullForAll = true, renderValue,
}) {
  const { open, setOpen, buttonRef, panelRef, panelStyle } = usePanel(width)
  const all = useMemo(() => options.map(o => o.value), [options])
  const selected = useMemo(() => (value == null ? all : all.filter(v => value.includes(v))), [value, all])
  const [pending, setPending] = useState(() => new Set(selected))
  useEffect(() => { if (open) setPending(new Set(selected)) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const allOn = selected.length === all.length && all.length > 0
  const names = options.filter(o => selected.includes(o.value)).map(o => o.label)
  const text = renderValue ? renderValue(selected)
    : allOn ? (allLabel || `All ${noun}`)
      : names.length === 0 ? (noneLabel || `No ${noun}`)
        : names.length <= 2 ? names.join(', ') : `${names.length} ${noun}`

  const toggle = v => setPending(p => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n })
  const canApply = allowEmpty || pending.size > 0
  const apply = () => {
    if (!canApply) return
    const list = all.filter(v => pending.has(v))
    onChange(nullForAll && list.length === all.length ? null : list)
    setOpen(false)
  }

  return (
    <div className={variant === 'pill' ? 'inline-block' : 'block'}>
      <Trigger variant={variant} buttonRef={buttonRef} open={open} label={label} title={typeof text === 'string' ? text : undefined}
        onClick={() => setOpen(v => !v)}>
        {text}
      </Trigger>
      {open && createPortal(
        <div ref={panelRef} role="listbox" aria-multiselectable="true" style={panelStyle} className={PANEL}>
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-border">
            <button type="button" onClick={() => setPending(new Set(all))}
              className="text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold">Select all</button>
            <button type="button" onClick={() => setPending(new Set())}
              className="text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold">Clear</button>
          </div>
          <ul>
            {options.map(o => (
              <li key={o.value}>
                <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg">
                  <input type="checkbox" checked={pending.has(o.value)} onChange={() => toggle(o.value)} className="accent-wcs-red" />
                  {o.icon}
                  <span className="text-sm text-text-primary truncate">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 pt-2 border-t border-border flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] text-text-muted">{pending.size ? `${pending.size} selected` : (allowEmpty ? 'None selected' : `Pick at least one`)}</span>
            <button type="button" onClick={apply} disabled={!canApply}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${canApply ? 'bg-wcs-red text-white hover:bg-wcs-red/90' : 'bg-bg text-text-muted border border-border cursor-not-allowed'}`}>
              {applyLabel}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// Small coloured initials, shared by rows, cards, the task view and the chat.
const AVATAR_COLORS = ['#e53e3e', '#2f6fe4', '#1f9d55', '#d68a00', '#8b5cf6', '#0e9aa7', '#db2777', '#64748b']
export function Avatar({ id, name, size = 22 }) {
  const text = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  let h = 0
  for (const ch of String(id || name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span title={name} style={{ width: size, height: size, background: AVATAR_COLORS[h % AVATAR_COLORS.length], fontSize: Math.round(size * 0.42) }}
      className="inline-flex items-center justify-center rounded-full text-white font-bold shrink-0">
      {text}
    </span>
  )
}

export function AvatarStack({ ids, nameOf, max = 4, size = 22 }) {
  return (
    <span className="inline-flex items-center">
      {ids.slice(0, max).map((id, i) => (
        <span key={id} className={`rounded-full ring-2 ring-surface ${i ? '-ml-1.5' : ''}`}><Avatar id={id} name={nameOf(id)} size={size} /></span>
      ))}
      {ids.length > max && <span className="text-[10px] text-text-muted ml-1">+{ids.length - max}</span>}
    </span>
  )
}
