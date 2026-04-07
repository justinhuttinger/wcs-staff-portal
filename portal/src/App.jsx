import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import IdleOverlay from './components/IdleOverlay'
import LoginScreen from './components/LoginScreen'
import AdminConfig from './components/AdminConfig'
import AdminPanel from './components/AdminPanel'
import SaveCredentialToast from './components/SaveCredentialToast'
import DayOneView from './components/DayOneView'
import ToursView from './components/ToursView'
import useIdleTimer from './hooks/useIdleTimer'
import { getMe, getToken, clearToken } from './lib/api'

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const abcUrl = getParam('abc_url')
  const locationParam = getParam('location')

  const [showConfig, setShowConfig] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showDayOne, setShowDayOne] = useState(false)
  const [showTours, setShowTours] = useState(false)
  const [savePrompt, setSavePrompt] = useState(null)
  const isElectron = !!window.wcsElectron
  const isAdmin = user?.staff?.role === 'admin' || user?.staff?.role === 'director'

  const { isIdle, resetTimer } = useIdleTimer(10 * 60 * 1000)

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  useEffect(() => {
    if (window.wcsElectron?.onSavePrompt) {
      window.wcsElectron.onSavePrompt((data) => {
        setSavePrompt(data)
      })
    }
  }, [])

  useEffect(() => {
    if (isIdle && user) {
      handleLogout()
    }
  }, [isIdle])

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
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
    resetTimer()
  }

  function handleLogout() {
    clearToken()
    setUser(null)
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
          {isAdmin && (<>
            <button
              onClick={() => setShowConfig(true)}
              className="text-text-muted hover:text-wcs-red transition-colors"
              title="Kiosk Configuration"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
            <button
              onClick={() => setShowAdmin(true)}
              className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
            >
              Admin
            </button>
          </>)}
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
        <AdminPanel onBack={() => setShowAdmin(false)} />
      ) : showDayOne ? (
        <DayOneView user={user} onBack={() => setShowDayOne(false)} />
      ) : showTours ? (
        <ToursView user={user} onBack={() => setShowTours(false)} />
      ) : (
        <main className="flex-1 flex items-start pt-4">
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onDayOne={() => setShowDayOne(true)} onTours={() => setShowTours(true)} />
        </main>
      )}

      {isIdle && <IdleOverlay onDismiss={resetTimer} />}
      {showConfig && <AdminConfig isElectron={isElectron} onClose={() => setShowConfig(false)} />}
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
