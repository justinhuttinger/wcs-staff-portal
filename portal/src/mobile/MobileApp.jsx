import React, { useState, useEffect } from 'react'
import { getMe, getToken, clearToken, onAuthExpired } from '../lib/api'
import LoginScreen from './components/LoginScreen'
import MobileHeader from './components/MobileHeader'
import HomeScreen from './components/HomeScreen'
import ReportsHome from './components/reports/ReportsHome'
import MobileReportShell from './components/reports/MobileReportShell'
import MobileClubHealth from './components/reports/MobileClubHealth'
import MobileMembership from './components/reports/MobileMembership'
import MobilePTReport from './components/reports/MobilePTReport'
import MobileMarketing from './components/reports/MobileMarketing'
import MobileTours from './components/MobileTours'
import MobileDayOneCalendar from './components/MobileDayOneCalendar'

// Icons for bottom tab bar (Heroicons outline)
function HomeIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${active ? 'text-wcs-red' : 'text-text-muted'}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )
}

function ReportsIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${active ? 'text-wcs-red' : 'text-text-muted'}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

function ToursIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${active ? 'text-wcs-red' : 'text-text-muted'}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function DayOneIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${active ? 'text-wcs-red' : 'text-text-muted'}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  )
}

function getActiveTab(route) {
  if (route === 'home' || route === '') return 'home'
  if (route.startsWith('reports')) return 'reports'
  if (route.startsWith('tours')) return 'tours'
  if (route.startsWith('dayone')) return 'dayone'
  return 'home'
}

export default function MobileApp() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [route, setRoute] = useState(window.location.hash.slice(1) || 'home')

  useEffect(() => {
    function onHashChange() {
      setRoute(window.location.hash.slice(1) || 'home')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Auto-redirect to login when token expires
  useEffect(() => {
    return onAuthExpired(() => {
      setUser(null)
      navigate('home')
    })
  }, [])

  useEffect(() => {
    async function restoreSession() {
      const token = getToken()
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const data = await getMe()
        setUser(data)
      } catch {
        clearToken()
      }
      setLoading(false)
    }
    restoreSession()
  }, [])

  function navigate(path) {
    window.location.hash = path
    setRoute(path)
  }

  function handleLogin(userData) {
    setUser(userData)
    navigate('home')
  }

  function handleLogout() {
    clearToken()
    setUser(null)
    navigate('login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-wcs-red" />
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  const activeTab = getActiveTab(route)

  const isAdmin = user?.staff?.role === 'admin' || user?.staff?.role === 'director'
  const userLocation = user?.staff?.locations?.find(l => l.is_primary)?.name || user?.staff?.locations?.[0]?.name || 'Salem'

  function renderView() {
    switch (route) {
      case 'home':
      case '':
        return <HomeScreen user={user} navigate={navigate} onLogout={handleLogout} />
      case 'reports':
        return (
          <div className="pt-4 px-4">
            <MobileHeader title="Reports" subtitle="Select a report" />
            <ReportsHome onNavigate={(key) => navigate('reports/' + key)} user={user} />
          </div>
        )
      case 'reports/club-health':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Club Health" onBack={() => navigate('reports')} />
            </div>
            <MobileReportShell title="Club Health" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileClubHealth startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/membership':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Membership" onBack={() => navigate('reports')} />
            </div>
            <MobileReportShell title="Membership" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileMembership startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/pt':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="PT / Day One" onBack={() => navigate('reports')} />
            </div>
            <MobileReportShell title="PT / Day One" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobilePTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/marketing':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Ad Reports" onBack={() => navigate('reports')} />
            </div>
            <MobileMarketing />
          </div>
        )
      case 'tours':
        return <MobileTours user={user} />
      case 'dayone':
        return <MobileDayOneCalendar user={user} />
      default:
        return (
          <div className="pt-4 px-4">
            <MobileHeader title="Not Found" />
            <div className="mt-16 text-center text-text-muted">Page not found</div>
          </div>
        )
    }
  }

  const tabs = [
    { key: 'home', label: 'Home', Icon: HomeIcon },
    { key: 'reports', label: 'Reports', Icon: ReportsIcon },
    { key: 'tours', label: 'Tours', Icon: ToursIcon },
    { key: 'dayone', label: 'Day One', Icon: DayOneIcon },
  ]

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {/* Main content area with bottom padding for tab bar */}
      <div className="pb-20">
        {renderView()}
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border flex items-center justify-around px-2 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {tabs.map(({ key, label, Icon }) => {
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => navigate(key === 'home' ? 'home' : key)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors ${isActive ? 'text-wcs-red' : 'text-text-muted'}`}
            >
              <Icon active={isActive} />
              <span className={`text-xs font-medium ${isActive ? 'text-wcs-red' : 'text-text-muted'}`}>{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
