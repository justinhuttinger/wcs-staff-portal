import { useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import IdleOverlay from './components/IdleOverlay'
import useIdleTimer from './hooks/useIdleTimer'

const LOCATIONS = [
  'Salem', 'Keizer', 'Eugene', 'Springfield',
  'Clackamas', 'Milwaukie', 'Medford'
]

function getLocation() {
  const params = new URLSearchParams(window.location.search)
  const loc = params.get('location')
  if (loc && LOCATIONS.includes(loc)) return loc
  return import.meta.env.VITE_LOCATION || 'Salem'
}

export default function App() {
  const location = getLocation()
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
    <div className="min-h-screen bg-navy text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4">
        <img src="/wcs-logo.svg" alt="West Coast Strength" className="h-12" />
        <span className="text-xl font-semibold text-white/80">{location}</span>
      </header>

      {/* Tool Grid */}
      <main className="flex-1 flex items-center">
        <ToolGrid />
      </main>

      {/* Idle Overlay */}
      {isIdle && <IdleOverlay onDismiss={resetTimer} />}
    </div>
  )
}
