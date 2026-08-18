import { useEffect, useRef, useState } from 'react'

// Search field that sits above the home board in the Spotlight theme.
//
// Filtering is deliberately NOT done in React. The board is assembled from a
// dozen hand-written JSX branches (built-ins, custom tiles, role gates), so
// threading a query through every one of them would mean rewriting ToolGrid.
// Instead every tile carries data-tile-search (label + description, lowercased)
// and this component writes one generated stylesheet that hides the tiles that
// do not match, plus any .portal-section left with nothing in it. The DOM is
// the registry.
//
// Hidden-by-preference tiles are a separate concern and still match here on
// purpose: hiding reduces visual noise, it does not revoke access.

// Strip anything that could terminate the attribute selector or the rule.
function sanitize(q) {
  return q.replace(/["\\<>{}]/g, '').trim().toLowerCase()
}

function visibleTiles() {
  return Array.from(document.querySelectorAll('.portal-tile')).filter(
    el => el.offsetParent !== null,
  )
}

export default function PortalSearch() {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const styleRef = useRef(null)

  // One <style> element, owned by this component, rewritten on every keystroke.
  useEffect(() => {
    const el = document.createElement('style')
    el.setAttribute('data-portal-search', '')
    document.head.appendChild(el)
    styleRef.current = el
    return () => { el.remove(); styleRef.current = null }
  }, [])

  useEffect(() => {
    const el = styleRef.current
    if (!el) return
    const q = sanitize(query)
    el.textContent = q
      ? `.portal-tile:not([data-tile-search*="${q}"]) { display: none !important; }\n` +
        `.portal-section:not(:has(.portal-tile[data-tile-search*="${q}"])) { display: none !important; }`
      : ''
    // Keyboard focus follows the result list, so drop it when the list changes.
    document.querySelectorAll('.portal-tile.is-active').forEach(t => t.classList.remove('is-active'))
  }, [query])

  // Cmd K / Ctrl K focuses and selects the field from anywhere in the shell.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Arrow keys walk the visible results, enter launches, escape clears.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
    const tiles = visibleTiles()
    if (!tiles.length) return
    const current = tiles.findIndex(t => t.classList.contains('is-active'))
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(tiles[current] || tiles[0]).click()
      return
    }
    e.preventDefault()
    const next = e.key === 'ArrowDown'
      ? (current + 1) % tiles.length
      : (current <= 0 ? tiles.length - 1 : current - 1)
    tiles.forEach(t => t.classList.remove('is-active'))
    tiles[next].classList.add('is-active')
    tiles[next].scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="w-full mb-5">
      <div className="portal-search flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 transition-shadow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0 text-text-muted">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          autoComplete="off"
          spellCheck="false"
          placeholder="Search the portal"
          aria-label="Search the portal"
          className="flex-1 bg-transparent text-sm text-text-primary outline-none"
        />
        {query ? (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            className="text-xs font-semibold text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        ) : (
          <kbd className="hidden sm:inline text-[10px] font-semibold text-text-muted border border-border rounded px-1.5 py-0.5">
            Ctrl K
          </kbd>
        )}
      </div>
    </div>
  )
}
