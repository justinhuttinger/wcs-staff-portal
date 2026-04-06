import { useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import IdleOverlay from './components/IdleOverlay'
import useIdleTimer from './hooks/useIdleTimer'

const LOCATIONS = [
  'Salem', 'Keizer', 'Eugene', 'Springfield',
  'Clackamas', 'Milwaukie', 'Medford'
]

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key)
}

function getLocation() {
  const loc = getParam('location')
  if (loc && LOCATIONS.includes(loc)) return loc
  return import.meta.env.VITE_LOCATION || 'Salem'
}

export default function App() {
  const location = getLocation()
  const abcUrl = getParam('abc_url')
  const { isIdle, resetTimer } = useIdleTimer(10 * 60 * 1000)

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 max-w-3xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-black text-text-primary tracking-[-0.5px]">
            <span className="bg-gradient-to-r from-wcs-red to-[#fc8181] bg-clip-text text-transparent">WCS</span>
            {' '}Staff Portal
          </h1>
        </div>
        <span className="text-sm font-semibold text-text-muted uppercase tracking-[0.8px]">{location}</span>
      </header>

      {/* Tool Grid */}
      <main className="flex-1 flex items-start pt-4">
        <ToolGrid abcUrl={abcUrl} location={location} />
      </main>

      {/* Idle Overlay */}
      {isIdle && <IdleOverlay onDismiss={resetTimer} />}
    </div>
  )
}
