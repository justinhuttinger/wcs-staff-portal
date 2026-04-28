import { useState, useEffect } from 'react'
import allTools from '../config/tools.json'
import ToolButton from './ToolButton'
import { getTiles, getDayOneTrackerAppointments, getTours, getLeaderboard, getCommunicationNotes, getAppSettings } from '../lib/api'

const TILE_ICONS = {
  dayOne: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
  tours: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  reporting: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  marketing: 'M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6',
  tickets: 'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z',
  availability: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  dayOneCalendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z',
  leaderboard: 'M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-4.5A3.375 3.375 0 0 0 13.125 10.875h-2.25A3.375 3.375 0 0 0 7.5 14.25v4.5m6-15V3.375c0-.621-.504-1.125-1.125-1.125h-.75a1.125 1.125 0 0 0-1.125 1.125V3.75m3 0h-3',
  commNotes: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.399-.49c1.583-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
  hr: 'M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z',
  helpCenter: 'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z',
  notifications: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
}

// Which built-in tool IDs are "Apps" (external services)
const APP_IDS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive']

// Role hierarchy levels for visibility checks
const ROLE_LEVELS = { team_member: 0, lead: 1, manager: 2, corporate: 3, admin: 4 }

function SvgTileButton({ onClick, iconPath, label, desc, badge, star }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
    >
      {star && (
        <svg viewBox="0 0 24 24" fill="currentColor" className="absolute top-2.5 left-2.5 w-3.5 h-3.5 text-amber-400">
          <path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" />
        </svg>
      )}
      {badge > 0 && (
        <span className="absolute top-3 right-3 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-wcs-red text-white text-xs font-bold px-1.5">
          {badge}
        </span>
      )}
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <div className="text-center">
        <span className="block text-base font-semibold text-text-primary">{label}</span>
        <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{desc}</span>
      </div>
    </button>
  )
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const MOTIVATIONAL_MESSAGES = [
  "Every membership changes a life!",
  "You're building something great!",
  "Consistency wins the race!",
  "Your energy is contagious!",
  "Champions are made daily!",
  "Keep pushing — results follow!",
  "Be the reason someone smiles today!",
  "Small wins add up to big results!",
  "You've got this!",
  "Make today count!",
  "Progress, not perfection!",
  "Lead by example!",
  "Your effort matters!",
  "Stay hungry, stay humble!",
  "One more rep, one more sale!",
]

function getMotivationalMessage() {
  // Rotate every 10 minutes based on timestamp
  const slot = Math.floor(Date.now() / (10 * 60 * 1000))
  return MOTIVATIONAL_MESSAGES[slot % MOTIVATIONAL_MESSAGES.length]
}

