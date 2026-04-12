import { useState, useEffect } from 'react'
import { getLeaderboard } from '../lib/api'

const ROLES_ORDERED = ['team_member', 'lead', 'manager', 'corporate', 'admin']

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function isCurrentMonth(date) {
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32']

export default function LeaderboardView({ user, onBack, location }) {
  const [monthDate, setMonthDate] = useState(new Date())
  const [tab, setTab] = useState('club') // 'club' | 'all'
  const [data, setData] = useState(null)
  const [crossData, setCrossData] = useState(null)
  const [loading, setLoading] = useState(true)

  const role = user?.staff?.role || 'team_member'
  const isManager = ROLES_ORDERED.indexOf(role) >= ROLES_ORDERED.indexOf('manager')

  const userLocations = user?.staff?.locations || []
  const defaultSlug = (location || 'salem').toLowerCase()
  const [selectedLocation, setSelectedLocation] = useState(defaultSlug)
  const locationSlug = selectedLocation
  const monthKey = getMonthKey(monthDate)

  useEffect(() => {
    setLoading(true)
    getLeaderboard({ location_slug: locationSlug, month: monthKey })
      .then(res => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [locationSlug, monthKey])

  useEffect(() => {
    if (isManager && tab === 'all') {
      getLeaderboard({ month: monthKey, location_slug: 'all' })
        .then(res => setCrossData(res))
        .catch(() => setCrossData(null))
    }
  }, [isManager, tab, monthKey])

  function prevMonth() {
    setMonthDate(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() - 1)
      return d
    })
  }

  function nextMonth() {
    if (isCurrentMonth(monthDate)) return
    setMonthDate(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + 1)
      const now = new Date()
      if (d > now) return now
      return d
    })
  }

  function goToCurrentMonth() {
    setMonthDate(new Date())
  }

  const rankings = data?.rankings || []
  const crossLocations = crossData?.locations || []

  // All 7 locations for admin/director location picker
  const ALL_LOCATIONS = ['Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']

  return (
    <div className="w-full max-w-4xl mx-auto px-8 pb-12">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors mb-4 mt-2"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Portal
      </button>

      {/* Header */}
      <h2 className="text-xl font-black text-text-primary mb-4">Leaderboard</h2>

      {/* Month navigation */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-bold text-text-primary min-w-[160px] text-center">{formatMonth(monthDate)}</span>
        <button
          onClick={nextMonth}
          disabled={isCurrentMonth(monthDate)}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {!isCurrentMonth(monthDate) && (
          <button onClick={goToCurrentMonth} className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-surface text-wcs-red hover:bg-wcs-red/5 transition-colors">
            This Month
          </button>
        )}
      </div>

      {/* Point legend */}
      <div className="flex items-center gap-4 text-xs text-text-muted mb-6 px-1">
        <span>Day One Booked <strong className="text-text-primary">10</strong></span>
        <span>Membership <strong className="text-text-primary">5</strong></span>
        <span>Same Day Sale <strong className="text-text-primary">5</strong></span>
        <span>VIP <strong className="text-text-primary">2</strong></span>
      </div>

      {/* Manager tabs */}
      {isManager && (
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab('club')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${tab === 'club' ? 'border-wcs-red bg-wcs-red/10 text-wcs-red' : 'border-border bg-surface text-text-muted hover:text-text-primary'}`}
          >
            My Club
          </button>
          <button
            onClick={() => setTab('all')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${tab === 'all' ? 'border-wcs-red bg-wcs-red/10 text-wcs-red' : 'border-border bg-surface text-text-muted hover:text-text-primary'}`}
          >
            All Locations
          </button>
        </div>
      )}

      {/* Location selector for admins on My Club tab */}
      {isManager && tab === 'club' && (
        <div className="flex flex-wrap gap-2 mb-4">
          {ALL_LOCATIONS.map(loc => {
            const slug = loc.toLowerCase()
            return (
              <button
                key={slug}
                onClick={() => setSelectedLocation(slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  locationSlug === slug
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {loc}
              </button>
            )
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin" />
        </div>
      ) : tab === 'club' ? (
        /* Club leaderboard table */
        rankings.length === 0 ? (
          <div className="rounded-[14px] bg-surface border border-border p-12 text-center">
            <p className="text-text-muted text-sm">No activity yet this month</p>
          </div>
        ) : (
          <div className="rounded-[14px] bg-surface border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide w-12">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">Points</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">Sales</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">Day Ones</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">Same Day</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">VIPs</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((entry) => {
                  const rankIdx = (entry.rank || 1) - 1
                  const isTop3 = rankIdx < 3
                  const isMe = entry.rank === data?.user_rank
                  return (
                    <tr key={entry.name} className={`border-b border-border last:border-b-0 ${isMe ? 'bg-wcs-red/5' : ''}`}>
                      <td className="px-4 py-3">
                        {isTop3 ? (
                          <span
                            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: RANK_COLORS[rankIdx] }}
                          >
                            {entry.rank}
                          </span>
                        ) : (
                          <span className="text-text-muted font-medium">{entry.rank}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-text-primary">
                        {entry.name}
                        {isMe && <span className="ml-2 text-xs text-wcs-red font-bold">(You)</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-text-primary">{entry.points || 0}</td>
                      <td className="px-4 py-3 text-right text-text-muted">{entry.memberships || 0}</td>
                      <td className="px-4 py-3 text-right text-text-muted">{entry.day_ones || 0}</td>
                      <td className="px-4 py-3 text-right text-text-muted">{entry.same_day || 0}</td>
                      <td className="px-4 py-3 text-right text-text-muted">{entry.vips || 0}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* Cross-location table */
        crossLocations.length === 0 ? (
          <div className="rounded-[14px] bg-surface border border-border p-12 text-center">
            <p className="text-text-muted text-sm">No activity yet this month</p>
          </div>
        ) : (
          <div className="rounded-[14px] bg-surface border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide w-12">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Location</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">Total Points</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Top Performer</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide text-right">Staff</th>
                </tr>
              </thead>
              <tbody>
                {crossLocations.map((loc, i) => {
                  const rankIdx = i
                  const isTop3 = rankIdx < 3
                  return (
                    <tr key={loc.location || i} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3">
                        {isTop3 ? (
                          <span
                            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: RANK_COLORS[rankIdx] }}
                          >
                            {i + 1}
                          </span>
                        ) : (
                          <span className="text-text-muted font-medium">{i + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-text-primary">{loc.location}</td>
                      <td className="px-4 py-3 text-right font-bold text-text-primary">{loc.total_points || 0}</td>
                      <td className="px-4 py-3 text-text-muted">{loc.top_performer || '-'}</td>
                      <td className="px-4 py-3 text-right text-text-muted">{loc.staff_count || 0}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
