import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import LoginScreen from './components/LoginScreen'
import AdminPanel from './components/AdminPanel'
import SaveCredentialToast from './components/SaveCredentialToast'
import ToursView from './components/ToursView'
import ReportingView from './components/ReportingView'
import DayOneTrackerView from './components/DayOneTrackerView'
import { getMe, getToken, clearToken } from './lib/api'

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const abcUrl = getParam('abc_url')
  const locationParam = getParam('location')

  const [showAdmin, setShowAdmin] = useState(false)
  const [showTours, setShowTours] = useState(false)
  const [showReporting, setShowReporting] = useState(window.location.hash.startsWith('#reporting'))
  const [showDayOneTracker, setShowDayOneTracker] = useState(false)
  const [savePrompt, setSavePrompt] = useState(null)
  const isElectron = !!window.wcsElectron
  const isAdmin = user?.staff?.role === 'admin' || user?.staff?.role === 'director'

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  // Auto-login from stored token (for new tabs like Reporting)
  useEffect(() => {
    if (!user && getToken()) {
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
      window.wcsElectron.onLogin(getToken())
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
    setShowReporting(false)
    // Notify Electron main process about logout
    if (window.wcsElectron) {
      window.wcsElectron.onLogout()
    }
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  const location = locationParam || user.staff.locations?.find(l => l.is_primary)?.name || 'Salem'

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="flex items-center justify-between px-8 py-6 max-w-3xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-black text-text-primary tracking-[-0.5px]">
            <span className="bg-gradient-to-r from-wcs-red to-[#fc8181] bg-clip-text text-transparent">WCS</span>
            {' '}Staff Portal
          </h1>
          <p className="text-xs text-text-muted mt-0.5">{user.staff.display_name}</p>
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
            className="text-xs text-text-muted hover:text-wcs-red transition-colors"
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
      ) : showReporting ? (
        <ReportingView user={user} onBack={() => setShowReporting(false)} location={location} isAdmin={isAdmin} />
      ) : (
        <main className="flex-1 flex items-start pt-4">
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onTours={() => setShowTours(true)} onDayOneTracker={() => setShowDayOneTracker(true)} />
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
