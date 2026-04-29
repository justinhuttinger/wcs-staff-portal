import React, { useState, useEffect } from 'react'
import { getLeaderboard } from '../../lib/api'

// Tile icons (Heroicons outline, inline SVG)
function BarChartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
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

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
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
    { label: 'Calendar', icon: <CalendarIcon />, route: 'calendar', desc: 'Tours & Day Ones' },
    { label: 'Leaderboard', icon: <PodiumIcon />, route: 'leaderboard', desc: 'Top performers' },
    { label: 'Comm Notes', icon: <NotesIcon />, route: 'comm-notes', desc: 'Member & team notes' },
    { label: 'HR', icon: <HRIcon />, route: 'hr', desc: 'Resources & docs' },
  ]

  const ROLE_LEVELS = { team_member: 0, lead: 1, manager: 2, corporate: 3, admin: 4 }
  const roleIdx = ROLE_LEVELS[role] ?? 0

  const tiles = allTiles.filter(tile => {
    // Hide Reports tile for team_member
    if (tile.label === 'Reports' && role === 'team_member') return false
    // HR tile only for manager+
    if (tile.label === 'HR' && roleIdx < ROLE_LEVELS.manager) return false
    return true
  })

  return (
    <div className="px-4 pt-6">
      {/* User info — solid white bubble header */}
      <div className="mb-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
        <h1 className="text-2xl font-bold text-text-primary">
          Welcome, {displayName}
        </h1>
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

      {/* Logout */}
      <button
        onClick={onLogout}
        className="mt-10 mx-auto flex items-center gap-2 text-text-muted text-sm hover:text-text-secondary transition-colors"
      >
        <LogoutIcon />
        Sign out
      </button>
    </div>
  )
}
