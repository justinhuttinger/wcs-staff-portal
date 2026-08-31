import UserMenu from './UserMenu'

// Persistent top nav for the Press theme.
//
// This is the one thing the appearance system cannot do with tokens alone: it
// replaces the shell. App.jsx renders this instead of the classic <header> when
// data-theme is 'press', and every view continues to render underneath it, so
// the bar is present no matter what the user is looking at.
//
// Tabs map onto view state App.jsx already owns — there is no router here. The
// parent hands us `active` (a tab key) and `onSelect`; switching tabs is just
// the same setShow* calls the old tiles made.
//
// To the right of the fixed tabs sit the user's own pinned shortcuts and the
// "+" that manages them. A pinned App opens in a new tab (a real <a>, so the
// Electron launcher opens it as a launcher tab and the vault can still
// auto-fill); a pinned Tool opens in place like Reporting or Calendar. A pin
// may carry a `badge` number, which draws as a red count on the tab — Tickets
// uses it for the open tickets waiting on the person looking at the bar.
//
// Reporting is gated on role. team_member never sees it, matching the tile's
// own rule in ToolGrid. Finer per-role Tool Visibility is still enforced by the
// auth API (requireReportAccess), so a role that reaches the tab without a
// grant gets an empty report, not another club's data.

const ICONS = {
  apps: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  reporting: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  leaderboard: 'M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-4.5A3.375 3.375 0 0 0 13.125 10.875h-2.25A3.375 3.375 0 0 0 7.5 14.25v4.5m6-15V3.375c0-.621-.504-1.125-1.125-1.125h-.75a1.125 1.125 0 0 0-1.125 1.125V3.75m3 0h-3',
  pinApp: 'M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-7.5 3 9.75-9.75m0 0h-4.5m4.5 0v4.5',
  tools: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z',
}

// The default bar, in display order. Making these user-configurable is the
// next step and deliberately not built yet.
const TABS = [
  { key: 'apps', label: 'Apps' },
  { key: 'reporting', label: 'Reporting' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'tools', label: 'Tools' },
]

export default function PortalNav({
  active,
  onSelect,
  onBack,
  pins,
  onOpenPicker,
  onAdmin,
  onSignOut,
  onProfile,
  userName,
  location,
  isAdmin,
  userRole,
  rightSlot,
  quickActions,
  points,
}) {
  const tabs = TABS.filter(t => {
    if (t.key === 'reporting') return userRole !== 'team_member'
    return true
  })

  return (
    <nav className="press-nav">
      <div className="press-nav__brand">
        <img src="/wcs-logo.png" alt="WCS" />
        <span className="press-nav__wordmark">Portal</span>
      </div>

      <div className="press-nav__tabs">
        {/* The five tabs are self-navigating, so they carry no back button. A
            view opened from the Other board has no tab of its own, and most of
            those views never drew their own back control — they leaned on the
            classic header this nav replaces. Without this they are a dead end. */}
        {active === null && onBack && (
          <button type="button" onClick={onBack} className="press-tab press-tab--back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-current={active === t.key ? 'page' : undefined}
            className={`press-tab${active === t.key ? ' is-active' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[t.key]} />
            </svg>
            {t.label}
          </button>
        ))}

        {/* Pinned shortcuts. Apps are anchors so the browser (and the Electron
            launcher) handle them as real new-tab navigations; Tools are
            buttons that switch the view in place. */}
        {(pins || []).map(p => (p.kind === 'app' ? (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            title={p.desc || p.label}
            className="press-tab press-tab--pin"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.pinApp} />
            </svg>
            {p.label}
          </a>
        ) : (
          <button
            key={p.key}
            type="button"
            onClick={() => p.open && p.open()}
            title={p.badge ? `${p.label} — ${p.badge} open` : (p.desc || p.label)}
            aria-current={active === p.key ? 'page' : undefined}
            className={`press-tab press-tab--pin${active === p.key ? ' is-active' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[p.icon] || ICONS.tools} />
            </svg>
            {p.label}
            {/* A count of what is waiting on you (Tickets today). The parent
                only sets it when there is something to say, so there is no
                zero state to design around. */}
            {p.badge ? (
              <span className="press-tab__badge" aria-label={`${p.badge} open`}>
                {p.badge > 99 ? '99+' : p.badge}
              </span>
            ) : null}
          </button>
        )))}

        {quickActions}

        {onOpenPicker && (
          <button
            type="button"
            onClick={onOpenPicker}
            className="press-tab press-tab--add"
            aria-label="Pin a shortcut"
            title="Pin a shortcut"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        )}
      </div>

      <div className="press-nav__right">
        {points}
        {rightSlot}
        {location && <span className="press-nav__loc">{location}</span>}
        {isAdmin && (
          <button type="button" onClick={onAdmin} className="press-nav__btn">
            Admin
          </button>
        )}
        <UserMenu name={userName} variant="press" onProfile={onProfile} onSignOut={onSignOut} />
      </div>
    </nav>
  )
}
