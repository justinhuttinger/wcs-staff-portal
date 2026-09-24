import { useMemo, useRef, useState } from 'react'
import { filterInstructors } from '../../lib/instructorSearch'

const label = i => `${i.display_name} (${i.department})`

// Searchable instructor picker for the create and edit class modals. Replaces
// a plain <select> that meant scrolling the whole ABC staff list. Keeps the
// server's order (Group Exercise first, then alphabetical).
export default function InstructorPicker({ instructors, value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const selected = instructors.find(i => i.employee_id === value) || null
  const matches = useMemo(() => filterInstructors(instructors, q), [instructors, q])

  function pick(i) {
    onChange(i.employee_id)
    setQ('')
    setOpen(false)
  }

  function move(delta) {
    if (!open) { setOpen(true); return }
    const next = Math.max(0, Math.min(matches.length - 1, active + delta))
    setActive(next)
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter' && open) {
      // Enter picks, it must not submit the class form underneath.
      e.preventDefault()
      if (matches[active]) pick(matches[active])
    } else if (e.key === 'Escape' && open) {
      // Close the list, not the modal.
      e.stopPropagation()
      setOpen(false)
      setQ('')
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? q : (selected ? label(selected) : '')}
        placeholder={open && selected ? label(selected) : 'Search instructors'}
        onFocus={() => { setOpen(true); setActive(0) }}
        // Delay so a click on an option lands before the list unmounts.
        onBlur={() => setTimeout(() => { setOpen(false); setQ('') }, 150)}
        onChange={e => { setQ(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown}
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary"
      />
      {open && (
        <div ref={listRef} role="listbox"
          className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {matches.length === 0 && <p className="px-3 py-2 text-xs text-text-muted">No instructors match "{q}"</p>}
          {matches.map((i, idx) => (
            <button key={i.employee_id} type="button" role="option"
              aria-selected={i.employee_id === value}
              onMouseDown={e => { e.preventDefault(); pick(i) }}
              onMouseEnter={() => setActive(idx)}
              className={`block w-full text-left px-3 py-2 text-sm ${idx === active ? 'bg-bg' : ''}`}>
              <span className={`text-text-primary ${i.employee_id === value ? 'font-semibold' : 'font-medium'}`}>{i.display_name}</span>
              <span className="text-xs text-text-muted ml-2">{i.department}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
