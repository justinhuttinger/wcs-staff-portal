import { useEffect, useMemo, useRef, useState } from 'react'

// Multi-location selector used across all reports. Value is a single string:
//   - 'all'                  → every option selected (canonical)
//   - 'salem'                → one location
//   - 'salem,eugene'         → multiple, comma-separated in canonical option order
//
// Props:
//   value     — current selection string
//   onChange  — called with the next selection string
//   options   — [{ slug, label }] in canonical display order. Do NOT include an
//               "all" entry; we handle that at the top of the panel.
//   className — optional extra classes on the trigger button
export default function LocationMultiSelect({ value, onChange, options, className = '' }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)

  const allSlugs = useMemo(() => options.map(o => o.slug), [options])
  const labelBySlug = useMemo(() => {
    const m = new Map()
    for (const o of options) m.set(o.slug, o.label)
    return m
  }, [options])

  const selectedSet = useMemo(() => {
    if (!value || value === 'all') return new Set(allSlugs)
    const want = new Set(String(value).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    // Filter against allowed options to avoid stale slugs lingering.
    return new Set(allSlugs.filter(s => want.has(s)))
  }, [value, allSlugs])

  const allSelected = selectedSet.size === allSlugs.length
  const triggerText = useMemo(() => {
    if (allSelected) return 'All Locations'
    if (selectedSet.size === 0) return 'No Locations'
    if (selectedSet.size === 1) {
      const slug = [...selectedSet][0]
      return labelBySlug.get(slug) || slug
    }
    const ordered = allSlugs.filter(s => selectedSet.has(s)).map(s => labelBySlug.get(s) || s)
    return `${selectedSet.size} locations: ${ordered.join(', ')}`
  }, [allSelected, selectedSet, allSlugs, labelBySlug])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  function emit(nextSet) {
    if (nextSet.size === 0 || nextSet.size === allSlugs.length) {
      onChange('all')
      return
    }
    const ordered = allSlugs.filter(s => nextSet.has(s))
    onChange(ordered.join(','))
  }

  function toggle(slug) {
    const next = new Set(selectedSet)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    emit(next)
  }

  function selectAll() {
    onChange('all')
  }

  function clearAll() {
    // No "zero locations" — Clear All resets to All Locations.
    onChange('all')
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ' +
          'bg-bg text-text-primary border-border hover:border-text-muted transition-colors ' +
          'max-w-full ' + className
        }
        title={triggerText}
      >
        <span className="truncate max-w-[240px] sm:max-w-[360px] text-left">{triggerText}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 flex-shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25 12 15.75 4.5 8.25" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-9 z-30 w-64 bg-surface border border-border rounded-xl shadow-lg p-2"
        >
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-border">
            <button
              type="button"
              onClick={selectAll}
              className="text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold"
            >
              Clear
            </button>
          </div>
          <ul className="max-h-72 overflow-auto">
            {options.map(opt => {
              const checked = selectedSet.has(opt.slug)
              return (
                <li key={opt.slug}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-bg">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt.slug)}
                      className="accent-wcs-red"
                    />
                    <span className="text-sm text-text-primary">{opt.label}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
