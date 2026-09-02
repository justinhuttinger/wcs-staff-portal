import React, { useState, useEffect } from 'react'
import { getMe, getToken, clearToken, onAuthExpired, logout } from '../lib/api'
import GlobalProgressBar from '../components/GlobalProgressBar'
import LoginScreen from './components/LoginScreen'
import MobileHeader from './components/MobileHeader'
import HomeScreen from './components/HomeScreen'
import ReportsHome, { REPORT_GROUPS } from './components/reports/ReportsHome'
import WcsLoadingMark from '../components/WcsLoadingMark'
import MobileReportShell from './components/reports/MobileReportShell'
import MobileClubHealth from './components/reports/MobileClubHealth'
import MobileMembership from './components/reports/MobileMembership'
import MobileCancels from './components/reports/MobileCancels'
import MobilePTReport from './components/reports/MobilePTReport'
import MobileMarketing from './components/reports/MobileMarketing'
import MobileGoogleMarketing from './components/reports/MobileGoogleMarketing'
import MobileOperations from './components/reports/MobileOperations'
import MobileCalendar from './components/MobileCalendar'
import MobileLeaderboard from './components/MobileLeaderboard'
import MobileCommunicationNotes from './components/MobileCommunicationNotes'
import MobileHR from './components/MobileHR'
import MobileTicketing from './components/MobileTicketing'
import MobilePTRoster from './components/reports/MobilePTRoster'
import MobileCheckins from './components/reports/MobileCheckins'
import MobilePTSessions from './components/reports/MobilePTSessions'
import MobilePTNewClients from './components/reports/MobilePTNewClients'
import MobileSessionFrequency from './components/reports/MobileSessionFrequency'
import MobileDeactivatedPT from './components/reports/MobileDeactivatedPT'
import MobilePTHealth from './components/reports/MobilePTHealth'
import MobilePayroll from './components/reports/MobilePayroll'
import MobileRevenue from './components/reports/MobileRevenue'
import MobileMarketingTracker from './components/MobileMarketingTracker'
import MobileInventory from './components/MobileInventory'
// KPIs + Audits reuse the (responsive) desktop report components on mobile.
import KpiReport from '../components/reports/KpiReport'
import AuditsReport from '../components/reports/AuditsReport'
import { getReportInfo } from '../lib/reportInfo'
import { marketingAccess } from '../config/marketingAccess'
// Analytics reuses the desktop report registry wholesale — see MobileAnalytics.
import {
  MobileAnalyticsHome, MobileAnalyticsReport, reportHidesDates, reportLabel,
} from './components/analytics/MobileAnalytics'
import { getTheme, THEME_EVENT } from '../lib/theme'
import { hydrateUiPrefs } from '../lib/uiPrefs'

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

function CalendarIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${active ? 'text-wcs-red' : 'text-text-muted'}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

const LOCATION_BACKGROUNDS = {
  salem: '/bg-salem.jpg',
  keizer: '/bg-keizer.jpg',
  eugene: '/bg-eugene.jpg',
  springfield: '/bg-springfield.jpg',
  clackamas: '/bg-clackamas.jpg',
  milwaukie: '/bg-milwaukie.jpg',
  medford: '/bg-medford.jpg',
}

function getActiveTab(route) {
  if (route === 'home' || route === '') return 'home'
  // Analytics is its own surface, not a Reports category, so it does not light
  // up the Reports tab — the two have different gates and different content.
  if (route.startsWith('analytics')) return 'home'
  if (route.startsWith('reports')) return 'reports'
  if (route === 'calendar' || route === 'tours' || route === 'dayone') return 'calendar'
  return 'home'
}

