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
import AnalyticsView from './components/AnalyticsView'
import ProfileView from './components/ProfileView'
import GlobalProgressBar from './components/GlobalProgressBar'
import PortalNav from './components/PortalNav'
import UserMenu from './components/UserMenu'
import PinPicker from './components/PinPicker'
import QuickActions from './components/QuickActions'
import PointsChip from './components/PointsChip'
import { getTheme, THEME_EVENT, getBackgroundPrefs } from './lib/theme'
import { getPinned, togglePin, PINNED_EVENT } from './lib/pinnedTabs'
import { useOpenTicketCount } from './lib/useOpenTicketCount'
import { hydrateUiPrefs, startUiPrefsSync } from './lib/uiPrefs'
import { appsForLocation } from './lib/apps'
import { roleAtLeast } from './lib/roles'
import WhatsNew from './components/WhatsNew'
import { getMe, getToken, clearToken, setToken, api, onAuthExpired, logout, setImpersonateId, getTiles } from './lib/api'
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
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [savePrompt, setSavePrompt] = useState(null)
  const [locationOverride, setLocationOverride] = useState(() => localStorage.getItem('wcs_location_override') || '')
  // Press theme swaps the classic header for a persistent top nav (PortalNav).
  // It is the only theme that changes structure rather than just tokens, so it
  // needs to be live state here, not just an attribute on <html>.
  const [theme, setThemeState] = useState(getTheme)
  const press = theme === 'press'
  // The signed URL for a gallery/upload background, from the same
  // GET /ui-preferences hydrateUiPrefs() makes. Kept in memory only — never
  // written to localStorage, since it expires after an hour.
  const [backgroundUrl, setBackgroundUrl] = useState(null)
  const [bgPrefs, setBgPrefs] = useState(getBackgroundPrefs)
  // Which column the board shows when no other view is open. The Press nav's
  // Apps and Tools tabs are both "home", differing only in this.
  const [boardMode, setBoardMode] = useState('apps')
  const [pinned, setPinnedState] = useState(getPinned)
  const [showPinPicker, setShowPinPicker] = useState(false)
  // Custom tiles, for the pin picker only. ToolGrid fetches these too; this is
  // a second read of a small endpoint rather than hoisting the board's whole
  // data flow up here just so a shortcut can be pinned.
  const [pinTiles, setPinTiles] = useState([])
  const isElectron = !!window.wcsElectron
  const isAdmin = user?.staff?.role === 'admin'
  // Tickets waiting on this person, for the count on the pinned Tickets tab.
  // Press-only, since that tab is the only place it is shown; the classic
  // header has no pins. Re-reads when the Tickets view opens or closes, so
  // working a ticket updates the bar on the way back.
  // Declared up here because App returns early for the login screen below.
  const openTickets = useOpenTicketCount(press && !!user, showTicketsBoard)
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

  // The profile page changes the background pref through setBackgroundPrefs,
  // which fires the same event as the theme. Keep bgPrefs live so a change
  // there repaints here without a reload.
  useEffect(() => {
    const onChange = () => setBgPrefs(getBackgroundPrefs())
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])

  // Pins can also change in another tab of the same browser; the event keeps
  // this one honest without a reload.
  useEffect(() => {
    const onChange = () => setPinnedState(getPinned())
    window.addEventListener(PINNED_EVENT, onChange)
    return () => window.removeEventListener(PINNED_EVENT, onChange)
  }, [])

  // Appearance and pins live per USER on the server, so they follow someone to
  // whatever machine they sign in on. localStorage stays as the pre-paint
  // mirror — see lib/uiPrefs.js. Keyed on staff id so switching accounts in the
  // same browser re-hydrates rather than inheriting the previous person's bar.
  useEffect(() => {
    if (!user?.staff?.id) return
    startUiPrefsSync()
    hydrateUiPrefs().then(url => setBackgroundUrl(url || null))
  }, [user?.staff?.id])

  useEffect(() => {
    if (!press || !user?.staff?.id) return
    const locId = user.staff.locations?.find(l => l.is_primary)?.id
    getTiles(locId).then(r => setPinTiles(r.tiles || [])).catch(() => {})
  }, [press, user?.staff?.id])

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
  useEffect(() => { if (showAnalytics) logEvent('view.analytics') }, [showAnalytics])

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
      setShowAnalytics(window.location.hash.startsWith('#analytics'))
      setShowProfile(window.location.hash.startsWith('#profile'))
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
    setShowProfile(false)
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
    setShowProfile(false)
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

  // What the background actually resolves to, in priority order:
  //   none                     -> nothing
  //   gallery / upload         -> the signed URL from the prefs read; if that
  //                               came back null (image deleted, or the URL
  //                               expired) fall back to the club photo rather
  //                               than painting a blank shell
  //   location (the default)   -> the club photo, as it has always been
  //
  // First-paint note: if localStorage's pre-paint mirror already says
  // gallery/upload, the very first render still shows the club photo, because
  // the signed URL cannot exist before the GET /ui-preferences hydrate above
  // resolves. It swaps to the real image within that round trip. This is
  // expected, not a bug.
  const clubPhoto = LOCATION_BACKGROUNDS[location.toLowerCase()]
  const bgImage =
    bgPrefs.background.kind === 'none' ? null
    : (bgPrefs.background.kind === 'gallery' || bgPrefs.background.kind === 'upload')
      ? (backgroundUrl || clubPhoto)
      : clubPhoto
  // Press is a white-ground theme; the full-bleed photo and its scrim cannot
  // coexist with it. The login screen keeps the club photo either way — that
  // is the one place it still reads as the site's look.
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

  const isHome = !showAdmin && !showCalendar && !showTrainerAvail && !showTicketsBoard && !showHelpCenter && !showDrive && !showDriveHub && !showMediaLibrary && !showHR && !showCommunicationNotes && !showLeaderboard && !showReporting && !showMarketingTracker && !showInventory && !showForms && !showNps && !showTourCheckin && !showAdsManager && !showAnalytics && !showProfile

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
    setShowAnalytics(false)
    setShowProfile(false)
    if (window.location.hash) window.location.hash = ''
  }

  // What a Press user may pin, and what pinning it does.
  //
  // Must stay ABOVE activeTab, which reads `pins`. A const referenced before
  // its declaration throws rather than reading undefined, and activeTab only
  // evaluates that branch when a non-tab view is open — so getting this order
  // wrong crashes the whole app the moment a pinned Tool is clicked, while the
  // boards keep working. There is no linter here to catch it.
  //
  // Apps come from lib/apps so a pinned app resolves to exactly the URL the
  // Apps board would have used (the ABC kiosk shim, Milwaukie's Zoho swap).
  // Calendar, Leaderboard and Reporting are absent on purpose: they are already
  // fixed tabs, so pinning one would put the same destination on the bar twice.
  // Anyone who pinned them before this shipped just loses the duplicate — an
  // unresolvable key drops out quietly.
  //
  // Every Tool carries the same gate its board tile has. A pinned tab must
  // never reach a view the user's own board would not have offered; the server
  // gates the data too, but the tab should not be there in the first place.
  const canMedia = (user?.visible_tools || []).includes('drive')
  const PINNABLE = [
    ...appsForLocation({ location, abcUrl }).map(t => ({
      key: 'app:' + t.id, kind: 'app', label: t.label, desc: t.description, url: t.url,
    })),
    // Board apps that are not in tools.json.
    { key: 'app:insights', kind: 'app', label: 'Insights', desc: 'ABC', url: 'https://app.fitnessbi.com/signin', show: roleAtLeast(user?.staff?.role, 'manager') },
    { key: 'app:notifications', kind: 'app', label: 'Send Notifications', desc: 'Member App', url: 'https://westcoaststrength.trainerize.com/app/login', show: roleAtLeast(user?.staff?.role, 'manager') },
    // Custom tiles that are plain links. Group tiles (no url) open a sub-menu
    // inside the board and have nothing to point a tab at, so they are skipped.
    // Mirrors ToolGrid's visibility and manager-only rules.
    ...pinTiles
      .filter(t => t.url)
      .filter(t => {
        if (!user?.visible_tools || user.visible_tools.length === 0) return true
        if (user.visible_tools.includes('tile:' + t.id)) return true
        return !user.visible_tools.some(k => k.startsWith('tile:'))
      })
      .filter(t => !(['indeed', 'operandio', 'vistaprint', 'vista'].includes((t.label || '').toLowerCase())
        && !roleAtLeast(user?.staff?.role, 'manager')))
      .map(t => ({ key: 'app:tile:' + t.id, kind: 'app', label: t.label, desc: t.description || '', url: t.url })),
    { key: 'tool:drive', label: 'Shared Drive', desc: 'Documents', open: () => setShowDriveHub(true) },
    { key: 'tool:media', label: 'Media Library', desc: 'Assets', show: canMedia, open: () => setShowMediaLibrary(true) },
    { key: 'tool:hr', label: 'HR Docs', desc: 'Documents', show: roleAtLeast(user?.staff?.role, 'manager'), open: () => setShowHR(true) },
    { key: 'tool:helpCenter', label: 'Help Center', desc: 'Guides', open: () => setShowHelpCenter(true) },
    { key: 'tool:ticketing', label: 'Tickets', desc: 'Submit & Track', open: () => setShowTicketsBoard(true) },
    { key: 'tool:trainerAvail', label: 'D1 Availability', desc: 'Trainers', open: () => setShowTrainerAvail(true) },
    { key: 'tool:commNotes', label: 'Comm Notes', desc: 'Member notes', open: () => setShowCommunicationNotes(true) },
    { key: 'tool:inventory', label: 'Inventory', desc: 'Stock', open: () => setShowInventory(true) },
    { key: 'tool:forms', label: 'Forms', desc: 'Signups', open: () => setShowForms(true) },
    { key: 'tool:nps', label: 'Feedback', desc: 'Member surveys', open: () => setShowNps(true) },
    { key: 'tool:marketingTracker', label: 'Marketing', desc: 'Campaigns', icon: 'reporting', show: mAccess.tracker, open: () => setShowMarketingTracker(true) },
    { key: 'tool:tourCheckin', label: 'Tour Queue', desc: 'Check-ins', show: isAdmin, open: () => setShowTourCheckin(true) },
    { key: 'tool:adsManager', label: 'Ads Manager', desc: 'Meta', show: isAdmin, open: () => setShowAdsManager(true) },
    { key: 'tool:analytics', label: 'Analytics', desc: 'Admin Reports', icon: 'reporting', show: isAdmin, open: () => { window.location.hash = '#analytics'; setShowAnalytics(true) } },
  ]
    .map(item => (item.kind ? item : { ...item, kind: 'tool' }))
    .filter(item => item.show !== false)

  // Resolve saved keys to catalog entries, dropping any that no longer apply —
  // a role change or a retired tool should quietly lose its tab, not crash.
  // Tools get handleBackToPortal first so pinning behaves like a tab, not a
  // stack: you land on the view, never underneath whatever was already open.
  const pins = pinned
    .map(key => PINNABLE.find(p => p.key === key))
    .filter(Boolean)
    .map(p => (p.kind === 'app' ? p : { ...p, open: () => { handleBackToPortal(); p.open() } }))
    // Counts are per-pin rather than a prop on the nav, so a second tab that
    // wants one later is a line here and nothing else.
    .map(p => (p.key === 'tool:ticketing' && openTickets ? { ...p, badge: openTickets } : p))

  // Which view is open, named the way the pin catalog names it, so a pinned
  // tab can light up when you are inside it.
  // Calendar, Leaderboard and Reporting are absent: they are fixed tabs, so
  // activeTab resolves them above without ever consulting this.
  const openViewKey =
    showDriveHub ? 'tool:drive'
    : showMediaLibrary ? 'tool:media'
    : showHR ? 'tool:hr'
    : showHelpCenter ? 'tool:helpCenter'
    : showTicketsBoard ? 'tool:ticketing'
    : showTrainerAvail ? 'tool:trainerAvail'
    : showCommunicationNotes ? 'tool:commNotes'
    : showInventory ? 'tool:inventory'
    : showForms ? 'tool:forms'
    : showNps ? 'tool:nps'
    : showMarketingTracker ? 'tool:marketingTracker'
    : showTourCheckin ? 'tool:tourCheckin'
    : showAdsManager ? 'tool:adsManager'
    : showAnalytics ? 'tool:analytics'
    : null

  // Which Press nav tab is lit. Apps and Tools are both "home" — they differ
  // only in which column of the board renders — so they fall out of boardMode.
  // A view that is open but has no tab leaves activeTab null, which is what
  // puts the Back chip in the nav — see the invariant in PortalNav.
  const activeTab =
    showReporting ? 'reporting'
    : showCalendar ? 'calendar'
    : showLeaderboard ? 'leaderboard'
    : isHome ? boardMode
    : (openViewKey && pins.some(p => p.key === openViewKey)) ? openViewKey
    : null

  // Tiles the Press nav already carries as tabs. The Tools board omits them so
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
      // 'apps' | 'tools' — both land on the board, showing one column each.
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
          <div className="fixed inset-0 z-0 bg-black" style={{ opacity: bgPrefs.backgroundDim / 100 }} />
        </>
      )}
      {press ? (
        <PortalNav
          active={activeTab}
          onSelect={selectTab}
          onBack={handleBackToPortal}
          pins={pins}
          onOpenPicker={() => setShowPinPicker(true)}
          onAdmin={() => { handleBackToPortal(); setShowAdmin(true) }}
          onSignOut={handleLogout}
          onProfile={() => { window.location.hash = '#profile'; setShowProfile(true) }}
          userName={user?.staff?.display_name || user?.staff?.email}
          location={location}
          isAdmin={isAdmin}
          userRole={user?.staff?.role}
          rightSlot={<WhatsNew user={user} bgImage={null} />}
          points={
            // Rank and points used to sit in the board's banner strip, which
            // Press drops. Same audience as that strip and as Quick Actions:
            // below corporate. Clicking opens the Leaderboard.
            roleAtLeast(user?.staff?.role, 'corporate')
              ? null
              : <PointsChip location={location} onOpen={() => selectTab('leaderboard')} />
          }
          quickActions={
            // Book Gym Tour / Book Day Ones / Submit VIPs used to sit in the
            // board's banner strip, which Press drops. Same audience as before:
            // the strip was hidden from corporate and above, so directors and
            // admins never had these. QuickActions hides itself when the club
            // has none of the three URLs configured.
            roleAtLeast(user?.staff?.role, 'corporate') ? null : <QuickActions location={location} />
          }
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
          <UserMenu
            name={user?.staff?.display_name || user?.staff?.email}
            variant={bgImage ? 'photo' : 'plain'}
            onProfile={() => { window.location.hash = '#profile'; setShowProfile(true) }}
            onSignOut={handleLogout}
          />
        </div>
      </header>
      )}

      <div className="relative z-10 flex-1 flex flex-col">
      {showAdmin ? (
        <AdminPanel onBack={() => setShowAdmin(false)} isElectron={isElectron} onLocationChange={(loc) => { setLocationOverride(loc); localStorage.setItem('wcs_location_override', loc) }} userRole={user?.staff?.role} />
      ) : showProfile ? (
        <ProfileView user={user} onBackgroundUrlChange={setBackgroundUrl} />
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
      ) : showAnalytics && isAdmin ? (
        <AnalyticsView user={user} onBack={() => { window.location.hash = ''; setShowAnalytics(false) }} location={location} isAdmin={isAdmin} />
      ) : showAdsManager && isAdmin ? (
        <AdsManagerView onBack={() => setShowAdsManager(false)} />
      ) : showTourCheckin && isAdmin ? (
        <TourCheckinQueueView location={location} />
      ) : (
        <main className={`flex-1 flex items-start pt-1 pb-12${press ? ' press-single' : ''}`}>
          <ToolGrid only={press ? (boardMode === 'apps' ? 'apps' : 'tools') : undefined} exclude={press ? NAV_OWNED_TILES : undefined} cancelInApps={press} driveInTools={press} abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onCalendar={() => setShowCalendar(true)} onTrainerAvail={() => setShowTrainerAvail(true)} onLeaderboard={() => setShowLeaderboard(true)} onHR={() => setShowHR(true)} onHelpCenter={() => setShowHelpCenter(true)} onTicketsBoard={() => setShowTicketsBoard(true)} onDrive={() => setShowDriveHub(true)} onCommunicationNotes={() => setShowCommunicationNotes(true)} onReporting={() => { window.location.hash = '#reporting'; setShowReporting(true) }} onMarketingTracker={() => setShowMarketingTracker(true)} onInventory={() => setShowInventory(true)} onForms={() => setShowForms(true)} onNps={() => setShowNps(true)} onTourCheckin={() => setShowTourCheckin(true)} onAdsManager={() => setShowAdsManager(true)} onAnalytics={() => { window.location.hash = '#analytics'; setShowAnalytics(true) }} userRole={user.staff?.role} userName={user.staff?.display_name || user.staff?.first_name || ''} marketingAddon={!!user.staff?.marketing_addon} canMarketingTracker={mAccess.tracker} customReports={user.staff?.custom_reports || []} />
        </main>
      )}
      </div>

      <p className="fixed bottom-2 right-3 text-[10px] font-medium text-white/80 bg-black/30 backdrop-blur-sm rounded px-2 py-0.5 select-none pointer-events-none">
        Portal v1.3.7{window.wcsElectron?.version ? ` · App v${window.wcsElectron.version}` : ''}
      </p>

      {press && showPinPicker && (
        <PinPicker
          catalog={PINNABLE}
          pinned={pinned}
          onToggle={(key) => setPinnedState(togglePin(key))}
          onClose={() => setShowPinPicker(false)}
        />
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
