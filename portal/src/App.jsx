import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import LoginScreen from './components/LoginScreen'
import AdminPanel from './components/AdminPanel'
import SaveCredentialToast from './components/SaveCredentialToast'
import CalendarView from './components/CalendarView'
import ReportingView from './components/ReportingView'
import DayOneTrackerView from './components/DayOneTrackerView'
import TrainerAvailabilityView from './components/TrainerAvailabilityView'
import MarketingView from './components/MarketingView'
import LeaderboardView from './components/LeaderboardView'
import CommunicationNotesView from './components/CommunicationNotesView'
import HRView from './components/HRView'
import HelpCenterView from './components/HelpCenterView'
import TicketsView from './components/TicketsView'
import { getMe, getToken, clearToken, setToken, api } from './lib/api'

const LOCATION_BACKGROUNDS = {
  salem: '/bg-salem.jpg',
  keizer: '/bg-keizer.jpg',
  eugene: '/bg-eugene.jpg',
  springfield: '/bg-springfield.jpg',
  clackamas: '/bg-clackamas.jpg',
}

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key)
}

const kioskMode = getParam('mode')
const kioskKey = getParam('key')

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const abcUrl = getParam('abc_url')
  const locationParam = getParam('location')

  const [showAdmin, setShowAdmin] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showReporting, setShowReporting] = useState(false)
  const [showTrainerAvail, setShowTrainerAvail] = useState(false)
  const [showMetaAds, setShowMetaAds] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showCommunicationNotes, setShowCommunicationNotes] = useState(false)
  const [showHR, setShowHR] = useState(false)
  const [showHelpCenter, setShowHelpCenter] = useState(false)
  const [showTickets, setShowTickets] = useState(false)
  const [savePrompt, setSavePrompt] = useState(null)
  const [locationOverride, setLocationOverride] = useState(() => localStorage.getItem('wcs_location_override') || '')
  const isElectron = !!window.wcsElectron
  const isAdmin = user?.staff?.role === 'admin'

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  // Auto-login from stored token (for new tabs like Reporting)
  // Or kiosk auto-login with shared secret
  useEffect(() => {
    if (kioskMode === 'dayone' && kioskKey && !user) {
      api('/auth/kiosk', { method: 'POST', body: JSON.stringify({ key: kioskKey }) })
        .then(data => {
          setToken(data.token)
          setUser({ staff: data.staff, visible_tools: [] })
        })
        .catch(() => {})
    } else if (!user && getToken()) {
      getMe().then(meData => setUser(meData)).catch(() => {
        clearToken()
      })
    }
  }, [])

  useEffect(() => {
    if (window.wcsElectron?.onSavePrompt) {
      window.wcsElectron.onSavePrompt((data) => {
        setSavePrompt(data)
      })
    }
    if (window.wcsElectron?.onSignOut) {
      window.wcsElectron.onSignOut(() => {
        clearToken()
        setUser(null)
        setShowAdmin(false)
        setShowCalendar(false)
        setShowTrainerAvail(false)
        setShowMetaAds(false)
        setShowReporting(false)
        setShowLeaderboard(false)
        setShowCommunicationNotes(false)
        setShowHR(false)
        setShowHelpCenter(false)
        setShowTickets(false)
        if (window.wcsElectron) window.wcsElectron.onLogout()
      })
    }
    if (window.wcsElectron?.onNavigate) {
      window.wcsElectron.onNavigate((view) => {
        // Reset all views first
        setShowAdmin(false)
        setShowTrainerAvail(false)
        setShowMetaAds(false)
        setShowReporting(false)
        setShowLeaderboard(false)
        setShowCommunicationNotes(false)
        setShowHR(false)
        setShowHelpCenter(false)
        setShowTickets(false)
        // Navigate to requested view
        if (view === 'calendar') setShowCalendar(true)
        else setShowCalendar(false)
      })
    }
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    function onHashChange() {
      setShowReporting(window.location.hash.startsWith('#reporting'))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  async function handleLogin(data) {
    setLoading(true)
    try {
      const meData = await getMe()
      setUser(meData)
    } catch {
      setUser({
        staff: data.staff,
        visible_tools: [],
      })
    }
    // Reset to homepage on login
    setShowAdmin(false)
    setShowCalendar(false)
    setShowTrainerAvail(false)
    setShowReporting(false)
    setShowMetaAds(false)
    setShowLeaderboard(false)
    setShowCommunicationNotes(false)
    setShowHR(false)
    setShowHelpCenter(false)
    setShowTickets(false)
    if (window.location.hash) window.location.hash = ''
    // Notify Electron main process about the login
    if (window.wcsElectron) {
      window.wcsElectron.onLogin(getToken(), data.staff?.display_name || data.staff?.email || '')
    }
    setLoading(false)
  }

  function handleLogout() {
    clearToken()
    setUser(null)
    // Reset all views to homepage
    setShowAdmin(false)
    setShowCalendar(false)
    setShowTrainerAvail(false)
    setShowReporting(false)
    setShowLeaderboard(false)
    setShowCommunicationNotes(false)
    setShowHR(false)
    // Notify Electron main process about logout
    if (window.wcsElectron) {
      window.wcsElectron.onLogout()
    }
  }

  const location = locationOverride || locationParam || user?.staff?.locations?.find(l => l.is_primary)?.name || 'Salem'

  // Preload background image for instant display
  useEffect(() => {
    const bg = LOCATION_BACKGROUNDS[location.toLowerCase()]
    if (bg) {
      const img = new Image()
      img.src = bg
    }
  }, [location])

  const bgImage = LOCATION_BACKGROUNDS[location.toLowerCase()]

  if (!user) {
    if (kioskMode === 'dayone') {
      return <div className="min-h-screen bg-bg flex items-center justify-center"><p className="text-text-muted text-sm">Loading Day One Tracker...</p></div>
    }
    return <LoginScreen onLogin={handleLogin} bgImage={bgImage} />
  }

  // Kiosk mode: show only Day One Tracker, no header/navigation
  if (kioskMode === 'dayone') {
    return (
      <div className="min-h-screen bg-bg">
        <div className="px-8 py-4">
          <h1 className="text-xl font-black text-text-primary tracking-[-0.5px]">
            <span className="bg-gradient-to-r from-wcs-red to-[#fc8181] bg-clip-text text-transparent">WCS</span>
            {' '}Day One Tracker — {location}
          </h1>
        </div>
        <DayOneTrackerView user={user} onBack={null} location={location} isAdmin={false} />
      </div>
    )
  }

  const isHome = !showAdmin && !showCalendar && !showTrainerAvail && !showMetaAds && !showTickets && !showHelpCenter && !showHR && !showCommunicationNotes && !showLeaderboard && !showReporting

  function handleBackToPortal() {
    setShowAdmin(false)
    setShowCalendar(false)
    setShowTrainerAvail(false)
    setShowReporting(false)
    setShowMetaAds(false)
    setShowLeaderboard(false)
    setShowCommunicationNotes(false)
    setShowHR(false)
    setShowHelpCenter(false)
    setShowTickets(false)
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col relative">
      {/* Location background image — persists on all views */}
      {bgImage && (
        <>
          <div className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${bgImage})` }} />
          <div className="fixed inset-0 z-0 bg-black/60" />
        </>
      )}
      <header className="flex items-center justify-between px-8 py-3 max-w-3xl mx-auto w-full relative z-10">
        <div className="flex items-center gap-3">
          {!isHome && (
            <button
              onClick={handleBackToPortal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/30 bg-white/90 text-text-primary hover:bg-white transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {showAdmin ? 'Back to Portal' : 'Back'}
            </button>
          )}
          <img src="/wcs-logo.png" alt="WCS" className="h-10 w-10 rounded-full" />
          <h1 className={`text-2xl font-black tracking-[-0.5px] ${bgImage ? 'text-white' : 'text-text-primary'}`}>Portal</h1>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              onClick={() => setShowAdmin(true)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                bgImage
                  ? 'border-white/30 bg-white/10 text-white/80 hover:text-white hover:border-white/60'
                  : 'border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red'
              }`}
            >
              Admin
            </button>
          )}
          <span className={`text-sm font-semibold uppercase tracking-[0.8px] ${bgImage ? 'text-white/70' : 'text-text-muted'}`}>{location}</span>
          <button
            onClick={handleLogout}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              bgImage
                ? 'border-white/30 bg-white/10 text-white/80 hover:text-white hover:border-white/60'
                : 'border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red'
            }`}
          >
            Sign Out
          </button>
        </div>
      </header>

      <div className="relative z-10 flex-1 flex flex-col">
      {showAdmin ? (
        <AdminPanel onBack={() => setShowAdmin(false)} isElectron={isElectron} onLocationChange={(loc) => { setLocationOverride(loc); localStorage.setItem('wcs_location_override', loc) }} />
      ) : showCalendar ? (
        <CalendarView user={user} onBack={() => setShowCalendar(false)} location={location} isAdmin={isAdmin} />
      ) : showTrainerAvail ? (
        <TrainerAvailabilityView user={user} onBack={() => setShowTrainerAvail(false)} location={location} isAdmin={isAdmin} />
      ) : showMetaAds ? (
        <MarketingView onBack={() => setShowMetaAds(false)} />
      ) : showTickets ? (
        <TicketsView onBack={() => setShowTickets(false)} />
      ) : showHelpCenter ? (
        <HelpCenterView user={user} onBack={() => setShowHelpCenter(false)} />
      ) : showHR ? (
        <HRView user={user} onBack={() => setShowHR(false)} />
      ) : showCommunicationNotes ? (
        <CommunicationNotesView user={user} onBack={() => setShowCommunicationNotes(false)} />
      ) : showLeaderboard ? (
        <LeaderboardView user={user} onBack={() => setShowLeaderboard(false)} location={location} />
      ) : showReporting ? (
        <ReportingView user={user} onBack={() => setShowReporting(false)} location={location} isAdmin={isAdmin} />
      ) : (
        <main className="flex-1 flex items-start pt-1 pb-12">
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onCalendar={() => setShowCalendar(true)} onTrainerAvail={() => setShowTrainerAvail(true)} onMetaAds={() => setShowMetaAds(true)} onLeaderboard={() => setShowLeaderboard(true)} onHR={() => setShowHR(true)} onHelpCenter={() => setShowHelpCenter(true)} onTickets={() => setShowTickets(true)} onCommunicationNotes={() => setShowCommunicationNotes(true)} onReporting={() => setShowReporting(true)} userRole={user.staff?.role} userName={user.staff?.display_name || user.staff?.first_name || ''} />
        </main>
      )}
      </div>

      <p className="fixed bottom-2 right-3 text-[10px] text-text-muted/40 select-none pointer-events-none">v1.3.6</p>

      {savePrompt && (
        <SaveCredentialToast
          service={savePrompt.service}
          username={savePrompt.username}
          onRespond={(accepted) => {
            if (window.wcsElectron?.respondSavePrompt) {
              window.wcsElectron.respondSavePrompt(accepted)
            }
            setSavePrompt(null)
          }}
        />
      )}
    </div>
  )
}
