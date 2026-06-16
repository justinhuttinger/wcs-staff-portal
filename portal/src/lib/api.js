import * as apiCache from './apiCache'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
// Second backend service — prospects-documents (Render). Hosts the Online
// Join admin + public API. Same Supabase JWT works as the auth header.
const PROSPECTS_API_URL = import.meta.env.VITE_PROSPECTS_API_URL || 'https://prospects-documents.onrender.com'

let authToken = null
let refreshToken = null

// In-flight request counter for the global progress bar. Subscribers receive
// the current count after every change.
let pendingCount = 0
const pendingListeners = new Set()

function notifyPending() {
  for (const fn of pendingListeners) {
    try { fn(pendingCount) } catch {}
  }
}

export function onPendingChange(fn) {
  pendingListeners.add(fn)
  // Fire once so a fresh subscriber sees the current state.
  try { fn(pendingCount) } catch {}
  return () => pendingListeners.delete(fn)
}

export function getPendingCount() {
  return pendingCount
}

function incrementPending() {
  pendingCount++
  notifyPending()
}
function decrementPending() {
  pendingCount = Math.max(0, pendingCount - 1)
  notifyPending()
}

// Restore tokens from localStorage (for new tabs like Reporting)
try {
  const storedToken = localStorage.getItem('wcs_token')
  if (storedToken) authToken = storedToken
  const storedRefresh = localStorage.getItem('wcs_refresh_token')
  if (storedRefresh) refreshToken = storedRefresh
} catch {}

export function setToken(token, refresh) {
  authToken = token
  try { localStorage.setItem('wcs_token', token) } catch {}
  if (refresh !== undefined) {
    refreshToken = refresh
    try {
      if (refresh) localStorage.setItem('wcs_refresh_token', refresh)
      else localStorage.removeItem('wcs_refresh_token')
    } catch {}
  }
  // Sync the new access token to the Electron main process so its vault
  // calls and tour-notifier keep working past the original 1hr expiry.
  try {
    if (typeof window !== 'undefined' && window.wcsElectron?.onTokenRefreshed) {
      window.wcsElectron.onTokenRefreshed(token)
    }
  } catch {}
}

export function getToken() {
  return authToken
}

export function clearToken() {
  authToken = null
  refreshToken = null
  try {
    localStorage.removeItem('wcs_token')
    localStorage.removeItem('wcs_refresh_token')
  } catch {}
  // Drop any cached responses from the previous session so the next user
  // doesn't see leftover data.
  apiCache.clear()
}

// Listeners for auth expiry (refresh failed) so the UI can redirect to login
const authExpiredListeners = new Set()
export function onAuthExpired(fn) {
  authExpiredListeners.add(fn)
  return () => authExpiredListeners.delete(fn)
}

// Dedupe concurrent refreshes — when many parallel requests 401, only one
// refresh call should hit the server; the rest await the same promise.
let refreshInFlight = null

