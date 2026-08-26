import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import LoginScreen from './components/LoginScreen'
import AdminPanel from './components/AdminPanel'
import SaveCredentialToast from './components/SaveCredentialToast'
import CalendarView from './components/CalendarView'
import ReportingView from './components/ReportingView'
import MarketingTrackerView from './components/MarketingTrackerView'
import { marketingAccess } from './config/marketingAccess'
import InventoryView from './components/InventoryView'
import DayOneTrackerView from './components/DayOneTrackerView'
import TrainerAvailabilityView from './components/TrainerAvailabilityView'
import LeaderboardView from './components/LeaderboardView'
import CommunicationNotesView from './components/CommunicationNotesView'
import HRView from './components/HRView'
import HelpCenterView from './components/HelpCenterView'
import TicketsBoardView from './components/TicketsBoardView'
import DriveView from './components/DriveView'
import DriveHub from './components/DriveHub'
import MediaLibraryView from './components/MediaLibraryView'
import FormsView from './components/forms/FormsView'
import NpsView from './components/nps/NpsView'
import TourCheckinQueueView from './components/TourCheckinQueueView'
import AdsManagerView from './components/AdsManagerView'
import GlobalProgressBar from './components/GlobalProgressBar'
import PortalNav from './components/PortalNav'
import { getTheme, THEME_EVENT } from './lib/theme'
import WhatsNew from './components/WhatsNew'
import { getMe, getToken, clearToken, setToken, api, onAuthExpired, logout, setImpersonateId } from './lib/api'
import { logEvent } from './lib/audit'
import { useForceRefresh } from './lib/useForceRefresh'

