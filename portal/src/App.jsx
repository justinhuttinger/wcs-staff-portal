import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import IdleOverlay from './components/IdleOverlay'
import LoginScreen from './components/LoginScreen'
import useIdleTimer from './hooks/useIdleTimer'
import { getMe, clearToken } from './lib/api'

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const abcUrl = getParam('abc_url')
  const locationParam = getParam('location')

  const { isIdle, resetTimer } = useIdleTimer(10 * 60 * 1000)

  useEffect(() => {
    document.title = 'WCS Staff Portal'
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
    setLoading(false)
    resetTimer()
  }

  function handleLogout() {
    clearToken()
    setUser(null)
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  const location = user.staff.locations?.find(l => l.is_primary)?.name || locationParam || 'Salem'

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
          <span className="text-sm font-semibold text-text-muted uppercase tracking-[0.8px]">{location}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-text-muted hover:text-wcs-red transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-start pt-4">
        <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} />
      </main>

      {isIdle && <IdleOverlay onDismiss={resetTimer} />}
    </div>
  )
}
