import { useState, useEffect, useRef } from 'react'
import ActionPopup from './ActionPopup'
import { getAppSettings } from '../lib/api'

// "Quick Actions" for the Press nav — Book Gym Tour, Book Day Ones, Submit VIPs.
//
// These already existed on the classic board, in the banner strip above the
// tiles. Press gives each column its own tab and drops that strip, which took
// the actions with it; this puts them back somewhere that is on screen no
// matter which tab you are on, which is better than where they were.
//
// The URLs are per-club app settings, so a club that has not been configured
// simply has fewer entries — and if none are set the whole control hides rather
// than opening an empty menu.
//
// Who sees it is the caller's decision (App mirrors the board's rule: below
// corporate). Directors and admins never had these buttons.

const ICONS = {
  tour: 'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z',
  dayone: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  vip: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z',
}

export default function QuickActions({ location }) {
  const [urls, setUrls] = useState({ tour: null, dayone: null, vip: null })
  const [open, setOpen] = useState(false)
  const [popup, setPopup] = useState(null) // { title, url }
  const wrapRef = useRef(null)

  // Same three app settings the board reads, keyed by club slug.
  useEffect(() => {
    const slug = (location || 'salem').toLowerCase()
    let live = true
    const pull = (key) => getAppSettings(key).then(s => s[key] || null).catch(() => null)
    Promise.all([
      pull('tour_url_' + slug),
      pull('dayone_url_' + slug),
      pull('vip_url_' + slug),
    ]).then(([tour, dayone, vip]) => {
      if (live) setUrls({ tour, dayone, vip })
    })
    return () => { live = false }
  }, [location])

  // Click-away and Escape, the way every other menu in the portal closes.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Milwaukie does not run the VIP survey, matching the board.
  const isMilwaukie = (location || '').toLowerCase() === 'milwaukie'
  const items = [
    { key: 'tour', label: 'Book Gym Tour', url: urls.tour },
    { key: 'dayone', label: 'Book Day Ones', url: urls.dayone },
    { key: 'vip', label: 'Submit VIPs', url: isMilwaukie ? null : urls.vip },
  ].filter(i => i.url)

  // Nothing configured for this club — no empty menu.
  if (items.length === 0) return null

  return (
    <div className="press-quick" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`press-quick__btn${open ? ' is-open' : ''}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
        Quick Actions
        <span className={`press-quick__caret${open ? ' is-open' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="press-quick__menu" role="menu">
          {items.map(i => (
            <button
              key={i.key}
              type="button"
              role="menuitem"
              onClick={() => { setPopup({ title: i.label, url: i.url }); setOpen(false) }}
              className="press-quick__item"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {ICONS[i.key].trim().split(' M').map((d, n) => (
                  <path key={n} strokeLinecap="round" strokeLinejoin="round" d={n === 0 ? d : 'M' + d} />
                ))}
              </svg>
              {i.label}
            </button>
          ))}
        </div>
      )}

      {popup && (
        <ActionPopup title={popup.title} url={popup.url} onClose={() => setPopup(null)} />
      )}
    </div>
  )
}