const LOCATION_BACKGROUNDS = {
  salem: '/bg-salem.jpg',
  keizer: '/bg-keizer.jpg',
  eugene: '/bg-eugene.jpg',
  springfield: '/bg-springfield.jpg',
  clackamas: '/bg-clackamas.jpg',
  milwaukie: '/bg-milwaukie.jpg',
  medford: '/bg-medford.jpg',
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
  const [showMarketingTracker, setShowMarketingTracker] = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  const [showTrainerAvail, setShowTrainerAvail] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showCommunicationNotes, setShowCommunicationNotes] = useState(false)
  const [showHR, setShowHR] = useState(false)
  const [showHelpCenter, setShowHelpCenter] = useState(false)
  const [showTicketsBoard, setShowTicketsBoard] = useState(false)
  const [showDrive, setShowDrive] = useState(false)
  const [showDriveHub, setShowDriveHub] = useState(false)
  const [showMediaLibrary, setShowMediaLibrary] = useState(false)
  const [showForms, setShowForms] = useState(false)
  const [showNps, setShowNps] = useState(false)
  const [showTourCheckin, setShowTourCheckin] = useState(false)
  const [showAdsManager, setShowAdsManager] = useState(false)
  const [savePrompt, setSavePrompt] = useState(null)
  const [locationOverride, setLocationOverride] = useState(() => localStorage.getItem('wcs_location_override') || '')
  // Press theme swaps the classic header for a persistent top nav (PortalNav).
  // It is the only theme that changes structure rather than just tokens, so it
  // needs to be live state here, not just an attribute on <html>.
  const [theme, setThemeState] = useState(getTheme)
  const press = theme === 'press'
  // Which column the board shows when no other view is open. The Press nav's
  // Apps and Other tabs are both "home", differing only in this.
  const [boardMode, setBoardMode] = useState('apps')
  const isElectron = !!window.wcsElectron
  const isAdmin = user?.staff?.role === 'admin'
  // corporate sees all clubs portal-wide (same as Drive/report gating)
  const seesAllClubs = ['admin', 'corporate'].includes(user?.staff?.role)
  // Effective Marketing Tracker capabilities (tile + tabs + type scope).
  const mAccess = marketingAccess(user)

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  // Appearance changes apply live (Admin Panel -> Appearance dispatches this),
  // so switching into or out of Press swaps the shell without a reload.
  useEffect(() => {
    const onChange = () => setThemeState(getTheme())
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])

  // Admin can push a hard reload to every open tab via Admin Panel.
  // Polls /config/portal-version every 60s.
  useForceRefresh()

  // Audit: fire a view event whenever a major view becomes active. Each one
  // is fire-and-forget through lib/audit.
  useEffect(() => { if (showAdmin) logEvent('view.admin') }, [showAdmin])
  useEffect(() => { if (showCalendar) logEvent('view.calendar') }, [showCalendar])
  useEffect(() => { if (showReporting) logEvent('view.reporting') }, [showReporting])
  useEffect(() => { if (showMarketingTracker) logEvent('view.marketing_tracker') }, [showMarketingTracker])
  useEffect(() => { if (showInventory) logEvent('view.inventory') }, [showInventory])
  useEffect(() => { if (showTrainerAvail) logEvent('view.trainer_availability') }, [showTrainerAvail])
  useEffect(() => { if (showLeaderboard) logEvent('view.leaderboard') }, [showLeaderboard])
  useEffect(() => { if (showCommunicationNotes) logEvent('view.communication_notes') }, [showCommunicationNotes])
  useEffect(() => { if (showHR) logEvent('view.hr') }, [showHR])
  useEffect(() => { if (showHelpCenter) logEvent('view.help_center') }, [showHelpCenter])
  useEffect(() => { if (showTicketsBoard) logEvent('view.tickets') }, [showTicketsBoard])
  useEffect(() => { if (showDrive) logEvent('view.drive') }, [showDrive])
  useEffect(() => { if (showForms) logEvent('view.forms') }, [showForms])
  useEffect(() => { if (showNps) logEvent('view.nps') }, [showNps])

  // Auto-login from stored token (for new tabs like Reporting)
  // Or kiosk auto-login with shared secret
  useEffect(() => {
    if (kioskMode === 'dayone' && kioskKey && !user) {
      api('/auth/kiosk', { method: 'POST', body: JSON.stringify({ key: kioskKey }) })
        .then(data => {
          setToken(data.token, data.refresh_token)
          setUser({ staff: data.staff, visible_tools: [] })
        })
        .catch(() => {})
    } else if (!user && getToken()) {
      getMe().then(meData => {
        setUser(meData)
        // Sync the restored session with the Electron launcher so its main
        // process can populate cachedCredentials. Without this, abc-scraper
        // (and other auto-fill preloads) get null from get-credentials.
        if (window.wcsElectron) {
          window.wcsElectron.onLogin(getToken(), meData.staff?.display_name || meData.staff?.email || '')
        }
      }).catch(() => {
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
        logout()
        setUser(null)
        setShowAdmin(false)
        setShowCalendar(false)
        setShowTrainerAvail(false)
        setShowReporting(false)
        setShowLeaderboard(false)
        setShowCommunicationNotes(false)
        setShowHR(false)
        setShowHelpCenter(false)
        setShowForms(false)
        if (window.wcsElectron) window.wcsElectron.onLogout()
      })
    }
    if (window.wcsElectron?.onNavigate) {
      window.wcsElectron.onNavigate((view) => {
        // Reset all views first
        setShowAdmin(false)
        setShowTrainerAvail(false)
        setShowReporting(false)
        setShowLeaderboard(false)
        setShowCommunicationNotes(false)
        setShowHR(false)
        setShowHelpCenter(false)
        setShowForms(false)
        // Navigate to requested view
        if (view === 'calendar') setShowCalendar(true)
        else setShowCalendar(false)
      })
    }
  }, [])

  // Note: a previous version of this file installed a `beforeunload`
  // handler that called preventDefault on every navigation attempt.
  // In Electron that silently blocks navigation (no confirm dialog
  // like browsers show), which broke the admin "save kiosk config"
  // flow — the launcher would write the new config but the renderer
  // would refuse to navigate to the reloaded URL. Intentionally not
  // re-adding it.

  // When refresh fails (refresh token expired/revoked), drop to login.
  // In kiosk mode, re-trigger the auto-login flow instead of stranding the
  // kiosk on the loading screen.
  useEffect(() => {
    return onAuthExpired(() => {
      setUser(null)
      setShowAdmin(false)
      setShowCalendar(false)
      setShowTrainerAvail(false)
        setShowReporting(false)
      setShowLeaderboard(false)
      setShowCommunicationNotes(false)
      setShowHR(false)
      setShowHelpCenter(false)
      setShowDrive(false)
      setShowForms(false)
      if (kioskMode === 'dayone' && kioskKey) {
        api('/auth/kiosk', { method: 'POST', body: JSON.stringify({ key: kioskKey }) })
          .then(data => {
            setToken(data.token, data.refresh_token)
            setUser({ staff: data.staff, visible_tools: [] })
          })
          .catch(() => {})
      }
    })
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
    setShowLeaderboard(false)
    setShowCommunicationNotes(false)
    setShowHR(false)
    setShowHelpCenter(false)
    setShowForms(false)
    if (window.location.hash) window.location.hash = ''
    // Notify Electron main process about the login
    if (window.wcsElectron) {
      window.wcsElectron.onLogin(getToken(), data.staff?.display_name || data.staff?.email || '')
    }
    setLoading(false)
  }

  function handleLogout() {
    logout()
    setUser(null)
    // Reset all views to homepage
    setShowAdmin(false)
    setShowCalendar(false)
    setShowTrainerAvail(false)
    setShowReporting(false)
    setShowLeaderboard(false)
    setShowCommunicationNotes(false)
    setShowHR(false)
    setShowForms(false)
    // Notify Electron main process about logout
    if (window.wcsElectron) {
      window.wcsElectron.onLogout()
    }
  }

  // In Electron, the launcher's config.json is the source of truth and is
  // pushed in via the `location` query param when the launcher loads the
  // portal. The localStorage `wcs_location_override` is a web-only manual
  // override; trusting it in Electron causes a stale value (set by an
  // earlier admin save) to beat the freshly-loaded URL param.
  const location = isElectron
    ? (locationParam || user?.staff?.locations?.find(l => l.is_primary)?.name || 'Salem')
    : (locationOverride || locationParam || user?.staff?.locations?.find(l => l.is_primary)?.name || 'Salem')

  // Preload background image for instant display
  useEffect(() => {
    const bg = LOCATION_BACKGROUNDS[location.toLowerCase()]
    if (bg) {
      const img = new Image()
      img.src = bg
    }
  }, [location])

  const bgImage = LOCATION_BACKGROUNDS[location.toLowerCase()]
  // Press is a white-ground theme; the full-bleed location photo and its
  // black/60 scrim cannot coexist with it. The login screen keeps the photo
  // either way — that is the one place it still reads as the site's look.
  const shellBg = press ? null : bgImage

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

  const isHome = !showAdmin && !showCalendar && !showTrainerAvail && !showTicketsBoard && !showHelpCenter && !showDrive && !showDriveHub && !showMediaLibrary && !showHR && !showCommunicationNotes && !showLeaderboard && !showReporting && !showMarketingTracker && !showInventory && !showForms && !showNps && !showTourCheckin && !showAdsManager

  function exitImpersonation() {
    setImpersonateId(null)
    window.location.assign('/')
  }

  function handleBackToPortal() {
    setShowAdmin(false)
    setShowCalendar(false)
    setShowTrainerAvail(false)
    setShowReporting(false)
    setShowMarketingTracker(false)
    setShowInventory(false)
    setShowLeaderboard(false)
    setShowCommunicationNotes(false)
    setShowHR(false)
    setShowHelpCenter(false)
    setShowTicketsBoard(false)
    setShowDrive(false)
    // These three are in the isHome check but were never reset here, so going
    // back from Drive Hub / Media Library / Ads Manager left the app in a state
    // that was neither home nor any view.
    setShowDriveHub(false)
    setShowMediaLibrary(false)
    setShowAdsManager(false)
    setShowForms(false)
    setShowNps(false)
    setShowTourCheckin(false)
    if (window.location.hash) window.location.hash = ''
  }

  // Which Press nav tab is lit. Apps and Other are both "home" — they differ
  // only in which column of the board renders — so they fall out of boardMode.
  const activeTab =
    showReporting ? 'reporting'
    : showCalendar ? 'calendar'
    : showLeaderboard ? 'leaderboard'
    : isHome ? boardMode
    : null   // a view opened from the Other board; no tab is current

  // Tiles the Press nav already carries as tabs. The Other board omits them so
  // it is strictly "everything that is not on the bar and not an app".
  const NAV_OWNED_TILES = ['calendar', 'leaderboard', 'reporting']

  function selectTab(key) {
    handleBackToPortal()   // also clears showAdmin
    if (key === 'reporting') {
      window.location.hash = '#reporting'
      setShowReporting(true)
    } else if (key === 'calendar') {
      setShowCalendar(true)
    } else if (key === 'leaderboard') {
      setShowLeaderboard(true)
    } else {
      // 'apps' | 'other' — both land on the board, showing one column or both.
      setBoardMode(key)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col relative">
      {user?.impersonating?.active && (
        <div className="sticky top-0 z-[100] flex items-center justify-center gap-3 bg-wcs-red text-white text-sm font-semibold px-4 py-2">
          <span>👁 Viewing as {user.impersonating.target.name} ({user.impersonating.target.role}) — read-only</span>
          <button type="button" onClick={exitImpersonation} className="underline font-bold">Exit</button>
        </div>
      )}
      <GlobalProgressBar />
      {/* Location background image — persists on all views */}
      {shellBg && (
        <>
          <div className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${shellBg})` }} />
          <div className="fixed inset-0 z-0 bg-black/60" />
        </>
      )}
      {press ? (
        <PortalNav
          active={activeTab}
          onSelect={selectTab}
          onBack={handleBackToPortal}
          onAdmin={() => { handleBackToPortal(); setShowAdmin(true) }}
          onSignOut={handleLogout}
          location={location}
          isAdmin={isAdmin}
          userRole={user?.staff?.role}
          rightSlot={<WhatsNew user={user} bgImage={null} />}
        />
      ) : (
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
          <WhatsNew user={user} bgImage={bgImage} />
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
      )}

      <div className="relative z-10 flex-1 flex flex-col">
      {showAdmin ? (
        <AdminPanel onBack={() => setShowAdmin(false)} isElectron={isElectron} onLocationChange={(loc) => { setLocationOverride(loc); localStorage.setItem('wcs_location_override', loc) }} userRole={user?.staff?.role} />
      ) : showCalendar ? (
        <CalendarView user={user} onBack={() => setShowCalendar(false)} location={location} isAdmin={isAdmin} />
      ) : showTrainerAvail ? (
        <TrainerAvailabilityView user={user} onBack={() => setShowTrainerAvail(false)} location={location} isAdmin={seesAllClubs} />
      ) : showTicketsBoard ? (
        <TicketsBoardView onBack={() => setShowTicketsBoard(false)} user={user} />
      ) : showDriveHub ? (
        <DriveHub
          onBack={() => setShowDriveHub(false)}
          onDrive={() => { setShowDriveHub(false); setShowDrive(true) }}
          onMedia={() => { setShowDriveHub(false); setShowMediaLibrary(true) }}
          canMedia={(user?.visible_tools || []).includes('drive')}
        />
      ) : showDrive ? (
        <DriveView onBack={() => setShowDrive(false)} />
      ) : showHelpCenter ? (
        <HelpCenterView user={user} onBack={() => setShowHelpCenter(false)} />
      ) : showHR ? (
        <HRView user={user} onBack={() => setShowHR(false)} />
      ) : showCommunicationNotes ? (
        <CommunicationNotesView user={user} onBack={() => setShowCommunicationNotes(false)} />
      ) : showLeaderboard ? (
        <LeaderboardView user={user} onBack={() => setShowLeaderboard(false)} location={location} />
      ) : showReporting ? (
        <ReportingView user={user} onBack={() => { window.location.hash = ''; setShowReporting(false) }} location={location} isAdmin={isAdmin} />
      ) : showMarketingTracker ? (
        <MarketingTrackerView access={mAccess} onBack={() => setShowMarketingTracker(false)} />
      ) : showInventory ? (
        <InventoryView onBack={() => setShowInventory(false)} location={location} isAdmin={isAdmin} user={user} />
      ) : showMediaLibrary ? (
        <MediaLibraryView onBack={() => setShowMediaLibrary(false)} userRole={user?.staff?.role} />
      ) : showForms ? (
        <FormsView onBack={handleBackToPortal} me={user.staff} />
      ) : showNps ? (
        <NpsView onBack={handleBackToPortal} />
      ) : showAdsManager && isAdmin ? (
        <AdsManagerView onBack={() => setShowAdsManager(false)} />
      ) : showTourCheckin && isAdmin ? (
        <TourCheckinQueueView location={location} />
      ) : (
        <main className={`flex-1 flex items-start pt-1 pb-12${press ? ' press-single' : ''}`}>
          <ToolGrid only={press ? (boardMode === 'apps' ? 'apps' : 'tools') : undefined} exclude={press ? NAV_OWNED_TILES : undefined} cancelInApps={press} abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onCalendar={() => setShowCalendar(true)} onTrainerAvail={() => setShowTrainerAvail(true)} onLeaderboard={() => setShowLeaderboard(true)} onHR={() => setShowHR(true)} onHelpCenter={() => setShowHelpCenter(true)} onTicketsBoard={() => setShowTicketsBoard(true)} onDrive={() => setShowDriveHub(true)} onCommunicationNotes={() => setShowCommunicationNotes(true)} onReporting={() => { window.location.hash = '#reporting'; setShowReporting(true) }} onMarketingTracker={() => setShowMarketingTracker(true)} onInventory={() => setShowInventory(true)} onForms={() => setShowForms(true)} onNps={() => setShowNps(true)} onTourCheckin={() => setShowTourCheckin(true)} onAdsManager={() => setShowAdsManager(true)} userRole={user.staff?.role} userName={user.staff?.display_name || user.staff?.first_name || ''} marketingAddon={!!user.staff?.marketing_addon} canMarketingTracker={mAccess.tracker} customReports={user.staff?.custom_reports || []} />
        </main>
      )}
      </div>

      <p className="fixed bottom-2 right-3 text-[10px] font-medium text-white/80 bg-black/30 backdrop-blur-sm rounded px-2 py-0.5 select-none pointer-events-none">
        Portal v1.3.7{window.wcsElectron?.version ? ` · App v${window.wcsElectron.version}` : ''}
      </p>

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
