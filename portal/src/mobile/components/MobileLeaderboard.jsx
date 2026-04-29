import React, { useState, useEffect } from 'react'
import { getLeaderboard } from '../../lib/api'
import MobileLoading from './MobileLoading'

const ROLES = ['team_member', 'lead', 'manager', 'corporate', 'admin']

const POINT_LEGEND = [
  { label: 'Day One', pts: 10 },
  { label: 'Membership', pts: 5 },
  { label: 'Same Day', pts: 5 },
  { label: 'VIP', pts: 2 },
]

function ChevronLeft() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}

function rankColor(rank) {
  if (rank === 1) return '#FFD700'
  if (rank === 2) return '#C0C0C0'
  if (rank === 3) return '#CD7F32'
  return undefined
}

function formatMonth(date) {
  return date.toLocaleString('default', { month: 'long', year: 'numeric' })
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

export default function MobileLeaderboard({ user }) {
  const staff = user?.staff || {}
  const role = staff.role || ''
  const userLocations = staff.locations || []
  const staffId = staff.id
  const isManager = ROLES.indexOf(role) >= ROLES.indexOf('manager')

  const defaultSlug = (userLocations.find(l => l.is_primary)?.name || userLocations[0]?.name || 'Salem').toLowerCase()
  const [selectedLocation, setSelectedLocation] = useState(defaultSlug)
  const locationSlug = selectedLocation

  const ALL_LOCATIONS = ['Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']

  const now = new Date()
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [view, setView] = useState('club') // 'club' | 'all'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const isCurrentMonth = isSameMonth(month, now)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = {
      month: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
    }
    if (view === 'club') {
      params.location_slug = locationSlug
    } else {
      params.location_slug = 'all'
    }

    getLeaderboard(params)
      .then(res => {
        if (!cancelled) {
          setData(res)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message || 'Failed to load leaderboard')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [month, view, locationSlug])

  function prevMonth() {
    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
  }

  function nextMonth() {
    if (!isCurrentMonth) {
      setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
    }
  }

  function goToThisMonth() {
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  const rankings = data?.rankings || []
  const locations = data?.locations || []

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 pb-3 pt-1">
        {/* Title + filters in white card */}
        <div className="mx-4 mt-4 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-2">
        <h1 className="text-lg font-semibold text-text-primary">Leaderboard</h1>

        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <button onClick={prevMonth} className="p-2 rounded-lg active:bg-bg transition-colors text-text-primary">
            <ChevronLeft />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{formatMonth(month)}</span>
            {!isCurrentMonth && (
              <button onClick={goToThisMonth} className="text-[11px] text-wcs-red font-medium px-2 py-0.5 rounded-full bg-wcs-red/10">
                This Month
              </button>
            )}
          </div>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className={`p-2 rounded-lg active:bg-bg transition-colors ${isCurrentMonth ? 'text-text-muted opacity-40' : 'text-text-primary'}`}
          >
            <ChevronRight />
          </button>
        </div>

        {/* Point legend */}
        <div className="flex justify-center gap-2">
          {POINT_LEGEND.map(p => (
            <div key={p.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg border border-border">
              <span className="text-sm font-bold text-wcs-red">{p.pts}</span>
              <span className="text-[10px] text-text-muted">{p.label}</span>
            </div>
          ))}
        </div>

        {/* View toggle for managers */}
        {isManager && (
          <div className="flex gap-2">
            <button
              onClick={() => setView('club')}
              className={`flex-1 text-sm font-medium py-1.5 rounded-full transition-colors ${view === 'club' ? 'bg-wcs-red text-white' : 'bg-bg text-text-secondary border border-border'}`}
            >
              My Club
            </button>
            <button
              onClick={() => setView('all')}
              className={`flex-1 text-sm font-medium py-1.5 rounded-full transition-colors ${view === 'all' ? 'bg-wcs-red text-white' : 'bg-bg text-text-secondary border border-border'}`}
            >
              All Locations
            </button>
          </div>
        )}

        {/* Location selector for managers on My Club tab */}
        {isManager && view === 'club' && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {ALL_LOCATIONS.map(loc => {
              const slug = loc.toLowerCase()
              return (
                <button
                  key={slug}
                  onClick={() => setSelectedLocation(slug)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
                    locationSlug === slug
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-bg text-text-muted border-border'
                  }`}
                >
                  {loc}
                </button>
              )
            })}
          </div>
        )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4">
        {loading && <MobileLoading variant="ranking" count={6} className="px-0 py-0" />}

        {error && !loading && (
          <div className="text-center py-16">
            <p className="text-text-muted text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && view === 'club' && rankings.length === 0 && (
          <div className="text-center py-16">
            <p className="text-text-muted text-sm">No activity yet this month</p>
          </div>
        )}

        {!loading && !error && view === 'all' && locations.length === 0 && rankings.length === 0 && (
          <div className="text-center py-16">
            <p className="text-text-muted text-sm">No activity yet this month</p>
          </div>
        )}

        {/* Club view */}
        {!loading && !error && view === 'club' && rankings.length > 0 && (
          <div className="space-y-3">
            {rankings.map((entry, idx) => {
              const rank = entry.rank || idx + 1
              const isCurrentUser = entry.rank === data?.user_rank
              const color = rankColor(rank)
              return (
                <div
                  key={entry.staff_id || idx}
                  className={`bg-surface border rounded-2xl p-3 flex items-center gap-3 ${isCurrentUser ? 'border-wcs-red' : 'border-border'}`}
                >
                  {/* Rank circle */}
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${color ? '' : 'bg-bg text-text-secondary'}`}
                    style={color ? { backgroundColor: color, color: '#fff' } : undefined}
                  >
                    {rank}
                  </div>

                  {/* Name + stats */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {entry.display_name || entry.name || 'Staff'}
                    </p>
                    <p className="text-[11px] text-text-muted truncate">
                      {[
                        entry.memberships && `${entry.memberships} sales`,
                        entry.day_ones && `${entry.day_ones} D1`,
                        entry.same_day && `${entry.same_day} SD`,
                        entry.vips && `${entry.vips} VIP`,
                      ].filter(Boolean).join(' \u00b7 ') || 'No stats'}
                    </p>
                  </div>

                  {/* Points */}
                  <div className="text-right flex-shrink-0">
                    <span className="text-lg font-bold text-wcs-red">{entry.points ?? 0}</span>
                    <p className="text-[10px] text-text-muted">pts</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Cross-location view */}
        {!loading && !error && view === 'all' && (locations.length > 0 ? locations : rankings).length > 0 && (
          <div className="space-y-3">
            {(locations.length > 0 ? locations : rankings).map((loc, idx) => {
              const rank = loc.rank || idx + 1
              const color = rankColor(rank)
              return (
                <div key={loc.location || loc.name || idx} className="bg-surface border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${color ? '' : 'bg-bg text-text-secondary'}`}
                      style={color ? { backgroundColor: color, color: '#fff' } : undefined}
                    >
                      {rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate capitalize">
                        {loc.location || loc.name || 'Location'}
                      </p>
                      {loc.top_performer && (
                        <p className="text-[11px] text-text-muted truncate">
                          Top: {loc.top_performer}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-lg font-bold text-wcs-red">{loc.total_points ?? loc.points ?? 0}</span>
                      <p className="text-[10px] text-text-muted">pts</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
