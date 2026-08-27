import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Multi-location selector used across all reports. Value is a single string:
//   - 'all'                  → every option selected (canonical)
//   - 'salem'                → one location
//   - 'salem,eugene'         → multiple, comma-separated in canonical option order
//
// Selections are STAGED inside the panel — checkbox toggles, Select all, and
// Clear modify a local pending set. The commit fires only when the user clicks
// "View Report" at the bottom of the panel. Closing the panel without applying
// reverts the pending set to the committed value.
//
// Props:
//   value     — current committed selection string
//   onChange  — called with the next selection string when "View Report" is clicked
//   options   — [{ slug, label }] in canonical display order. Do NOT include an
//               "all" entry; we handle that at the top of the panel.
//   className — optional extra classes on the trigger button
// Panel geometry, shared by the placement effect below.
const PANEL_WIDTH = 256      // was the w-64 utility class
const MARGIN = 8             // breathing room from any viewport edge
const GAP = 4                // between trigger and panel
const MIN_PANEL_HEIGHT = 180 // below this it is not worth opening downwards

export default function LocationMultiSelect({
  value, onChange, options, className = '',
  allLabel = 'All Locations', noneLabel = 'No Locations', nounPlural = 'locations', applyLabel = 'View Report',
}) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)
  const [coords, setCoords] = useState(null)

  const allSlugs = useMemo(() => options.map(o => o.slug), [options])
  const labelBySlug = useMemo(() => {
    const m = new Map()
    for (const o of options) m.set(o.slug, o.label)
    return m
  }, [options])

  const committedSet = useMemo(() => {
    if (!value || value === 'all') return new Set(allSlugs)
    const want = new Set(String(value).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    // Filter against allowed options to avoid stale slugs lingering.
    return new Set(allSlugs.filter(s => want.has(s)))
  }, [value, allSlugs])

  const [pendingSet, setPendingSet] = useState(committedSet)

  // When the panel opens, sync pending ← committed so staging always starts
  // from the current applied selection.
  useEffect(() => {
    if (open) setPendingSet(new Set(committedSet))
  }, [open, committedSet])

  // Also sync if committed changes while the panel is closed (e.g. parent reset).
  useEffect(() => {
    if (!open) setPendingSet(new Set(committedSet))
  }, [committedSet, open])

  // KEEP THE PANEL ON SCREEN.
  //
  // It used to be `absolute left-0`, which puts its left edge under the
  // trigger and runs 256px to the right. Wherever the trigger sits near the
  // right edge — which is exactly where the Analytics toolbar puts it — the
  // panel rendered off screen and the options could not be reached.
  //
  // Positioned FIXED from the trigger's viewport rect rather than flipped to
  // `right-0`: flipping only solves the right edge, and an absolutely
  // positioned panel is still clipped by any scrolling ancestor. Fixed escapes
  // the ancestor entirely, and clamping handles both edges plus the narrow
  // case where the panel is wider than the viewport.
  //
  // AND IT IS PORTALLED TO document.body. `position: fixed` is only relative to
  // the viewport while no ancestor has a transform, filter or containment — any
  // one of those silently re-anchors it to that ancestor, and viewport
  // coordinates then land the panel somewhere off screen. The first cut was not
  // portalled and the picker opened into nowhere: clicking it appeared to do
  // nothing at all. Rendering into body removes the entire class of failure
  // rather than chasing whichever ancestor currently has a transform.
  useEffect(() => {
    if (!open) return

    function place() {
      const btn = buttonRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.min(PANEL_WIDTH, vw - MARGIN * 2)
      // Prefer aligned to the trigger's left edge, then clamp inside the viewport.
      const left = Math.max(MARGIN, Math.min(r.left, vw - width - MARGIN))
      // Flip above when there is not room below but there is above, so a
      // trigger low on the page does not open into a sliver.
      const below = vh - r.bottom - MARGIN
      const above = r.top - MARGIN
      const openUp = below < MIN_PANEL_HEIGHT && above > below
      setCoords({
        left,
        width,
        top: openUp ? undefined : r.bottom + GAP,
        bottom: openUp ? vh - r.top + GAP : undefined,
        maxHeight: Math.max(MIN_PANEL_HEIGHT, (openUp ? above : below) - GAP),
      })
    }

    place()
    // Capture phase so a scroll inside any ancestor repositions it, not just
    // the window.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const allSelected = committedSet.size === allSlugs.length
  const triggerText = useMemo(() => {
    if (allSelected) return allLabel
    if (committedSet.size === 0) return noneLabel
    if (committedSet.size === 1) {
      const slug = [...committedSet][0]
      return labelBySlug.get(slug) || slug
    }
    const ordered = allSlugs.filter(s => committedSet.has(s)).map(s => labelBySlug.get(s) || s)
    return `${committedSet.size} ${nounPlural}: ${ordered.join(', ')}`
  }, [allSelected, committedSet, allSlugs, labelBySlug, allLabel, noneLabel, nounPlural])

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

  function toggle(slug) {
    setPendingSet(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function selectAll() {
    setPendingSet(new Set(allSlugs))
  }

  function clearAll() {
    setPendingSet(new Set())
  }

  function applyAndClose() {
    if (pendingSet.size === 0) return
    if (pendingSet.size === allSlugs.length) onChange('all')
    else onChange(allSlugs.filter(s => pendingSet.has(s)).join(','))
    setOpen(false)
  }

  const pendingCount = pendingSet.size
  const canApply = pendingCount > 0

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

      {open && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-multiselectable="true"
          style={coords ? {
            position: 'fixed',
            left: coords.left,
            top: coords.top,
            bottom: coords.bottom,
            width: coords.width,
            maxHeight: coords.maxHeight,
          } : undefined}
          // Hidden until measured, so it never paints once at the wrong place
          // and jumps. z-50 clears the Analytics header card, which is z-50
          // itself and would otherwise cover a fixed panel.
          className={
            'z-50 overflow-y-auto bg-surface border border-border rounded-xl shadow-lg p-2 ' +
            (coords ? '' : 'invisible ') +
            'fixed'
          }
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
              const checked = pendingSet.has(opt.slug)
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
          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-muted">
              {pendingCount === 0 ? `No ${nounPlural} selected` : `${pendingCount} selected`}
            </span>
            <button
              type="button"
              onClick={applyAndClose}
              disabled={!canApply}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                canApply
                  ? 'bg-wcs-red text-white hover:bg-wcs-red/90'
                  : 'bg-bg text-text-muted cursor-not-allowed border border-border'
              }`}
            >
              {applyLabel}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
