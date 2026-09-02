import React, { useState, useEffect } from 'react'
import { getLeaderboard } from '../../lib/api'
import { marketingAccess } from '../../config/marketingAccess'

// Tile icons (Heroicons outline, inline SVG)
function BarChartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

// Mirrors the desktop Analytics tile's pie-segment mark, so the two surfaces
// are recognisably the same tool rather than two things that both do reports.
function AnalyticsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function ClipboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  )
}

function PodiumIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 21V13.5h5.25V21M9.75 21V8.25h4.5V21M15 21V11.25h5.25V21" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.5l1-2 1 2 2 .5-1.5 1.5.5 2-2-1-2 1 .5-2L9.5 6z" />
    </svg>
  )
}

function NotesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function HRIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
    </svg>
  )
}

function TicketIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  )
}

function MegaphoneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  )
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export default function HomeScreen({ user, navigate, onLogout }) {
  const staff = user?.staff || {}
  const displayName = staff.display_name || staff.first_name || staff.email || 'Staff'
  const role = staff.role || ''
  const visibleTools = user?.visible_tools || []
  const email = staff.email || ''
  const locations = staff.locations || []
  const primaryLocation = locations.find(l => l.is_primary)?.name || locations[0]?.name || ''
  const locationSlug = (primaryLocation || 'Salem').toLowerCase()

  const [scoreData, setScoreData] = useState(null)
  const [scoreLoading, setScoreLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    getLeaderboard({ month, location_slug: locationSlug })
      .then(res => {
        if (!cancelled) {
          const rankings = res?.rankings || []
          const userRank = res?.user_rank || null
          const userEntry = userRank ? rankings.find(r => r.rank === userRank) : null
          setScoreData({
            rankings,
            userRank,
            userPoints: res?.user_points || 0,
            userEntry,
            total: rankings.length,
            totalStaff: res?.total_staff || rankings.length,
          })
          setScoreLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setScoreLoading(false)
      })

    return () => { cancelled = true }
  }, [locationSlug])

  const allTiles = [
    { label: 'Reports', icon: <BarChartIcon />, route: 'reports', desc: 'Performance dashboards' },
    { label: 'Analytics', icon: <AnalyticsIcon />, route: 'analytics', desc: 'Company reports' },
    { label: 'Calendar', icon: <CalendarIcon />, route: 'calendar', desc: 'Tours & Day Ones' },
    { label: 'Leaderboard', icon: <PodiumIcon />, route: 'leaderboard', desc: 'Top performers' },
    { label: 'Marketing', icon: <MegaphoneIcon />, route: 'marketing-tracker', desc: 'Campaign tracker' },
    { label: 'Inventory', icon: <BoxIcon />, route: 'inventory', desc: 'Scan & track stock' },
    { label: 'Tickets', icon: <TicketIcon />, route: 'ticketing', desc: 'Submit & track tickets' },
    { label: 'HR', icon: <HRIcon />, route: 'hr', desc: 'Resources & docs' },
  ]

  const ROLE_LEVELS = { team_member: 0, lead: 1, manager: 2, corporate: 3, admin: 4 }
  const roleIdx = ROLE_LEVELS[role] ?? 0
  const canMarketing = marketingAccess(user).tracker

  const tiles = allTiles.filter(tile => {
    // Reports tile is manager+ (leads get Inventory, Calendar, Tickets, Leaderboard)
    if (tile.label === 'Reports' && roleIdx < ROLE_LEVELS.manager) return false
    // Tickets (native module) — role/override-driven via the 'ticketing' key,
    // same as desktop, so the Roles grid governs it on both platforms.
    if (tile.label === 'Tickets' && !(visibleTools || []).includes('ticketing')) return false
    // HR tile only for manager+
    if (tile.label === 'HR' && roleIdx < ROLE_LEVELS.manager) return false
    // Analytics is corporate+, matching the desktop tile. Deliberately outside
    // the Roles grid, so it can never be granted below that tier.
    if (tile.label === 'Analytics' && roleIdx < ROLE_LEVELS.corporate) return false
    // Marketing Tracker: effective tracker capability (corporate/admin, add-on,
    // or a role grant of marketing:tracker).
    if (tile.label === 'Marketing' && !canMarketing) return false
    return true
  })

  return (
    <div className="px-4 pt-6">
      {/* User info — solid white bubble header */}
      <div className="mb-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-text-primary">
            Welcome, {displayName}
          </h1>
          <button
            onClick={onLogout}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-wcs-red hover:border-wcs-red transition-colors [&_svg]:w-4 [&_svg]:h-4"
          >
            <LogoutIcon />
            Log out
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {role && (
            <span className="text-sm text-text-secondary capitalize">{role}</span>
          )}
          {role && email && <span className="text-text-muted">-</span>}
          {email && (
            <span className="text-sm text-text-muted">{email}</span>
          )}
        </div>
        {primaryLocation && (
          <span className="inline-block mt-2 px-3 py-1 bg-wcs-red/10 text-wcs-red text-sm font-medium rounded-full">
            {primaryLocation}
          </span>
        )}
      </div>

      {/* Score card — compact */}
      {!scoreLoading && scoreData && role !== 'admin' && role !== 'corporate' && (() => {
        const totalAtLocation = scoreData.totalStaff || scoreData.total
        const displayRank = scoreData.userRank || totalAtLocation || '—'
        return (
          <div className="bg-surface border border-border rounded-2xl px-4 py-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-wcs-red">{scoreData.userPoints || 0}</span>
                <span className="text-[11px] text-text-muted">pts</span>
              </div>
              <span className="text-xs font-bold text-text-primary">{ordinal(displayRank)} Place</span>
            </div>
            <div className="flex gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[10px]">
                <strong className="text-blue-700">{scoreData.userEntry?.memberships || 0}</strong>
                <span className="text-blue-600">Sales</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-[10px]">
                <strong className="text-green-700">{scoreData.userEntry?.day_ones || 0}</strong>
                <span className="text-green-600">D1</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-[10px]">
                <strong className="text-purple-700">{scoreData.userEntry?.same_day || 0}</strong>
                <span className="text-purple-600">SD</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px]">
                <strong className="text-amber-700">{scoreData.userEntry?.vips || 0}</strong>
                <span className="text-amber-600">VIP</span>
              </span>
            </div>
          </div>
        )
      })()}

      {/* Tile grid */}
      <div className="grid grid-cols-2 gap-4">
        {tiles.map(tile => (
          <button
            key={tile.route || tile.label}
            onClick={() => tile.url ? window.open(tile.url, '_blank') : navigate(tile.route)}
            className="bg-surface border border-border rounded-2xl p-6 flex flex-col items-center justify-center gap-3 active:scale-95 transition-transform"
          >
            <div className="w-14 h-14 rounded-full bg-bg flex items-center justify-center">
              {tile.icon}
            </div>
            <div className="text-center">
              <span className="block font-semibold text-text-primary text-sm">{tile.label}</span>
              {tile.desc && <span className="block text-[10px] text-text-muted uppercase tracking-wide mt-0.5">{tile.desc}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