export default function MobileApp() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [route, setRoute] = useState(window.location.hash.slice(1) || 'home')

  // Appearance is DESKTOP'S TO SET AND MOBILE'S TO FOLLOW. The theme lives per
  // user on the server (user_ui_preferences.prefs), so hydrating it here is the
  // whole of "follow whatever they picked on the desktop" — there is no mobile
  // picker and deliberately no push back up, which is why startUiPrefsSync is
  // not called. Mobile is a reader of this setting, not a second author of it.
  const [theme, setTheme] = useState(getTheme)
  const press = theme === 'press'

  useEffect(() => {
    // hydrateUiPrefs applies the server row through setPrefs, which fires this
    // event; listening rather than reading the promise means a change made in
    // another tab lands here too.
    const onChange = () => setTheme(getTheme())
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])

  // The OS paints the status bar from this tag, somewhere no CSS can reach, so
  // it has to be set imperatively. mobile.html handles the pre-paint case; this
  // handles the theme arriving from the server a moment later.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', press ? '#ffffff' : '#1a1a2e')
  }, [press])

  // Keyed on staff id so signing in as somebody else re-pulls rather than
  // inheriting the previous person's look on a shared phone.
  useEffect(() => {
    if (!user?.staff?.id) return
    hydrateUiPrefs().catch(() => {})
  }, [user?.staff?.id])

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
    logout()
    setUser(null)
    navigate('login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <WcsLoadingMark size={72} className="text-wcs-red" />
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  // Lead+ access gate. Leads get a limited app (Inventory, Calendar, Tickets,
  // Leaderboard); managers and above get everything.
  const ROLE_LEVELS = { team_member: 0, lead: 1, manager: 2, corporate: 3, admin: 4 }
  const userRole = user?.staff?.role || 'team_member'
  const roleIdx = ROLE_LEVELS[userRole] ?? 0

  if (roleIdx < ROLE_LEVELS.lead) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center px-6">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-sm">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto text-text-muted mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h2 className="text-lg font-bold text-text-primary mb-1">Access Restricted</h2>
          <p className="text-sm text-text-muted mb-4">The mobile app is only available to team leads and above.</p>
          <button onClick={handleLogout} className="px-4 py-2 text-sm font-medium text-wcs-red border border-wcs-red rounded-lg">
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  const activeTab = getActiveTab(route)

  const isAdmin = user?.staff?.role === 'admin'
  const userLocation = user?.staff?.locations?.find(l => l.is_primary)?.name || user?.staff?.locations?.[0]?.name || 'Salem'

  // Look up the parent group for a report key so back-from-report lands on
  // the group view instead of the top-level Reports home.
  function parentRouteForReport(reportKey) {
    for (const g of REPORT_GROUPS) {
      if (g.reports.includes(reportKey)) return 'reports/group/' + g.key
    }
    return 'reports'
  }

  function renderView() {
    // Group detail (reports/group/<key>) — pre-opens that group inside ReportsHome.
    if (route.startsWith('reports/group/')) {
      const groupKey = route.replace('reports/group/', '')
      const group = REPORT_GROUPS.find(g => g.key === groupKey)
      const title = group ? group.label : 'Reports'
      return (
        <div className="pt-4 px-4">
          <MobileHeader title={title} subtitle="Select a report" onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
          <ReportsHome
            onNavigate={(key) => navigate('reports/' + key)}
            onSelectGroup={(g) => navigate('reports/group/' + g)}
            user={user}
            activeGroup={groupKey}
          />
        </div>
      )
    }

    // Analytics — corporate+, the same tier as desktop. The tile is hidden below
    // it and this refuses to render, but the gate that matters is the one on
    // every /analytics/* route on the server.
    if (route === 'analytics' || route.startsWith('analytics/')) {
      if (roleIdx < ROLE_LEVELS.corporate) {
        return (
          <div className="pt-4 px-4">
            <MobileHeader title="Analytics" onBack={() => navigate('home')} />
            <div className="mt-16 text-center text-text-muted">
              Analytics is available to corporate roles.
            </div>
          </div>
        )
      }
      const reportKey = route === 'analytics' ? null : route.slice('analytics/'.length)
      if (!reportKey) {
        return (
          // Padding on the HEADER, not on the whole route, so the picker below
          // can run edge to edge. Same structure the report route below uses.
          // Wrapping everything in px-4 and letting the list pull back out with
          // a negative margin does not work: MobileReportShell hands its
          // children an overflow-y-auto box, and an element with overflow on one
          // axis gets overflow on the other too, so the bleed was clipped and
          // left a sideways scroll instead.
          <div className="pt-4">
            <div className="px-4">
              <MobileHeader title="Analytics" subtitle="Select a report" onBack={() => navigate('home')} />
            </div>
            <MobileReportShell title="Analytics" user={user} hideDateRange>
              {({ locationSlug }) => (
                <MobileAnalyticsHome
                  locationSlug={locationSlug}
                  onOpen={(key) => navigate('analytics/' + key)}
                />
              )}
            </MobileReportShell>
          </div>
        )
      }
      return (
        <div className="pt-2">
          <div className="px-4">
            <MobileHeader title={reportLabel(reportKey)} onBack={() => navigate('analytics')} />
          </div>
          {/* hideDateRange follows the report's own `dates: false`, so the ones
              anchored on their own windows (Topline, Club Activity Trends) do
              not offer a range that would do nothing but mislead. */}
          <MobileReportShell
            title={reportLabel(reportKey)}
            user={user}
            hideDateRange={reportHidesDates(reportKey)}
          >
            {({ startDate, endDate, locationSlug }) => (
              <MobileAnalyticsReport
                reportKey={reportKey}
                user={user}
                startDate={startDate}
                endDate={endDate}
                locationSlug={locationSlug}
              />
            )}
          </MobileReportShell>
        </div>
      )
    }

    switch (route) {
      case 'home':
      case '':
        return <HomeScreen user={user} navigate={navigate} onLogout={handleLogout} />
      case 'reports':
        return (
          <div className="pt-4 px-4">
            <MobileHeader title="Reports" subtitle="Select a category" />
            <ReportsHome
              onNavigate={(key) => navigate('reports/' + key)}
              onSelectGroup={(groupKey) => navigate('reports/group/' + groupKey)}
              user={user}
            />
          </div>
        )
      case 'reports/club-health':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Club Health" info={getReportInfo('club-health')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
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
              <MobileHeader title="Membership" info={getReportInfo('membership')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
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
      case 'reports/cancels':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Cancels" info={getReportInfo('cancels')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Cancels" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileCancels startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/pt':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="PT / Day One" info={getReportInfo('pt')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
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
      case 'reports/pt-roster':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="PT Roster" info={getReportInfo('pt-roster')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="PT Roster" user={user} hideDateRange>
              {({ locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobilePTRoster locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/checkins':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Check-ins" info={getReportInfo('checkins')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Check-ins" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileCheckins startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/marketing':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Meta Ads" info={getReportInfo('meta-ads')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileMarketing />
          </div>
        )
      case 'reports/google-marketing':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Google Marketing" info={getReportInfo('google-marketing')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileGoogleMarketing />
          </div>
        )
      case 'reports/operations':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Operational Compliance" info={getReportInfo('operations')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileOperations user={user} />
          </div>
        )
      case 'reports/pt-sessions':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Trainer Load" info={getReportInfo('pt-sessions')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Trainer Load" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobilePTSessions startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/pt-new-clients':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="New Clients" info={getReportInfo('pt-new-clients')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="New Clients" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobilePTNewClients startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/session-frequency':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Session Frequency" info={getReportInfo('session-frequency')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Session Frequency" user={user} hideDateRange>
              {({ locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileSessionFrequency locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/deactivated-pt':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Deactivated PT" info={getReportInfo('deactivated-pt')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Deactivated PT" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileDeactivatedPT startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/pt-health':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="PT Health" info={getReportInfo('pt-health')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="PT Health" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobilePTHealth startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/payroll':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Payroll" info={getReportInfo('payroll')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Payroll" user={user} hideDateRange>
              {({ locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobilePayroll locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/revenue':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Revenue" info={getReportInfo('revenue')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Revenue" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <MobileRevenue startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/kpis':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="KPIs" info={getReportInfo('kpis')} onBack={() => navigate('reports')} />
            </div>
            <MobileReportShell title="KPIs" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <KpiReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'reports/audits':
        return (
          <div className="pt-2">
            <div className="px-4">
              <MobileHeader title="Audits" info={getReportInfo('audits')} onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            </div>
            <MobileReportShell title="Audits" user={user}>
              {({ startDate, endDate, locationSlug }) => (
                <div className="px-4 pb-4">
                  <AuditsReport locationSlug={locationSlug} />
                </div>
              )}
            </MobileReportShell>
          </div>
        )
      case 'calendar':
      case 'tours':
      case 'dayone':
        return <MobileCalendar user={user} />
      case 'marketing-tracker':
        return <MobileMarketingTracker access={marketingAccess(user)} />
      case 'inventory':
        return <MobileInventory user={user} />
      case 'leaderboard':
        return <MobileLeaderboard user={user} />
      case 'comm-notes':
        return <MobileCommunicationNotes user={user} />
      case 'hr':
        return <MobileHR user={user} />
      case 'ticketing':
        // Native ticketing (maker board + handler queue). Any lead+ can open it;
        // handler controls appear only for the ticket type's handlers.
        return <MobileTicketing user={user} />
      case 'reports/pt-projections':
        return (
          <div className="pt-4 px-4">
            <MobileHeader title="PT Projections" onBack={() => navigate(parentRouteForReport(route.replace('reports/', '')))} />
            <div className="mt-16 text-center text-text-muted">This report is best viewed on desktop.</div>
          </div>
        )
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
    // Reports is manager+; leads get Home + Calendar.
    ...(roleIdx >= ROLE_LEVELS.manager ? [{ key: 'reports', label: 'Reports', Icon: ReportsIcon }] : []),
    { key: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  ]

  // Press is a white-ground theme taken from the website, and a full-bleed club
  // photo under it fights the paper look the same way it does on desktop, where
  // App.jsx drops the background for exactly this reason.
  const bgImage = press ? null : LOCATION_BACKGROUNDS[userLocation.toLowerCase()]

  return (
    <div className="h-screen bg-bg text-text-primary relative flex flex-col overflow-hidden">
      <GlobalProgressBar />
      {/* Location background image */}
      {bgImage && (
        <>
          <div className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${bgImage})` }} />
          <div className="fixed inset-0 z-0 bg-black/60" />
        </>
      )}
      {/* Main content area — scrollable, between fixed header space and bottom nav */}
      <div className="flex-1 overflow-y-auto relative z-10 pb-20">
        {renderView()}
      </div>

      {/* Bottom tab bar */}
      {/* The tab bar is the mobile equivalent of Press's persistent top nav, so
          it carries the same marks: Prohibition uppercase labels and a solid red
          rule on the active tab instead of Classic's red icon. The classes are
          inert under Classic — index.css only styles them under Press. */}
      <nav className="mobile-tabbar fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border flex items-center justify-around px-2 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {tabs.map(({ key, label, Icon }) => {
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => navigate(key === 'home' ? 'home' : key)}
              className={`mobile-tab${isActive ? ' is-active' : ''} flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors ${isActive ? 'text-wcs-red' : 'text-text-muted'}`}
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