async function attemptRefresh() {
  if (refreshInFlight) return refreshInFlight

  // Re-read from localStorage in case another tab rotated the refresh token.
  // Supabase invalidates refresh tokens on use, so a stale in-memory copy
  // would fail and bounce the user to login unnecessarily.
  let latestRefresh = refreshToken
  try {
    const stored = localStorage.getItem('wcs_refresh_token')
    if (stored) latestRefresh = stored
  } catch {}
  if (!latestRefresh) return null

  refreshInFlight = (async () => {
    try {
      const res = await fetch(API_URL + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: latestRefresh }),
      })
      if (!res.ok) return null
      const data = await res.json()
      if (!data?.token) return null
      setToken(data.token, data.refresh_token)
      return data.token
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

export async function api(path, options = {}) {
  // Cache opt-in. When `cache: true` and the endpoint is configured in
  // apiCache.TTL_BY_PATH, we serve any existing entry immediately
  // (stale-while-revalidate). If it's still fresh, skip the network entirely.
  // If it's stale, we kick off the network refresh below and replace on
  // resolve — but for v1 we keep this synchronous-from-the-caller's-view:
  // we await the fresh result and let the cached value be used by the
  // optional progressive-render path in useCancellableFetch.
  // Mutating requests (POST/PUT/PATCH/DELETE) never cache.
  const method = (options.method || 'GET').toUpperCase()
  const wantsCache = options.cache === true && method === 'GET' && apiCache.isCacheable(path)
  if (wantsCache) {
    const hit = apiCache.get(path)
    if (hit && hit.fresh) return hit.value
  }

  const doFetch = () => fetchWithAuthAndRetry(path, options)
  incrementPending()
  try {
    const result = await doFetch()
    if (wantsCache) apiCache.set(path, result)
    return result
  } finally {
    decrementPending()
  }
}

// Internal: the actual network logic (auth header, refresh-on-401, JSON
// parse). Extracted so api() can wrap it with caching + progress counting
// without duplicating the auth flow.
async function fetchWithAuthAndRetry(path, options) {
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers = { ...options.headers }
  if (!isFormDataBody) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
  }
  if (authToken) {
    headers['Authorization'] = 'Bearer ' + authToken
  }

  // Drop our custom options before passing to fetch.
  const { cache: _cache, ...restOptions } = options
  const fetchOptions = { ...restOptions, headers }
  if (options.signal) fetchOptions.signal = options.signal

  const res = await fetch(API_URL + path, fetchOptions)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Server error — please try again')
  }

  // 401 handling: try refresh + retry once. If refresh fails, sign out.
  // Skip auth endpoints themselves so we never loop.
  const isAuthEndpoint = path === '/auth/login' || path === '/auth/refresh' || path === '/auth/kiosk'
  if (res.status === 401 && authToken && !isAuthEndpoint) {
    const newToken = await attemptRefresh()
    if (newToken) {
      const retryHeaders = { ...headers, Authorization: 'Bearer ' + newToken }
      const retryRes = await fetch(API_URL + path, { ...fetchOptions, headers: retryHeaders })
      let retryData
      try {
        retryData = await retryRes.json()
      } catch {
        throw new Error('Server error — please try again')
      }
      if (!retryRes.ok) {
        throw new Error(retryData.error || 'Request failed')
      }
      return retryData
    }
    clearToken()
    authExpiredListeners.forEach(fn => fn())
    throw new Error('Session expired — please sign in again')
  }

  if (!res.ok) {
    throw new Error(data.error || 'Request failed')
  }

  return data
}

/**
 * Same fetch shape as `api()` but targets the prospects-documents service.
 * No refresh-retry here — admin endpoints are infrequent; a 401 just bubbles.
 */
export async function prospectsApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const res = await fetch(PROSPECTS_API_URL + path, { ...options, headers })
  let data
  try { data = await res.json() } catch { throw new Error('Server error — please try again') }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