export default function ToolGrid({ abcUrl, location, visibleTools, locationId, onCalendar, onTrainerAvail, onMetaAds, onLeaderboard, onHR, onHelpCenter, onTickets, onDrive, onCommunicationNotes, onReporting, userRole, userName }) {
  const [customTiles, setCustomTiles] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [tilesLoaded, setTilesLoaded] = useState(false)
  const [calendarBadge, setCalendarBadge] = useState(0)
  const [commNotesBadge, setCommNotesBadge] = useState(0)
  const [leaderboardData, setLeaderboardData] = useState(null)
  const [showPointsInfo, setShowPointsInfo] = useState(false)
  const [motivationalMsg, setMotivationalMsg] = useState(getMotivationalMessage())
  const [tourUrl, setTourUrl] = useState(null)
  const [dayoneUrl, setDayoneUrl] = useState(null)
  const [vipUrl, setVipUrl] = useState(null)

  useEffect(() => {
    if (locationId) {
      getTiles(locationId).then(res => {
        setCustomTiles(res.tiles || [])
      }).catch(() => {}).finally(() => setTilesLoaded(true))
    } else {
      setTilesLoaded(true)
    }

    // Fetch badge counts for combined calendar tile
    const slug = (location || 'salem').toLowerCase()
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    Promise.all([
      getDayOneTrackerAppointments({ location_slug: slug }).catch(() => ({ appointments: [] })),
      locationId ? getTours({ location_id: locationId, start_date: todayStr, end_date: todayStr }).catch(() => ({ tours: [] })) : Promise.resolve({ tours: [] }),
    ]).then(([dayOneRes, toursRes]) => {
      const apts = dayOneRes.appointments || []
      const todayKey = todayStr
      const todayDayOnes = apts.filter(a => {
        if (!a.appointment_time) return false
        const d = new Date(a.appointment_time)
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        return k === todayKey
      }).length
      const todayTours = (toursRes.tours || []).length
      setCalendarBadge(todayDayOnes + todayTours)
    })

    // Fetch unresolved comm notes count
    getCommunicationNotes({ status: 'unresolved' }).then(res => {
      setCommNotesBadge((res.notes || []).length)
    }).catch(() => {})

    // Fetch action link URLs for this location
    getAppSettings('tour_url_' + slug).then(settings => {
      setTourUrl(settings['tour_url_' + slug] || null)
    }).catch(() => {})
    getAppSettings('dayone_url_' + slug).then(settings => {
      setDayoneUrl(settings['dayone_url_' + slug] || null)
    }).catch(() => {})
    getAppSettings('vip_url_' + slug).then(settings => {
      setVipUrl(settings['vip_url_' + slug] || null)
    }).catch(() => {})
  }, [locationId, location])

  useEffect(() => {
    const locationSlug = (location || 'salem').toLowerCase()
    getLeaderboard({ location_slug: locationSlug }).then(res => {
      setLeaderboardData(res)
    }).catch(() => {})
  }, [location])

  useEffect(() => {
    const interval = setInterval(() => {
      setMotivationalMsg(getMotivationalMessage())
    }, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const tools = visibleTools && visibleTools.length > 0
    ? allTools.filter(t => visibleTools.includes(t.id))
    : allTools

  const getUrl = (tool) => {
    if (tool.id === 'abc') {
      const params = new URLSearchParams()
      if (abcUrl) params.set('abc_url', abcUrl)
      if (location) params.set('location', location)
      const qs = params.toString()
      return '/kiosk.html' + (qs ? '?' + qs : '')
    }
    return tool.url
  }

  const visibleCustomTiles = customTiles.filter(t => {
    if (!visibleTools || visibleTools.length === 0) return true
    const tileKey = 'tile:' + t.id
    if (visibleTools.includes(tileKey)) return true
    const hasTileKeys = visibleTools.some(k => k.startsWith('tile:'))
    if (!hasTileKeys) return true
    return false
  })

  const mainTiles = visibleCustomTiles.filter(t => !t.parent_id && t.section === 'main')
  const topLevelTiles = visibleCustomTiles.filter(t => !t.parent_id && t.section !== 'main')
  const childTiles = activeGroup ? visibleCustomTiles.filter(t => t.parent_id === activeGroup.id) : []

  if (activeGroup) {
    return (
      <div className="w-full max-w-4xl mx-auto px-8">
        <button
          onClick={() => setActiveGroup(null)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors mb-4 mt-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-lg font-bold text-text-primary mb-4">{activeGroup.label}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          {childTiles.map((tile) => (
            <ToolButton key={'custom-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
          ))}
          {childTiles.length === 0 && (
            <p className="col-span-4 text-center text-text-muted text-sm py-8">No items in this category yet</p>
          )}
        </div>
      </div>
    )
  }

  if (!tilesLoaded) return null

  // Labels that should be in Apps even if their section isn't "main"
  const APP_LABELS = ['indeed', 'operandio', 'vistaprint', 'vista']
  // Labels that should be in Tools even if their section is "main"
  const TOOL_LABELS = ['cancel', 'cancel tool']

  const appTools = tools.filter(t => APP_IDS.includes(t.id))

  // All custom tiles, categorized
  const allCustom = [...mainTiles, ...topLevelTiles]
  const appCustomTiles = allCustom.filter(t => {
    const label = (t.label || '').toLowerCase()
    if (TOOL_LABELS.includes(label)) return false
    if (APP_LABELS.includes(label)) return true
    return t.section === 'main' // default: main section = apps
  })
  const toolCustomTiles = allCustom.filter(t => {
    const label = (t.label || '').toLowerCase()
    if (TOOL_LABELS.includes(label)) return true
    if (APP_LABELS.includes(label)) return false
    return t.section !== 'main' // default: non-main = tools
  })

  const rankings = leaderboardData?.rankings || []
  const userRank = leaderboardData?.user_rank
  const userPoints = leaderboardData?.user_points || 0
  const myEntry = userRank ? rankings.find(r => r.rank === userRank) : null
  const totalStaff = rankings.length
  const roleIdx = ROLE_LEVELS[userRole] ?? 0
  const hideScoreCard = userRole === 'admin' || userRole === 'corporate'

  return (
    <div className="w-full px-4 mx-auto">
      {/* Top banner row — Action buttons (Apps side) + Score Card (Tools side) */}
      {leaderboardData && !hideScoreCard && (() => {
        const totalAtLocation = leaderboardData.total_staff || totalStaff
        const displayRank = userRank || totalAtLocation || '—'
        return (
          <>
            <div className="flex gap-10 mb-5">
              {/* Score Card — above Apps (left) */}
              <div className="w-1/2 rounded-[14px] bg-surface border border-border px-5 py-3 flex items-center gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-text-primary">{userName}</span>
                  <span className="text-xs text-text-muted">·</span>
                  <span className="text-xs font-medium text-text-muted">{ordinal(displayRank)} Place</span>
                </div>
                <div className="h-5 w-px bg-border shrink-0" />
                <span className="text-xl font-black text-wcs-red shrink-0">{userPoints} <span className="text-xs font-semibold text-text-muted">pts</span></span>
                <div className="h-5 w-px bg-border shrink-0" />
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px]">
                    <strong className="text-blue-700">{myEntry?.memberships || 0}</strong>
                    <span className="text-blue-600">MS</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-[11px]">
                    <strong className="text-green-700">{myEntry?.day_ones || 0}</strong>
                    <span className="text-green-600">D1</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-[11px]">
                    <strong className="text-purple-700">{myEntry?.same_day || 0}</strong>
                    <span className="text-purple-600">SD</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px]">
                    <strong className="text-amber-700">{myEntry?.vips || 0}</strong>
                    <span className="text-amber-600">VIP</span>
                  </span>
                </div>
                <button
                  onClick={() => setShowPointsInfo(true)}
                  className="text-[11px] text-text-muted hover:text-wcs-red transition-colors shrink-0 underline decoration-dotted"
                >
                  Learn More
                </button>
                <p className="ml-auto text-xs italic text-text-muted shrink-0 max-w-[140px] text-right leading-tight">{motivationalMsg}</p>
              </div>

              {/* Action Buttons — above Tools (right) */}
              <div className="w-1/2 flex gap-4">
                {tourUrl && (
                  <a
                    href={tourUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex-1 flex items-center justify-center gap-3 rounded-[14px] bg-surface border border-border cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)] px-4"
                  >
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-text-primary">Book Gym Tour</span>
                  </a>
                )}
                {dayoneUrl && (
                  <a
                    href={dayoneUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex-1 flex items-center justify-center gap-3 rounded-[14px] bg-surface border border-border cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)] px-4"
                  >
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-text-primary">Book Day Ones</span>
                  </a>
                )}
                {vipUrl && (
                  <a
                    href={vipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex-1 flex items-center justify-center gap-3 rounded-[14px] bg-surface border border-border cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)] px-4"
                  >
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-text-primary">Submit VIPs</span>
                  </a>
                )}
              </div>
            </div>

            {/* Points Info Modal */}
            {showPointsInfo && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPointsInfo(false)}>
                <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-text-primary">How Points Work</h3>
                    <button onClick={() => setShowPointsInfo(false)} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
                  </div>
                  <div className="space-y-4 text-sm text-text-secondary">
                    <div>
                      <h4 className="font-semibold text-text-primary mb-2">Earn Points</h4>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-xs">
                            <strong className="text-green-700">10</strong> <span className="text-green-600">Day One Booked</span>
                          </span>
                          <span className="text-xs text-text-muted">Book a Day One session</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs">
                            <strong className="text-blue-700">5</strong> <span className="text-blue-600">Membership Sale</span>
                          </span>
                          <span className="text-xs text-text-muted">Close a membership</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-xs">
                            <strong className="text-purple-700">5</strong> <span className="text-purple-600">Same Day Sale</span>
                          </span>
                          <span className="text-xs text-text-muted">Bonus for closing same day</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs">
                            <strong className="text-amber-700">2</strong> <span className="text-amber-600">VIP</span>
                          </span>
                          <span className="text-xs text-text-muted">VIPs submitted</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-text-primary mb-1">Monthly Reset</h4>
                      <p>Points reset on the 1st of each month. Everyone starts fresh!</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-text-primary mb-1">Leaderboard</h4>
                      <p>Tap the <strong>Leaderboard</strong> tile to see how you rank against your club. Top 3 earn gold, silver, and bronze!</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )
      })()}

      <div className="flex gap-10">
      {/* Apps — left side */}
      <div className="w-1/2">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3">Apps</p>
        <div className="grid grid-cols-4 gap-4">
          {appTools.map((tool) => (
            <ToolButton key={tool.id} label={tool.label} description={tool.description} icon={tool.icon} url={getUrl(tool)} star={tool.id === 'grow' || tool.id === 'abc'} />
          ))}
          {appCustomTiles.filter((tile) => {
            const tileLabel = (tile.label || '').toLowerCase()
            // Indeed, Operandio, VistaPrint: manager+ only
            if (['indeed', 'operandio', 'vistaprint', 'vista'].includes(tileLabel) && roleIdx < ROLE_LEVELS.manager) return false
            return true
          }).map((tile) => (
            <ToolButton key={'main-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
          ))}
        </div>
      </div>

      {/* Tools — right side, ordered */}
      <div className="w-1/2">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3">Tools</p>
        <div className="grid grid-cols-4 gap-4">
          {/* 1. Cancel Tool (custom tile — direct link) */}
          {toolCustomTiles.filter(t => ['cancel', 'cancel tool'].includes((t.label || '').toLowerCase())).map(tile => (
            <ToolButton key={'custom-' + tile.id} label={tile.label} description={tile.description || ''} url={tile.url} star />
          ))}
          {/* 2. Calendar (Tours + Day Ones combined) */}
          {onCalendar && <SvgTileButton onClick={onCalendar} iconPath={TILE_ICONS.tours} label="Calendar" desc="Tours & Day Ones" badge={calendarBadge} star />}
          {/* 4. Leaderboard */}
          {onLeaderboard && <SvgTileButton onClick={onLeaderboard} iconPath={TILE_ICONS.leaderboard} label="Leaderboard" desc="Rankings" />}
          {/* 4.5. Communication Notes */}
          {onCommunicationNotes && <SvgTileButton onClick={onCommunicationNotes} iconPath={TILE_ICONS.commNotes} label="Comm Notes" desc="Team Notes" badge={commNotesBadge} />}
          {/* 4.6. HR Documents — manager+ only */}
          {onHR && roleIdx >= ROLE_LEVELS.manager && <SvgTileButton onClick={onHR} iconPath={TILE_ICONS.hr} label="HR Docs" desc="Documents" />}
          {/* 4.7. Help Center — all roles */}
          {onHelpCenter && <SvgTileButton onClick={onHelpCenter} iconPath={TILE_ICONS.helpCenter} label="Help Center" desc="Guides" />}
          {/* 4.8. Notifications — manager+ */}
          {roleIdx >= ROLE_LEVELS.manager && (
            <ToolButton label="Notifications" description="Member App" url="https://westcoaststrength.trainerize.com/app/login" />
          )}
          {/* 4.9. Tickets — lead+ */}
          {onTickets && roleIdx >= ROLE_LEVELS.lead && <SvgTileButton onClick={onTickets} iconPath={TILE_ICONS.tickets} label="Tickets/Support" desc="Help Desk" />}
          {/* 4.10. Shared Drive — visible to anyone (per-folder access controlled by drive_folders.min_role) */}
          {onDrive && <SvgTileButton onClick={onDrive} iconPath="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" label="Shared Drive" desc="Documents" />}
          {/* (Day One Tracking merged into Calendar) */}
          {/* 6. Trainer Availability */}
          {onTrainerAvail && roleIdx >= ROLE_LEVELS.lead && <SvgTileButton onClick={onTrainerAvail} iconPath={TILE_ICONS.availability} label="Availability" desc="Trainers" />}
          {/* 7-9. Reporting, Marketing, Tickets + remaining custom tiles */}
          {toolCustomTiles.filter((tile) => {
            const tileLabel = (tile.label || '').toLowerCase()
            // Skip Cancel — already rendered above
            if (['cancel', 'cancel tool'].includes(tileLabel)) return false
            // Hide Reporting tile for team_member
            if (tileLabel === 'reporting' && userRole === 'team_member') return false
            // Marketing tile only for corporate and admin
            if (tileLabel === 'marketing' && userRole !== 'corporate' && userRole !== 'admin') return false
            // Tickets: now a built-in tile — skip custom tile version
            if (tileLabel === 'tickets') return false
            // Indeed, Operandio, VistaPrint: manager+ only
            if (['indeed', 'operandio', 'vistaprint', 'vista'].includes(tileLabel) && roleIdx < ROLE_LEVELS.manager) return false
            return true
          }).sort((a, b) => {
            // Order: reporting, marketing, tickets, then everything else
            const order = { reporting: 0, marketing: 1, tickets: 2 }
            const aOrder = order[(a.label || '').toLowerCase()] ?? 99
            const bOrder = order[(b.label || '').toLowerCase()] ?? 99
            return aOrder - bOrder
          }).map((tile) => {
            const hasChildren = customTiles.some(t => t.parent_id === tile.id)
            const isGroup = hasChildren || !tile.url

            if (isGroup) {
              const tileLabel = (tile.label || '').toLowerCase()
              const handleClick = (tileLabel === 'reporting' && onReporting)
                ? onReporting
                : (tileLabel === 'marketing' && onMetaAds)
                  ? onMetaAds
                  : () => setActiveGroup(tile)

              const iconKey = (tile.label || '').toLowerCase()
              const iconPath = TILE_ICONS[iconKey] || TILE_ICONS.reporting
              return (
                <SvgTileButton
                  key={'custom-' + tile.id}
                  onClick={handleClick}
                  iconPath={iconPath}
                  label={tile.label}
                  desc={tile.description || ''}
                />
              )
            }

            return (
              <ToolButton key={'custom-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
            )
          })}
        </div>
      </div>
      </div>
    </div>
  )
}
