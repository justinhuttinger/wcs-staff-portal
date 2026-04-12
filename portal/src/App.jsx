import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import LoginScreen from './components/LoginScreen'
import AdminPanel from './components/AdminPanel'
import SaveCredentialToast from './components/SaveCredentialToast'
import ToursView from './components/ToursView'
import ReportingView from './components/ReportingView'
import DayOneTrackerView from './components/DayOneTrackerView'
import TrainerAvailabilityView from './components/TrainerAvailabilityView'
import DayOneCalendarView from './components/DayOneCalendarView'
import MarketingView from './components/MarketingView'
import LeaderboardView from './components/LeaderboardView'
import { getMe, getToken, clearToken, setToken, api } from './lib/api'

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
  const [showTours, setShowTours] = useState(false)
  const [showReporting, setShowReporting] = useState(window.location.hash.startsWith('#reporting'))
  const [showDayOneTracker, setShowDayOneTracker] = useState(false)
  const [showTrainerAvail, setShowTrainerAvail] = useState(false)
  const [showDayOneCalendar, setShowDayOneCalendar] = useState(false)
  const [showMetaAds, setShowMetaAds] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [savePrompt, setSavePrompt] = useState(null)
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
        setShowTours(false)
        setShowDayOneTracker(false)
        setShowTrainerAvail(false)
        setShowDayOneCalendar(false)
        setShowMetaAds(false)
        setShowReporting(false)
        setShowLeaderboard(false)
        if (window.wcsElectron) window.wcsElectron.onLogout()
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
    setShowTours(false)
    setShowDayOneTracker(false)
    setShowTrainerAvail(false)
    setShowReporting(false)
    setShowLeaderboard(false)
    // Notify Electron main process about logout
    if (window.wcsElectron) {
      window.wcsElectron.onLogout()
    }
  }

  if (!user) {
    if (kioskMode === 'dayone') {
      return <div className="min-h-screen bg-bg flex items-center justify-center"><p className="text-text-muted text-sm">Loading Day One Tracker...</p></div>
    }
    return <LoginScreen onLogin={handleLogin} />
  }

  const location = locationParam || user.staff.locations?.find(l => l.is_primary)?.name || 'Salem'

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

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="flex items-center justify-between px-8 py-6 max-w-3xl mx-auto w-full">
        <div>
          <div className="flex items-center gap-3">
            <img src="/wcs-logo.png" alt="WCS" className="h-10 w-10 rounded-full" />
            <h1 className="text-2xl font-black text-text-primary tracking-[-0.5px]">Portal</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              onClick={() => setShowAdmin(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red transition-colors"
            >
              Admin
            </button>
          )}
          <span className="text-sm font-semibold text-text-muted uppercase tracking-[0.8px]">{location}</span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {showAdmin ? (
        <AdminPanel onBack={() => setShowAdmin(false)} isElectron={isElectron} />
      ) : showTours ? (
        <ToursView user={user} onBack={() => setShowTours(false)} />
      ) : showDayOneTracker ? (
        <DayOneTrackerView user={user} onBack={() => setShowDayOneTracker(false)} location={location} isAdmin={isAdmin} />
      ) : showDayOneCalendar ? (
        <DayOneCalendarView user={user} onBack={() => setShowDayOneCalendar(false)} location={location} />
      ) : showTrainerAvail ? (
        <TrainerAvailabilityView user={user} onBack={() => setShowTrainerAvail(false)} location={location} isAdmin={isAdmin} />
      ) : showMetaAds ? (
        <MarketingView onBack={() => setShowMetaAds(false)} />
      ) : showLeaderboard ? (
        <LeaderboardView user={user} onBack={() => setShowLeaderboard(false)} location={location} />
      ) : showReporting ? (
        <ReportingView user={user} onBack={() => setShowReporting(false)} location={location} isAdmin={isAdmin} />
      ) : (
        <main className="flex-1 flex items-start pt-4">
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onTours={() => setShowTours(true)} onDayOneTracker={() => setShowDayOneTracker(true)} onDayOneCalendar={() => setShowDayOneCalendar(true)} onTrainerAvail={() => setShowTrainerAvail(true)} onMetaAds={() => setShowMetaAds(true)} onLeaderboard={() => setShowLeaderboard(true)} userRole={user.staff?.role} />
        </main>
      )}

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