// ---- Online Join admin (prospects-documents) -----------------------------
export const onlineJoin = {
  // Locations
  listLocations: () => prospectsApi('/api/admin/online-join/locations'),
  getLocation: (id) => prospectsApi(`/api/admin/online-join/locations/${id}`),
  createLocation: (body) => prospectsApi('/api/admin/online-join/locations', { method: 'POST', body: JSON.stringify(body) }),
  updateLocation: (id, body) => prospectsApi(`/api/admin/online-join/locations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivateLocation: (id) => prospectsApi(`/api/admin/online-join/locations/${id}`, { method: 'DELETE' }),

  // Membership types (parent of plans)
  listTypes: (location) => prospectsApi('/api/admin/online-join/types' + (location ? `?location=${encodeURIComponent(location)}` : '')),
  getType: (id) => prospectsApi(`/api/admin/online-join/types/${id}`),
  createType: (body) => prospectsApi('/api/admin/online-join/types', { method: 'POST', body: JSON.stringify(body) }),
  updateType: (id, patch) => prospectsApi(`/api/admin/online-join/types/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deactivateType: (id) => prospectsApi(`/api/admin/online-join/types/${id}`, { method: 'DELETE' }),

  // Plans
  listPlans: (location, type) => prospectsApi('/api/admin/online-join/plans' + (() => {
    const qs = new URLSearchParams()
    if (location) qs.set('location', location)
    if (type) qs.set('type', type)
    const s = qs.toString()
    return s ? `?${s}` : ''
  })()),
  listPlansByType: (typeId) => prospectsApi('/api/admin/online-join/plans' + (typeId ? `?type=${encodeURIComponent(typeId)}` : '')),
  getPlan: (id) => prospectsApi(`/api/admin/online-join/plans/${id}`),
  createPlan: (body) => prospectsApi('/api/admin/online-join/plans', { method: 'POST', body: JSON.stringify(body) }),
  updatePlan: (id, body) => prospectsApi(`/api/admin/online-join/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivatePlan: (id) => prospectsApi(`/api/admin/online-join/plans/${id}`, { method: 'DELETE' }),

  // Age rules
  listAgeRules: () => prospectsApi('/api/admin/online-join/age-rules'),
  getAgeRule: (id) => prospectsApi(`/api/admin/online-join/age-rules/${id}`),
  createAgeRule: (body) => prospectsApi('/api/admin/online-join/age-rules', { method: 'POST', body: JSON.stringify(body) }),
  updateAgeRule: (id, body) => prospectsApi(`/api/admin/online-join/age-rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAgeRule: (id) => prospectsApi(`/api/admin/online-join/age-rules/${id}`, { method: 'DELETE' }),

  // Copy
  listCopy: () => prospectsApi('/api/admin/online-join/copy'),
  updateCopy: (key, copy_value) => prospectsApi(`/api/admin/online-join/copy/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ copy_value }) }),

  // Signups (read-only)
  listSignups: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return prospectsApi('/api/admin/online-join/signups' + (qs ? '?' + qs : ''))
  },
  getSignup: (id) => prospectsApi(`/api/admin/online-join/signups/${id}`),

  // ABC plan discovery (used by Plans editor "Pull from ABC")
  abcPlans: (clubNumber) => prospectsApi(`/api/admin/online-join/abc-plans/${encodeURIComponent(clubNumber)}`),
  abcPlanDetails: (clubNumber, planId) => prospectsApi(`/api/admin/online-join/abc-plans/${encodeURIComponent(clubNumber)}/${encodeURIComponent(planId)}`),

  invalidateCache: () => prospectsApi('/api/admin/online-join/cache/invalidate', { method: 'POST' }),
}

// ---- Paychex Training admin (prospects-documents) ------------------------
export const paychexTraining = {
  summary: () => prospectsApi('/api/admin/paychex-training/summary'),
  records: (params = {}) => {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    )
    const qs = new URLSearchParams(filtered).toString()
    return prospectsApi('/api/admin/paychex-training/records' + (qs ? '?' + qs : ''))
  },
  reports: (limit = 25) => prospectsApi(`/api/admin/paychex-training/reports?limit=${limit}`),
  courses: () => prospectsApi('/api/admin/paychex-training/courses'),
  locations: () => prospectsApi('/api/admin/paychex-training/locations'),
  refreshLocations: () => prospectsApi('/api/admin/paychex-training/refresh-locations', { method: 'POST' }),
}

export async function login(email, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.token, data.refresh_token)
  return data
}

// Best-effort server logout (clears wcs_session cookie + revokes Supabase
// session). Always clears local state, even if the network call fails.
// Fire-and-forget on the server side so the UI doesn't wait.
export function logout() {
  const token = authToken
  try {
    fetch(API_URL + '/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    }).catch(() => {})
  } catch {}
  clearToken()
}

export async function changePassword(newPassword) {
  return api('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export async function resetPassword(email) {
  return api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function getMe() {
  return api('/auth/me')
}

// Admin - Staff
export async function getStaff() {
  return api('/admin/staff')
}

export async function createStaff(data) {
  return api('/admin/staff', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateStaff(id, data) {
  return api('/admin/staff/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteStaff(id) {
  return api('/admin/staff/' + id, { method: 'DELETE' })
}

// Admin - Bulk Import
export async function downloadStaffTemplate() {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const res = await fetch(API_URL + '/admin/staff/template', { headers })
  if (!res.ok) throw new Error('Failed to download template')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'wcs-staff-import-template.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

// Admin - ABC Employee Roster export. Returns one .xlsx with a tab per
// location for managers to mark who is still employed and who isn't.
export async function downloadEmployeeRoster({ activeOnly = false, clubs = null } = {}) {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const params = new URLSearchParams()
  if (activeOnly) params.set('active-only', '1')
  if (clubs && clubs.length) params.set('clubs', clubs.join(','))
  const qs = params.toString()
  const url = `${API_URL}/admin/exports/abc-employee-roster.xlsx${qs ? '?' + qs : ''}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to download employee roster (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = 'abc-employee-roster.xlsx'
  a.click()
  URL.revokeObjectURL(blobUrl)
}

// 12-Month Trends Excel export. `locationSlug` is 'all' or comma-separated
// slugs (matches LocationMultiSelect value shape). `endMonth` is YYYY-MM or
// null (server defaults to current month).
export async function downloadTrends12moReport({ locationSlug = 'all', endMonth = null } = {}) {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const params = new URLSearchParams()
  if (locationSlug && locationSlug !== 'all') params.set('location_slug', locationSlug)
  if (endMonth) params.set('end_month', endMonth)
  const qs = params.toString()
  const url = `${API_URL}/admin/exports/trends-12mo.xlsx${qs ? '?' + qs : ''}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error || text } catch { /* leave text */ }
    throw new Error(msg || `Failed to generate trends report (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  const monthLabel = endMonth || new Date().toISOString().slice(0, 7)
  a.download = `WCS-Trends-12mo-${monthLabel}.xlsx`
  a.click()
  URL.revokeObjectURL(blobUrl)
}

export async function importStaff(file) {
  const headers = { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const res = await fetch(API_URL + '/admin/staff/import', {
    method: 'POST',
    headers,
    body: file,
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error || 'Import failed'), { data })
  return data
}

// Config - Tiles
export async function getTiles(locationId) {
  const qs = locationId ? '?location_id=' + locationId : ''
  return api('/config/tiles' + qs)
}

export async function createTile(data) {
  return api('/config/tiles', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateTile(id, data) {
  return api('/config/tiles/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteTile(id) {
  return api('/config/tiles/' + id, { method: 'DELETE' })
}

// Config - Locations
export async function getLocations() {
  return api('/config/locations')
}

// Launcher installs (kiosk registry) + one-time location deep links
export async function getKioskInstalls() {
  return api('/launcher/installs')
}

export async function setKioskInstallTarget(id, data) {
  return api('/launcher/installs/' + id, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteKioskInstall(id) {
  return api('/launcher/installs/' + id, { method: 'DELETE' })
}

export async function getKioskLinks() {
  return api('/launcher/links')
}

export async function createKioskLink(data) {
  return api('/launcher/links', { method: 'POST', body: JSON.stringify(data) })
}

// Config - Role Visibility
export async function getRoleVisibility() {
  return api('/config/role-visibility')
}

export async function updateRoleVisibility(updates) {
  return api('/config/role-visibility', {
    method: 'PUT',
    body: JSON.stringify({ updates }),
  })
}

// Appointments
export async function getAppointments(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/appointments' + (qs ? '?' + qs : ''))
}

// Tours
export async function getTours(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/tours' + (qs ? '?' + qs : ''))
}

// Reports
export async function getMembershipReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/membership' + (qs ? '?' + qs : ''), options)
}

export async function getSpeedToLead(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/speed-to-lead' + (qs ? '?' + qs : ''), options)
}

export async function getSpeedToLeadAudit(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/speed-to-lead/audit' + (qs ? '?' + qs : ''), options)
}

export async function getMembershipAudit(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/membership-audit' + (qs ? '?' + qs : ''), options)
}

export async function getPTReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt' + (qs ? '?' + qs : ''), options)
}

export async function getPTRoster(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-roster' + (qs ? '?' + qs : ''), options)
}

export async function getPTNewClients(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-new-clients' + (qs ? '?' + qs : ''), options)
}

export async function getSessionFrequency(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/session-frequency' + (qs ? '?' + qs : ''), options)
}

export async function getDeactivatedPT(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/deactivated-pt' + (qs ? '?' + qs : ''), options)
}

export async function getDeactivatedPTMember({ memberId, locationSlug }, options = {}) {
  const qs = new URLSearchParams({ location_slug: locationSlug }).toString()
  return api(`/reports/deactivated-pt/member/${encodeURIComponent(memberId)}?${qs}`, options)
}

export async function getPTHealth(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-health' + (qs ? '?' + qs : ''), options)
}

export async function getVIPReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/vip' + (qs ? '?' + qs : ''), options)
}

export async function getSalespersonStats(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/salesperson-stats' + (qs ? '?' + qs : ''), options)
}

export async function getClubHealthReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/club-health' + (qs ? '?' + qs : ''), options)
}

export async function getCancelsReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/cancels' + (qs ? '?' + qs : ''), options)
}

export async function getCheckinsReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/checkins' + (qs ? '?' + qs : ''), options)
}

export async function getPTSessionsReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-sessions' + (qs ? '?' + qs : ''), options)
}

export async function getPTSessionsTrainer(employeeId, params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api(`/reports/pt-sessions/trainer/${encodeURIComponent(employeeId)}` + (qs ? '?' + qs : ''), options)
}

export async function getPayrollReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/payroll' + (qs ? '?' + qs : ''), options)
}

export async function exportPayrollToSheet(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/payroll/export-sheet' + (qs ? '?' + qs : ''), {
    method: 'POST',
  })
}

// ---- Per-user Google Sheets connection ----
export async function getGoogleSheetsStatus() {
  return api('/google-sheets/status')
}

export async function startGoogleSheetsAuth() {
  return api('/google-sheets/authorize-url', { method: 'POST' })
}

export async function disconnectGoogleSheets() {
  return api('/google-sheets/disconnect', { method: 'POST' })
}

export async function getSyncStatus() {
  return api('/sync-status')
}

export async function isSyncRunning() {
  try {
    const data = await api('/sync-status')
    return data.abc_sync_running || false
  } catch { return false }
}

// Referral Rewards
export async function getReferralRewards({ needsReview = false } = {}) {
  const q = needsReview ? '?needs_review=true' : ''
  return api(`/referral-rewards${q}`)
}

export async function resolveReferralReward(id) {
  return api(`/referral-rewards/${id}/resolve`, { method: 'POST' })
}

// Marketing Tracker
export async function getMarketingEfforts(params = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api('/marketing-tracker' + (qs ? '?' + qs : ''))
}

export async function createMarketingEffort(data) {
  return api('/marketing-tracker', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateMarketingEffort(id, data) {
  return api('/marketing-tracker/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteMarketingEffort(id) {
  return api('/marketing-tracker/' + id, { method: 'DELETE' })
}

export async function updateMarketingEffortStatus(id, status) {
  return api('/marketing-tracker/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) })
}

export async function getMarketingEffortComments(id) {
  return api('/marketing-tracker/' + id + '/comments')
}

export async function addMarketingEffortComment(id, body) {
  return api('/marketing-tracker/' + id + '/comments', { method: 'POST', body: JSON.stringify({ body }) })
}

export async function getMarketingDriveFolder(folderId) {
  return api('/marketing-tracker/drive-folder?folder_id=' + encodeURIComponent(folderId))
}

export async function uploadMarketingAsset(file) {
  const fd = new FormData()
  fd.append('file', file)
  return api('/marketing-tracker/upload', { method: 'POST', body: fd })
}

// Inventory (experimental)
function inventoryQs(params = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return qs ? '?' + qs : ''
}

export async function getInventoryItems(params = {}) {
  return api('/inventory/items' + inventoryQs(params))
}

export async function getInventoryCategories() {
  return api('/inventory/items/categories')
}

export async function lookupInventoryUpc(code, params = {}) {
  return api('/inventory/upc/' + encodeURIComponent(code) + inventoryQs(params))
}

export async function getInventoryItemMovements(id) {
  return api('/inventory/items/' + id + '/movements')
}

export async function adjustInventoryItem(id, data) {
  return api('/inventory/items/' + id + '/adjust', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateInventoryItem(id, data) {
  return api('/inventory/items/' + id, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function getInventoryTransactions(params = {}) {
  return api('/inventory/transactions' + inventoryQs(params))
}

export async function getInventorySummary(params = {}) {
  return api('/inventory/summary' + inventoryQs(params))
}

export async function getInventoryInvoices() {
  return api('/inventory/invoices')
}

export async function createInventoryInvoice(fields, file) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v)
  }
  if (file) fd.append('file', file)
  return api('/inventory/invoices', { method: 'POST', body: fd })
}

export async function addInventoryInvoiceItem(invoiceId, data) {
  return api('/inventory/invoices/' + invoiceId + '/items', { method: 'POST', body: JSON.stringify(data) })
}

export async function deleteInventoryInvoiceItem(invoiceId, lineId) {
  return api('/inventory/invoices/' + invoiceId + '/items/' + lineId, { method: 'DELETE' })
}

export async function receiveInventoryInvoice(invoiceId) {
  return api('/inventory/invoices/' + invoiceId + '/receive', { method: 'POST' })
}

export async function deleteInventoryInvoice(invoiceId) {
  return api('/inventory/invoices/' + invoiceId, { method: 'DELETE' })
}

export async function startInventorySync(kind = 'all', locationSlug) {
  return api('/inventory/sync', { method: 'POST', body: JSON.stringify({ kind, location_slug: locationSlug }) })
}

export async function getInventorySyncStatus() {
  return api('/inventory/sync-status')
}

export async function getInventoryAudit(params = {}) {
  return api('/inventory/audit' + inventoryQs(params))
}

// Day One Tracker
export async function getDayOneTrackerAppointments(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/day-one-tracker/appointments' + (qs ? '?' + qs : ''))
}

export async function submitDayOneResult(data) {
  return api('/day-one-tracker/submit', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getDayOneFieldOptions(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/day-one-tracker/field-options' + (qs ? '?' + qs : ''))
}

// Trainer Availability
export async function getTrainerAvailability(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/trainer-availability' + (qs ? '?' + qs : ''))
}

export async function updateTrainerAvailability(calendarId, data) {
  return api('/trainer-availability/' + calendarId, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function updateTrainerPriority({ location_slug, calendarId, userId, priority }) {
  return api('/trainer-availability/priority', {
    method: 'PUT',
    body: JSON.stringify({ location_slug, calendarId, userId, priority }),
  })
}

// SMS History
export async function getSMSMessages(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/sms-history/messages' + (qs ? '?' + qs : ''))
}

export async function syncSMSMessages(data = {}) {
  return api('/sms-history/sync', { method: 'POST', body: JSON.stringify(data) })
}

export async function searchSMSHistory(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/sms-history/search' + (qs ? '?' + qs : ''))
}

// Leaderboard
export async function getLeaderboard(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/leaderboard' + (qs ? '?' + qs : ''))
}

// Meta Ads
export async function getMetaAdsOverview(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/overview' + (qs ? '?' + qs : ''), options)
}

export async function getMetaAdsCampaigns(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/campaigns' + (qs ? '?' + qs : ''), options)
}

export async function getMetaAdsDaily(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/daily' + (qs ? '?' + qs : ''), options)
}

export async function getMetaAdsets(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/adsets' + (qs ? '?' + qs : ''), options)
}

export async function getMetaAds(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/ads' + (qs ? '?' + qs : ''), options)
}

// FB ROAS — own-calculated from GHL 'sale' tag × $990 LTV ÷ Meta spend
export async function getFbRoas(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/fb-roas' + (qs ? '?' + qs : ''))
}

// Google Business Profile
export async function getGoogleBusinessStatus() {
  return api('/google-business/status')
}

export async function getGoogleBusinessLocations() {
  return api('/google-business/locations')
}

export async function getGoogleBusinessPerformance(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/google-business/performance' + (qs ? '?' + qs : ''), options)
}

// Google Analytics 4
export async function getGoogleAnalyticsStatus() {
  return api('/google-analytics/status')
}

function gaQuery(path, params = {}, options = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api(path + (qs ? '?' + qs : ''), options)
}

export async function getGoogleAnalyticsOverview(params = {}, options = {}) {
  return gaQuery('/google-analytics/overview', params, options)
}

export async function getGoogleAnalyticsSources(params = {}, options = {}) {
  return gaQuery('/google-analytics/sources', params, options)
}

export async function getGoogleAnalyticsPages(params = {}, options = {}) {
  return gaQuery('/google-analytics/pages', params, options)
}

export async function getGoogleAnalyticsDevicesGeo(params = {}, options = {}) {
  return gaQuery('/google-analytics/devices-geo', params, options)
}

export async function getGoogleAnalyticsKeyEvents(params = {}, options = {}) {
  return gaQuery('/google-analytics/key-events', params, options)
}

// Operandio
export async function getOperandioLatest() {
  return api('/operandio/latest')
}

// Revenue
export async function getRevenueSummary(params = {}, options = {}) {
  const qs = new URLSearchParams()
  if (params.start_date) qs.set('start_date', params.start_date)
  if (params.end_date) qs.set('end_date', params.end_date)
  if (params.location_slug) qs.set('location_slug', params.location_slug)
  return api(`/reports/revenue/summary?${qs.toString()}`, options)
}

export async function getRevenueProfitCenterTrend(params = {}, options = {}) {
  const qs = new URLSearchParams()
  if (params.start_date) qs.set('start_date', params.start_date)
  if (params.end_date) qs.set('end_date', params.end_date)
  if (params.location_slug) qs.set('location_slug', params.location_slug)
  if (params.profit_center) qs.set('profit_center', params.profit_center)
  return api(`/reports/revenue/profit-center-trend?${qs.toString()}`, options)
}

// 12-month MTD comparison for one profit center. Each monthly bucket uses the
// same day-of-month as end_date as its cutoff (capped to the last day of the
// month for shorter months).
export async function getRevenueProfitCenterMtdTrend(params = {}, options = {}) {
  const qs = new URLSearchParams()
  if (params.end_date) qs.set('end_date', params.end_date)
  if (params.location_slug) qs.set('location_slug', params.location_slug)
  if (params.profit_center) qs.set('profit_center', params.profit_center)
  return api(`/reports/revenue/profit-center-mtd-trend?${qs.toString()}`, options)
}

export async function getRevenueImports(limit = 20) {
  return api(`/reports/revenue/imports?limit=${limit}`)
}

export async function uploadRevenueCsv(file) {
  const fd = new FormData()
  fd.append('file', file)
  return api('/revenue/upload', { method: 'POST', body: fd })
}

// Drive Folders
export async function getDriveFolders() {
  return api('/drive-folders')
}
export async function listDriveContents(folderId, { refresh = false } = {}) {
  const params = new URLSearchParams({ folder_id: folderId })
  if (refresh) params.set('refresh', '1')
  return api('/drive-folders/list?' + params.toString())
}
export async function searchDrive(rootId, query) {
  const qs = new URLSearchParams({ root_id: rootId, q: query }).toString()
  return api('/drive-folders/search?' + qs)
}
export async function getDriveFileMeta(fileId) {
  return api('/drive-folders/file?file_id=' + encodeURIComponent(fileId))
}

// Returns a Blob of the file's bytes (Google Workspace files exported to PDF).
// Uses raw fetch so the binary body is preserved.
export async function fetchDriveFileBlob(fileId) {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const res = await fetch(API_URL + '/drive-folders/file-content?file_id=' + encodeURIComponent(fileId), { headers })
  if (!res.ok) {
    let msg = 'Failed to fetch file'
    try { const j = await res.json(); msg = j.error || msg } catch {}
    throw new Error(msg)
  }
  return await res.blob()
}
export async function getDriveFoldersAdmin() {
  return api('/drive-folders/admin')
}
export async function createDriveFolder(payload) {
  return api('/drive-folders', { method: 'POST', body: JSON.stringify(payload) })
}
export async function updateDriveFolder(id, payload) {
  return api('/drive-folders/' + id, { method: 'PUT', body: JSON.stringify(payload) })
}
export async function deleteDriveFolder(id) {
  return api('/drive-folders/' + id, { method: 'DELETE' })
}

export async function getOperandioRange(params = {}, options = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api('/operandio/range' + (qs ? '?' + qs : ''), options)
}

// Per-job submission/overdue compliance (who's doing jobs, what's not done)
export async function getOperandioJobs(params = {}, options = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api('/operandio/jobs' + (qs ? '?' + qs : ''), options)
}

// Task-level detail for a single job instance (drill-down)
export async function getOperandioJobInstance(params = {}, options = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api('/operandio/jobs/instance' + (qs ? '?' + qs : ''), options)
}

// Single QA audit with its per-item breakdown (in-house HTML report viewer)
export async function getOperandioQaReport(id, options = {}) {
  return api('/operandio/qa-reports/' + id, options)
}

// QA-Cleaning audit submissions (Cleanliness - Quality Assessment KPI)
export async function getOperandioQaReports(params = {}, options = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api('/operandio/qa-reports' + (qs ? '?' + qs : ''), options)
}

// Webhook Logs
export async function getWebhookLogs(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/admin/webhook-logs' + (qs ? '?' + qs : ''))
}

// Communication Notes
export async function getCommunicationNotes(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/communication-notes' + (qs ? '?' + qs : ''))
}

export async function createCommunicationNote(data) {
  return api('/communication-notes', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateCommunicationNote(id, data) {
  return api('/communication-notes/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function getCommunicationNoteComments(noteId) {
  return api('/communication-notes/' + noteId + '/comments')
}

export async function addCommunicationNoteComment(noteId, data) {
  return api('/communication-notes/' + noteId + '/comments', { method: 'POST', body: JSON.stringify(data) })
}

// HR Documents
export async function getHRDocuments(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/hr-documents' + (qs ? '?' + qs : ''))
}

export async function createHRDocument(data) {
  return api('/hr-documents', { method: 'POST', body: JSON.stringify(data) })
}

export async function getHRDocument(id) {
  return api('/hr-documents/' + id)
}

export async function acknowledgeHRDocument(id, data) {
  return api('/hr-documents/' + id + '/acknowledge', { method: 'PUT', body: JSON.stringify(data) })
}

export async function uploadHRDocumentToPaychex(id, workerId) {
  return api('/hr-documents/' + id + '/upload-paychex', { method: 'POST', body: JSON.stringify({ workerId }) })
}

// Paychex Workers
export async function getPaychexWorkers(slug, status, { refresh = false } = {}) {
  const params = new URLSearchParams()
  if (slug) params.set('slug', slug)
  if (status) params.set('status', status)
  if (refresh) params.set('refresh', '1')
  const qs = params.toString() ? '?' + params.toString() : ''
  return api('/hr-documents/paychex-workers' + qs)
}

export async function getPaychexWorkerDocuments(workerId, workerName) {
  const qs = workerName ? '?workerName=' + encodeURIComponent(workerName) : ''
  return api('/hr-documents/paychex-workers/' + workerId + '/documents' + qs)
}

export async function getPaychexLocations() {
  return api('/hr-documents/paychex-locations')
}

// Help Center
export async function getHelpCategories() {
  return api('/help-center/categories')
}

export async function createHelpCategory(data) {
  return api('/help-center/categories', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateHelpCategory(id, data) {
  return api('/help-center/categories/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteHelpCategory(id) {
  return api('/help-center/categories/' + id, { method: 'DELETE' })
}

export async function getHelpArticles(categoryId) {
  const qs = categoryId ? '?category_id=' + categoryId : ''
  return api('/help-center/articles' + qs)
}

export async function getHelpArticle(id) {
  return api('/help-center/articles/' + id)
}

export async function createHelpArticle(data) {
  return api('/help-center/articles', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateHelpArticle(id, data) {
  return api('/help-center/articles/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteHelpArticle(id) {
  return api('/help-center/articles/' + id, { method: 'DELETE' })
}

export async function uploadHelpImage(url) {
  return api('/help-center/upload-image', { method: 'POST', body: JSON.stringify({ url }) })
}

// ABC Sync
export async function getABCSyncSummary(runId) {
  const qs = runId ? '?run_id=' + runId : ''
  return api('/abc-sync/summary' + qs)
}

export async function getABCSyncRuns(limit = 20) {
  return api('/abc-sync/runs?limit=' + limit)
}

export async function getABCSyncChangelog(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/abc-sync/changelog?' + qs)
}

export async function getABCSyncUnmatched(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/abc-sync/unmatched?' + qs)
}

export async function triggerABCSync() {
  return api('/abc-sync/trigger', { method: 'POST', body: JSON.stringify({}) })
}

export async function stopABCSync() {
  return api('/abc-sync/stop', { method: 'POST', body: JSON.stringify({}) })
}

export async function stopGHLSync() {
  return api('/abc-sync/stop-ghl', { method: 'POST', body: JSON.stringify({}) })
}

export async function getABCMembershipBreakdown(clubNumber) {
  const qs = clubNumber ? '?club_number=' + clubNumber : ''
  return api('/abc-sync/membership-breakdown' + qs)
}

// Ticket Embeds
export async function getTicketEmbeds() {
  return api('/ticket-embeds')
}

export async function createTicketEmbed(data) {
  return api('/ticket-embeds', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateTicketEmbed(id, data) {
  return api('/ticket-embeds/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteTicketEmbed(id) {
  return api('/ticket-embeds/' + id, { method: 'DELETE' })
}

// Ticket Status (ClickUp)
export async function getTicketStatus() {
  return api('/tickets/status')
}

export async function refreshTicketStatus() {
  return api('/tickets/refresh', { method: 'POST' })
}

// App Settings
export async function getAppSettings(prefix) {
  const qs = prefix ? '?prefix=' + prefix : ''
  return api('/config/app-settings' + qs)
}

export async function saveAppSettings(settings) {
  return api('/config/app-settings', { method: 'PUT', body: JSON.stringify({ settings }) })
}

// Custom Fields
export async function getCustomFields(location) {
  const qs = location ? '?location=' + location : ''
  return api('/custom-fields' + qs)
}

// Daily Snapshot
export async function getDailySnapshot({ date, location } = {}) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (location) params.set('location', location)
  const qs = params.toString()
  return api('/reports/daily-snapshot' + (qs ? '?' + qs : ''))
}
