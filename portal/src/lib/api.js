import * as apiCache from './apiCache'
import { downscaleImage } from './downscaleImage'

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

const IMPERSONATE_KEY = 'wcs_impersonate_id'
export function getImpersonateId() {
  try { return localStorage.getItem(IMPERSONATE_KEY) } catch { return null }
}
export function setImpersonateId(id) {
  try {
    if (id) localStorage.setItem(IMPERSONATE_KEY, id)
    else localStorage.removeItem(IMPERSONATE_KEY)
  } catch {}
}

export function clearToken() {
  authToken = null
  refreshToken = null
  try {
    localStorage.removeItem('wcs_token')
    localStorage.removeItem('wcs_refresh_token')
  } catch {}
  try { localStorage.removeItem(IMPERSONATE_KEY) } catch {}
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
  const impersonateId = getImpersonateId()
  if (impersonateId) headers['X-Impersonate-Staff-Id'] = impersonateId

  // Drop our custom options before passing to fetch.
  const { cache: _cache, ...restOptions } = options
  const fetchOptions = { ...restOptions, headers }
  if (options.signal) fetchOptions.signal = options.signal

  const res = await fetch(API_URL + path, fetchOptions)
  let data
  try {
    data = await res.json()
  } catch {
    // A body that is not JSON is usually a proxy or cold-start page rather than
    // the API, so it carries the transport code and stays retryable.
    const err = new Error('Server error — please try again')
    err.httpStatus = res.status
    throw err
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
        const retryErr = new Error(retryData.error || 'Request failed')
        // Preserve extra fields (e.g. { unknown: [...] } from validation errors)
        // without clobbering properties the Error already has (e.g. `message`).
        if (retryData && typeof retryData === 'object') {
          for (const k of Object.keys(retryData)) {
            if (!(k in retryErr)) retryErr[k] = retryData[k]
          }
        }
        throw retryErr
      }
      return retryData
    }
    clearToken()
    authExpiredListeners.forEach(fn => fn())
    const expired = new Error('Session expired — please sign in again')
    // 401 so the retry policy leaves it alone. Retrying a dead session would
    // spin three times and still land the user on the login screen, slower.
    expired.httpStatus = 401
    throw expired
  }

  if (!res.ok) {
    const err = new Error(data.error || 'Request failed')
    // Preserve extra fields (e.g. { unknown: [...] } from validation errors)
    // so callers can surface them without re-parsing the response. Never
    // overwrite a property the Error already has (esp. `message`, which
    // callers like PayrollReport.jsx regex-match against data.error).
    if (data && typeof data === 'object') {
      for (const k of Object.keys(data)) {
        if (!(k in err)) err[k] = data[k]
      }
    }
    // Named httpStatus, not status, so it cannot be clobbered by a `status`
    // field in the response body — the loop above copies those in. Retry logic
    // needs the real transport code, not whatever the payload called itself.
    err.httpStatus = res.status
    throw err
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

// ---- VIP Referrals admin (prospects-documents) ---------------------------
export const vipReferrals = {
  listSubmissions: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== '')
    ).toString()
    return prospectsApi('/api/admin/vip-referrals/submissions' + (qs ? `?${qs}` : ''))
  },
  getSubmission: (id) => prospectsApi(`/api/admin/vip-referrals/submissions/${id}`),
  retryRecipient: (id) => prospectsApi(`/api/admin/vip-referrals/recipients/${id}/retry`, { method: 'POST' }),
  listConfig: () => prospectsApi('/api/admin/vip-referrals/config'),
  updateConfig: (slug, body) => prospectsApi(`/api/admin/vip-referrals/config/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(body) }),
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
  const data = await api('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
  // Changing the password revokes the session that authorized the request, so
  // the server signs back in and returns a fresh session. Adopt it before any
  // follow-up call (getMe etc.) fires with the now-dead token.
  if (data?.token) setToken(data.token, data.refresh_token)
  return data
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

// Per-user portal UI preferences (appearance + pinned shortcuts). See
// lib/uiPrefs.js for the sync layer that keeps these and localStorage in step.
export async function getUiPreferences() {
  return api('/ui-preferences')
}

export async function saveUiPreferences(prefs) {
  return api('/ui-preferences', { method: 'PUT', body: JSON.stringify({ prefs }) })
}

// Home-screen backgrounds. The bucket is private, so every url here is a
// short-lived signed URL: fetch, use, discard. Never persist one.
export async function listBackgrounds() {
  return api('/backgrounds')
}

export async function uploadBackground(file) {
  const fd = new FormData(); fd.append('file', file)
  return api('/backgrounds', { method: 'POST', body: fd })
}

export async function deleteBackground(id) {
  return api('/backgrounds/' + encodeURIComponent(id), { method: 'DELETE' })
}

export async function uploadSharedBackground(file) {
  const fd = new FormData(); fd.append('file', file)
  return api('/backgrounds/shared', { method: 'POST', body: fd })
}

export async function deleteSharedBackground(id) {
  return api('/backgrounds/shared/' + encodeURIComponent(id), { method: 'DELETE' })
}

// Per-user "What's New" read state (highest changelog entry id seen).
export async function getChangelogSeen() {
  return api('/changelog/seen')
}
export async function setChangelogSeen(last_seen_id) {
  return api('/changelog/seen', { method: 'POST', body: JSON.stringify({ last_seen_id }) })
}

// Admin - Staff
export async function getStaff() {
  return api('/admin/staff')
}

export async function createStaff(data) {
  return api('/admin/staff', { method: 'POST', body: JSON.stringify(data) })
}

export async function startImpersonation(staffId) {
  return api('/admin/impersonate/' + staffId, { method: 'POST' })
}

export async function updateStaff(id, data) {
  return api('/admin/staff/' + id, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteStaff(id) {
  return api('/admin/staff/' + id, { method: 'DELETE' })
}

export async function setStaffActive(id, isActive) {
  return api('/admin/staff/' + id + '/active', {
    method: 'PUT',
    body: JSON.stringify({ is_active: isActive }),
  })
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

// --- Till-close auto-print -------------------------------------------------
export async function getPrintDevices() {
  return api('/print/devices')
}
export async function updatePrintDevice(installId, data) {
  return api('/print/devices/' + encodeURIComponent(installId), {
    method: 'PUT', body: JSON.stringify(data),
  })
}
export async function testPrintDevice(installId) {
  return api('/print/devices/' + encodeURIComponent(installId) + '/test', { method: 'POST' })
}
export async function getPrintAutomations() {
  return api('/print/automations')
}
export async function updatePrintAutomation(slug, data) {
  return api('/print/automations/' + encodeURIComponent(slug), {
    method: 'PUT', body: JSON.stringify(data),
  })
}

// Day One PT program generator — admin monitor (pt_programs)
export async function getDayOnePrograms(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)
  ).toString()
  return api('/admin/day-one-programs' + (qs ? '?' + qs : ''))
}

// Launcher installs (kiosk registry) + one-time location deep links
export async function getKioskInstalls() {
  return api('/launcher/installs')
}

export async function updateKioskInstall(id, data) {
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
export async function updateRoleVisibility(updates) {
  return api('/config/role-visibility', {
    method: 'PUT',
    body: JSON.stringify({ updates }),
  })
}

// Config - RBAC v2 custom roles
export async function getRolesAdmin() {
  return api('/config/roles')
}

export async function createRole(body) {
  return api('/config/roles', { method: 'POST', body: JSON.stringify(body) })
}

export async function renameRole(id, name) {
  return api('/config/roles/' + id, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function deleteRole(id) {
  return api('/config/roles/' + id, { method: 'DELETE' })
}

// RBAC v2 — per-person permission overrides
export async function getStaffOverrides(id) {
  return api('/admin/staff/' + id + '/overrides')
}

export async function updateStaffOverrides(id, items) {
  return api('/admin/staff/' + id + '/overrides', {
    method: 'PUT',
    body: JSON.stringify({ items }),
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

// When the sync last refreshed report data (for an "Updated X ago" header stamp).
export async function getDataFreshness(options = {}) {
  return api('/reports/data-freshness', options)
}

export async function getSpeedToLead(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/speed-to-lead' + (qs ? '?' + qs : ''), options)
}

export async function getSpeedToLeadAudit(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/speed-to-lead/audit' + (qs ? '?' + qs : ''), options)
}

// Experimental: raw + business-hours speed per lead, plus both medians.
export async function getSpeedToLeadBusinessAudit(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/speed-to-lead/business-audit' + (qs ? '?' + qs : ''), options)
}

export async function getMembershipAudit(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/membership-audit' + (qs ? '?' + qs : ''), options)
}

// How many active members pay each price, grouped by club × type × frequency ×
// price. One fetch backs every view — the client pivots and filters it.
export async function getMembershipPriceBreakdown(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/membership-price-breakdown' + (qs ? '?' + qs : ''), options)
}

// Excel export of the price breakdown: a price × club summary sheet plus the
// member-level detail list. `basis` picks which price column groups the summary.
export async function downloadMembershipPriceDetail({ locationSlug = 'all', basis = 'monthly' } = {}) {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const params = new URLSearchParams()
  if (locationSlug && locationSlug !== 'all') params.set('location_slug', locationSlug)
  if (basis) params.set('basis', basis)
  const qs = params.toString()
  const url = `${API_URL}/reports/membership-price-detail.xlsx${qs ? '?' + qs : ''}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error || text } catch { /* leave text */ }
    throw new Error(msg || `Failed to generate price breakdown (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  const locLabel = !locationSlug || locationSlug === 'all' ? 'All-Clubs' : locationSlug
  a.download = `WCS-Membership-Price-Breakdown-${locLabel}.xlsx`
  a.click()
  // Defer revoke so the browser can start the download before the blob URL is
  // freed (a synchronous revoke races the download in some browsers).
  setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
}

// Same two tables as the .xlsx, written to a new Google Sheet in the user's own
// Drive. Resolves to { url }. Throws with code 'google_not_connected' (HTTP 412)
// when the user hasn't linked their Google account yet.
export async function exportMembershipPriceToSheet({ locationSlug = 'all', basis = 'monthly' } = {}) {
  const params = new URLSearchParams()
  if (locationSlug && locationSlug !== 'all') params.set('location_slug', locationSlug)
  if (basis) params.set('basis', basis)
  const qs = params.toString()
  return api('/reports/membership-price-detail/export-sheet' + (qs ? '?' + qs : ''), {
    method: 'POST',
  })
}

export async function getPTReport(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt' + (qs ? '?' + qs : ''), options)
}

export async function getPTRoster(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-roster' + (qs ? '?' + qs : ''), options)
}

export async function getPTProjections(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-projections' + (qs ? '?' + qs : ''), options)
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

// Marketing Needs List
export async function getMarketingNeeds(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/marketing-tracker/needs' + (qs ? '?' + qs : ''))
}
export async function createMarketingNeed(data) {
  return api('/marketing-tracker/needs', { method: 'POST', body: JSON.stringify(data) })
}
export async function updateMarketingNeed(id, data) {
  return api('/marketing-tracker/needs/' + id, { method: 'PATCH', body: JSON.stringify(data) })
}
export async function deleteMarketingNeed(id) {
  return api('/marketing-tracker/needs/' + id, { method: 'DELETE' })
}
export async function getMarketingNeedComments(id) {
  return api('/marketing-tracker/needs/' + id + '/comments')
}
export async function addMarketingNeedComment(id, body) {
  return api('/marketing-tracker/needs/' + id + '/comments', { method: 'POST', body: JSON.stringify({ body }) })
}

// Marketing Research (AI web-search)
export async function getMarketingResearch(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/marketing-tracker/research' + (qs ? '?' + qs : ''))
}
export async function runMarketingResearch(location) {
  return api('/marketing-tracker/research/run', { method: 'POST', body: JSON.stringify({ location }) })
}
export async function updateMarketingResearch(id, status) {
  return api('/marketing-tracker/research/' + id, { method: 'PATCH', body: JSON.stringify({ status }) })
}
export async function deleteMarketingResearch(id) {
  return api('/marketing-tracker/research/' + id, { method: 'DELETE' })
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

// Reorder levels — per-club, per-category reorder points (read lead+, write manager+).
export async function getReorderLevels(params = {}) {
  return api('/inventory/reorder-levels' + inventoryQs(params))
}

// Set/clear one level. reorder_point null/'' clears it (category untracked).
export async function setReorderLevel({ location_slug, category, reorder_point }) {
  return api('/inventory/reorder-levels', {
    method: 'PUT',
    body: JSON.stringify({ location_slug, category, reorder_point }),
  })
}

// Shopping lists (per-club reorder checklists, lead+).
export async function getShoppingLists(params = {}) {
  return api('/inventory/shopping-lists' + inventoryQs(params))
}

export async function createShoppingList({ location_slug, name }) {
  return api('/inventory/shopping-lists', { method: 'POST', body: JSON.stringify({ location_slug, name }) })
}

export async function getShoppingList(id) {
  return api('/inventory/shopping-lists/' + id)
}

export async function renameShoppingList(id, name) {
  return api('/inventory/shopping-lists/' + id, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function deleteShoppingList(id) {
  return api('/inventory/shopping-lists/' + id, { method: 'DELETE' })
}

export async function addShoppingListItem(id, inventory_item_id) {
  return api('/inventory/shopping-lists/' + id + '/items', { method: 'POST', body: JSON.stringify({ inventory_item_id }) })
}

export async function removeShoppingListItem(id, listItemId) {
  return api('/inventory/shopping-lists/' + id + '/items/' + listItemId, { method: 'DELETE' })
}

export async function getInventoryTransactions(params = {}) {
  return api('/inventory/transactions' + inventoryQs(params))
}

export async function getInventorySummary(params = {}) {
  return api('/inventory/summary' + inventoryQs(params))
}

// Till / cash drawer reconciliation (manager+): counted vs expected per club/day.
// params: { location_slug, from, to } (location_slug '' = all the caller may see).
export async function getTillReconciliation(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/till/reconciliation' + (qs ? '?' + qs : ''))
}

// Till cash movements (lead+): money taken out of or put into a drawer, logged
// in the portal instead of rung on the register.
// params: { location_slug, from?, to? } — dates default to today (Pacific).
export async function getTillMovements(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/till/movements' + (qs ? '?' + qs : ''))
}

// body: { location_slug, direction: 'out'|'in', reason, amount, note?, business_date? }
export async function createTillMovement(body) {
  return api('/till/movements', { method: 'POST', body: JSON.stringify(body) })
}

// Voids never delete — the entry stays on the record with who voided it and why.
export async function voidTillMovement(id, voidReason) {
  return api(`/till/movements/${id}/void`, { method: 'POST', body: JSON.stringify({ void_reason: voidReason }) })
}

// Per-club till settings (standard float). Read/write manager+; editor is admin-only.
export async function getTillSettings() {
  return api('/till/settings')
}

export async function setTillFloat(location_slug, standard_float) {
  return api('/till/settings', { method: 'PUT', body: JSON.stringify({ location_slug, standard_float }) })
}

// Email Marketing report — GHL email campaign sends + stats (from email_stats).
export async function getEmailMarketingCampaigns(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/email-marketing/campaigns' + (qs ? '?' + qs : ''))
}

// Workflow email performance over a date range, derived from daily snapshots.
export async function getEmailMarketingAutomations(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/email-marketing/automations' + (qs ? '?' + qs : ''))
}

// SMS engagement per automated text (clustered by message-body fingerprint).
export async function getSmsMarketingTemplates(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/sms-marketing/templates' + (qs ? '?' + qs : ''))
}

export async function setSmsTemplateLabel(key, label, template_keys, prev_label) {
  return api(`/sms-marketing/templates/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      label,
      ...(template_keys ? { template_keys } : {}),
      ...(prev_label ? { prev_label } : {}),
    }),
  })
}

export async function getInventoryInvoices() {
  return api('/inventory/invoices')
}

export async function getInventoryMovements() {
  return api('/inventory/movements')
}

export async function createInventoryInvoice(fields, files) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v)
  }
  const list = Array.isArray(files) ? files : (files ? [files] : [])
  for (const f of list) fd.append('files', f)
  return api('/inventory/invoices', { method: 'POST', body: fd })
}

export async function parseInventoryInvoice(invoiceId) {
  return api('/inventory/invoices/' + invoiceId + '/parse', { method: 'POST' })
}

export async function addInventoryInvoiceFiles(invoiceId, files) {
  const fd = new FormData()
  for (const f of (Array.isArray(files) ? files : [files])) fd.append('files', f)
  return api('/inventory/invoices/' + invoiceId + '/files', { method: 'POST', body: fd })
}

export async function previewVendorPriceList(file) {
  const fd = new FormData(); fd.append('file', file)
  return api('/inventory/price-list/preview', { method: 'POST', body: fd })
}

export async function applyVendorPriceList(file, vendor, updateCosts) {
  const fd = new FormData(); fd.append('file', file)
  if (vendor) fd.append('vendor', vendor)
  fd.append('update_costs', updateCosts ? 'true' : 'false')
  return api('/inventory/price-list/apply', { method: 'POST', body: fd })
}

export async function deleteInventoryInvoiceFile(invoiceId, fileId) {
  return api('/inventory/invoices/' + invoiceId + '/files/' + fileId, { method: 'DELETE' })
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

export async function importInventoryCosts(file) {
  const fd = new FormData()
  fd.append('file', file)
  return api('/inventory/cost-import', { method: 'POST', body: fd })
}

export async function getInventoryEmployeeSpend(params = {}) {
  return api('/inventory/employee-spend' + inventoryQs(params))
}

export async function getInventoryShrinkage(params = {}) {
  return api('/inventory/shrinkage' + inventoryQs(params))
}

export async function getInventoryReceived(params = {}) {
  return api('/inventory/received' + inventoryQs(params))
}

export async function getInventoryCompliance(params = {}) {
  return api('/inventory/compliance' + inventoryQs(params))
}

// Per-day restock/count activity for the compliance drill-down.
// params: { location_slug, from, to } (YYYY-MM-DD).
export async function getInventoryComplianceActivity(params = {}) {
  return api('/inventory/compliance/activity' + inventoryQs(params))
}

// Day One Tracker
export async function getDayOneTrackerAppointments(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/day-one-tracker/appointments' + (qs ? '?' + qs : ''))
}

// submitDayOneResult and getDayOneFieldOptions are deliberately gone.
// They POSTed to /day-one-tracker/submit, which writes to GHL custom fields and
// NOT to day_one_appointments. Three separate modals used them and left 27 Day
// Ones with an outcome GHL knew about and the portal did not. Outcomes are now
// recorded through the embedded form (DayOneOutcomeFrame), which writes both.

// Tour Intake (front-desk gym-tour queue)
export async function getTourIntakes(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/tour-intake' + (qs ? '?' + qs : ''))
}

export async function updateTourIntake(id, data) {
  return api('/tour-intake/' + id, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Standalone Tour Check-In: PUBLIC endpoints (no auth token) ---
async function publicFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const res = await fetch(API_URL + path, { ...options, headers })
  if (!res.ok) {
    let msg = 'Request failed'
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export const publicTour = {
  get: (token) => publicFetch(`/public/tour/${token}`),
  employees: (token) => publicFetch(`/public/tour/${token}/employees`),
  saveOutcome: (token, id, body) =>
    publicFetch(`/public/tour/${token}/intake/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  subscribe: (token, subscription) =>
    publicFetch(`/public/tour/${token}/subscribe`, {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),
  // Extend a lapsed trial from the queue. Prospects only; a real member comes
  // back as an error the UI shows verbatim.
  // What the contact already says about who sent them.
  referral: (token, id) => publicFetch(`/public/tour/${token}/intake/${id}/referral`),
  // Whether this card is somebody who already trains here.
  abcStatus: (token, id) => publicFetch(`/public/tour/${token}/intake/${id}/abc-status`),
  // Take a card off the queue WITHOUT recording a tour. The server has always
  // accepted this; nothing ever called it, so the only way to clear a card was
  // to complete it as a tour.
  dismiss: (token, id) =>
    publicFetch(`/public/tour/${token}/intake/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    }),
  // Backs the "who referred you" picker. Our synced abc_members, not ABC.
  memberSearch: (token, q) =>
    publicFetch(`/public/tour/${token}/member-search?q=${encodeURIComponent(q)}`),
  giveTrialDays: (token, id, days) =>
    publicFetch(`/public/tour/${token}/intake/${id}/trial-days`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
}

// --- Tour Check-In admin (authed) ---
export const tourAdmin = {
  list: () => api('/admin/tour-locations'),
  update: (locationId, body) =>
    api('/admin/tour-locations/' + locationId, { method: 'PUT', body: JSON.stringify(body) }),
  regenerate: (locationId) =>
    api('/admin/tour-locations/' + locationId + '/regenerate-token', { method: 'POST' }),
  searchReferrers: (q) =>
    api('/admin/tour-locations/referrer-search?q=' + encodeURIComponent(q)),
}

// Per-club outbound webhook URLs (Admin -> Club Integrations). Consumed by the
// prospects---documents service; see auth/migrations/075_club_integrations.sql.
export const clubIntegrationsAdmin = {
  list: () => api('/admin/club-integrations'),
  update: (clubNumber, body) =>
    api('/admin/club-integrations/' + clubNumber, { method: 'PUT', body: JSON.stringify(body) }),
}

// Form Builder
export const forms = {
  list: () => api('/forms'),
  get: (id) => api(`/forms/${id}`),
  create: (body) => api('/forms', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => api(`/forms/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  publish: (id) => api(`/forms/${id}/publish`, { method: 'POST' }),
  archive: (id) => api(`/forms/${id}/archive`, { method: 'POST' }),
  remove: (id) => api(`/forms/${id}`, { method: 'DELETE' }),
  addShare: (id, body) => api(`/forms/${id}/shares`, { method: 'POST', body: JSON.stringify(body) }),
  removeShare: (id, staffId) => api(`/forms/${id}/shares/${staffId}`, { method: 'DELETE' }),
  audit: (id) => api(`/forms/${id}/audit`),
  auditAll: (params = {}) => api(`/forms/audit/all?` + new URLSearchParams(params)),
  submissions: (id, offset = 0) => api(`/forms/${id}/submissions?offset=${offset}`),
  retrySync: (id) => api(`/forms/${id}/retry-sync`, { method: 'POST' }),
  staffDirectory: () => api('/forms/staff-directory'),
}

// NPS report — scores, metrics, response rates and the comment feed
export async function npsReport({ startDate, endDate, locationSlug, combine }, options = {}) {
  const params = new URLSearchParams({ start: startDate, end: endDate })
  if (locationSlug && locationSlug !== 'all') params.set('location_slug', locationSlug)
  if (combine) params.set('combine', 'true')
  return api('/reports/nps?' + params.toString(), options)
}

// NPS / member feedback — admin survey management + manual test fire
export const nps = {
  listSurveys: () => api('/nps/surveys'),
  getSurvey: (id) => api(`/nps/surveys/${id}`),
  createSurvey: (body) => api('/nps/surveys', { method: 'POST', body: JSON.stringify(body) }),
  updateSurvey: (id, body) => api(`/nps/surveys/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeSurvey: (id) => api(`/nps/surveys/${id}`, { method: 'DELETE' }),
  createQr: (id, clubNumber) => api(`/nps/surveys/${id}/qr`, { method: 'POST', body: JSON.stringify({ club_number: clubNumber }) }),
  rotateQr: (qrId) => api(`/nps/qr/${qrId}/rotate`, { method: 'POST' }),
  listMetrics: () => api('/nps/metrics'),
  createMetric: (body) => api('/nps/metrics', { method: 'POST', body: JSON.stringify(body) }),
  setMetricActive: (id, active) => api(`/nps/metrics/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  searchMembers: (q) => api(`/nps/members/search?q=${encodeURIComponent(q)}`),
  testFire: (body) => api('/nps/test-fire', { method: 'POST', body: JSON.stringify(body) }),
  sentLog: (date) => api('/nps/sent?date=' + encodeURIComponent(date)),
}

// Lapsed Check-in Tagging — admin exclusions + at-risk dashboard
export const lapsedCheckins = {
  getTypes: () => api('/admin/lapsed-checkins/types'),
  saveTypes: (excluded) => api('/admin/lapsed-checkins/types', { method: 'PUT', body: JSON.stringify({ excluded }) }),
  getDashboard: () => api('/admin/lapsed-checkins/dashboard'),
  getDrilldown: (club, tier) => api(`/admin/lapsed-checkins/dashboard/${encodeURIComponent(club)}/${encodeURIComponent(tier)}`),
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

// ---------------------------------------------------------------------------
// Meta Ads Manager (admin-only write API). Separate from the read-only
// /meta-ads reporting endpoints above — these create and edit live ads.
// ---------------------------------------------------------------------------

const MAM = '/meta-ads-manager'

function mamQs(path, params) {
  const clean = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  )
  const qs = new URLSearchParams(clean).toString()
  return MAM + path + (qs ? '?' + qs : '')
}

export async function getAdsManagerAccount() {
  return api(MAM + '/account')
}

export async function getAdsManagerLeadForms(pageId) {
  return api(MAM + '/pages/' + encodeURIComponent(pageId) + '/lead-forms')
}

export async function getAdsManagerCampaigns(params = {}) {
  return api(mamQs('/campaigns', params))
}

export async function createAdsManagerCampaign(body) {
  return api(MAM + '/campaigns', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateAdsManagerCampaign(id, body) {
  return api(`${MAM}/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function deleteAdsManagerCampaign(id) {
  return api(`${MAM}/campaigns/${id}`, { method: 'DELETE' })
}

export async function getAdsManagerAdsets(params = {}) {
  return api(mamQs('/adsets', params))
}

export async function getAdsManagerAdset(id) {
  return api(`${MAM}/adsets/${id}`)
}

export async function createAdsManagerAdset(body) {
  return api(MAM + '/adsets', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateAdsManagerAdset(id, body) {
  return api(`${MAM}/adsets/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function duplicateAdsManagerAdset(id, body) {
  return api(`${MAM}/adsets/${id}/duplicate`, { method: 'POST', body: JSON.stringify(body) })
}

export async function deleteAdsManagerAdset(id) {
  return api(`${MAM}/adsets/${id}`, { method: 'DELETE' })
}

export async function getAdsManagerAds(params = {}) {
  return api(mamQs('/ads', params))
}

export async function getAdsManagerAd(id) {
  return api(`${MAM}/ads/${id}`)
}

// Creates every variant in one call; resolves to { created, failed, results }
// even when some variants fail, so the caller reports per-variant outcomes.
export async function createAdsManagerAds(body) {
  return api(MAM + '/ads', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateAdsManagerAd(id, body) {
  return api(`${MAM}/ads/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function deleteAdsManagerAd(id) {
  return api(`${MAM}/ads/${id}`, { method: 'DELETE' })
}

export async function duplicateAdsManagerAd(id, body) {
  return api(`${MAM}/ads/${id}/duplicate`, { method: 'POST', body: JSON.stringify(body) })
}

export async function uploadAdsManagerImages(files) {
  const fd = new FormData()
  for (const file of files) fd.append('files', file)
  return api(MAM + '/media/image', { method: 'POST', body: fd })
}

export async function uploadAdsManagerVideo(file) {
  const fd = new FormData()
  fd.append('file', file)
  return api(MAM + '/media/video', { method: 'POST', body: fd })
}

export async function getAdsManagerVideoStatus(id) {
  return api(`${MAM}/media/video/${id}`)
}

export async function getAdsManagerImages(params = {}) {
  return api(mamQs('/media/images', params))
}

export async function getAdsManagerVideos(params = {}) {
  return api(mamQs('/media/videos', params))
}

export async function searchAdsManagerLocations(q) {
  return api(mamQs('/targeting/locations', { q }))
}

export async function searchAdsManagerInterests(q) {
  return api(mamQs('/targeting/interests', { q }))
}

export async function getAdsManagerAudiences() {
  return api(MAM + '/targeting/audiences')
}

// Stranded ads: switched on inside a paused campaign or ad set. Harmless
// until the parent is reactivated, at which point they all resume at once.
// The audit is the most expensive query this feature makes, so the server
// caches it. Pass force to pay for a fresh one.
export async function getAdsManagerStrandedAds(force) {
  return api(MAM + '/audit/stranded-ads' + (force ? '?refresh=1' : ''))
}

// Last observed Meta rate-limit budget. Served from cached headers, so this
// costs nothing against the ad account.
export async function getAdsManagerUsage() {
  return api(MAM + '/usage')
}

// Omit ad_ids to sweep every stranded ad; pass a subset to pause just those.
export async function pauseAdsManagerStrandedAds(adIds) {
  return api(MAM + '/audit/stranded-ads/pause', {
    method: 'POST',
    body: JSON.stringify(adIds ? { ad_ids: adIds } : {}),
  })
}

export async function getAdsManagerSavedAudiences() {
  return api(MAM + '/targeting/saved-audiences')
}

export async function previewAdsManagerVariant(body) {
  return api(MAM + '/previews', { method: 'POST', body: JSON.stringify(body) })
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

// Meeting-notes automation: connection status (owner Google account + scopes)
// and the OAuth consent URL for the dedicated Docs+Calendar connect flow.
export async function getMeetingNotesStatus() {
  return api('/meeting-notes/status')
}

export async function getMeetingNotesAuthUrl() {
  return api('/meeting-notes/authorize-url', { method: 'POST' })
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

// Media Search
export async function searchMedia({ query, location, kind, limit = 40 }) {
  return api('/media/search', { method: 'POST', body: JSON.stringify({ query, location, kind, limit }) })
}

export async function reindexMedia() {
  return api('/media/reindex', { method: 'POST' })
}

// Fetch a protected thumbnail with the bearer token and return an object URL.
export async function fetchMediaThumbBlob(driveFileId) {
  const res = await fetch(API_URL + '/media/thumbnail/' + encodeURIComponent(driveFileId), {
    headers: authToken ? { Authorization: 'Bearer ' + authToken } : {},
  })
  if (!res.ok) throw new Error('thumb ' + res.status)
  return URL.createObjectURL(await res.blob())
}

// Download the original media file (authed) and trigger a browser save.
export async function downloadMediaFile(driveFileId, filename) {
  const res = await fetch(API_URL + '/media/download/' + encodeURIComponent(driveFileId), {
    headers: authToken ? { Authorization: 'Bearer ' + authToken } : {},
  })
  if (!res.ok) throw new Error('download ' + res.status)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'media'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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

// ---- Compliance report (Operandio API sync) ----

function complianceQs(params = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return qs ? '?' + qs : ''
}

export async function getComplianceSummary(params = {}, options = {}) {
  return api('/reports/compliance/summary' + complianceQs(params), options)
}

export async function getComplianceJobs(params = {}, options = {}) {
  return api('/reports/compliance/jobs' + complianceQs(params), options)
}

export async function getComplianceJobSteps(jobId, params = {}, options = {}) {
  return api(`/reports/compliance/jobs/${encodeURIComponent(jobId)}/steps` + complianceQs(params), options)
}

export async function getCompliancePeople(params = {}, options = {}) {
  return api('/reports/compliance/people' + complianceQs(params), options)
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

// Frozen end-of-day KPI snapshots (History view). params: start_date, end_date,
// optional location_slug, kpi_key.
export async function getKpiHistory(params = {}, options = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api('/reports/kpi-history' + (qs ? '?' + qs : ''), options)
}

// Admin-only: manually compute + store a day's KPI snapshot (default today PT).
export async function runKpiSnapshot(date) {
  return api('/reports/kpi-snapshot/run', {
    method: 'POST',
    body: JSON.stringify(date ? { date } : {}),
  })
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

// WCS University — admin enrollment (admin-gated, behind UNIVERSITY_ENROLL_ENABLED)
export async function getUniversityUsers() {
  return api('/university/admin/users')
}

export async function enrollUniversityUser(userId, extra = {}) {
  return api('/university/admin/enroll', { method: 'POST', body: JSON.stringify({ user_id: userId, ...extra }) })
}

export async function getUniversityEnrollments() {
  return api('/university/admin/enrollments')
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

// Download a portal HR document as a PDF. The server renders it on demand if
// no PDF was stored at creation time.
export async function downloadHRDocumentPdf(docId, filename) {
  const res = await fetch(API_URL + '/hr-documents/' + encodeURIComponent(docId) + '/pdf', {
    headers: authToken ? { Authorization: 'Bearer ' + authToken } : {},
  })
  if (!res.ok) {
    let msg = `Failed to download PDF (HTTP ${res.status})`
    try { const j = await res.json(); msg = j.error || msg } catch {}
    throw new Error(msg)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'hr-document.pdf'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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

// Ticketing (the portal's ticket system)
export const ticketing = {
  // Types (the ticket "form builder")
  listTypes: (activeOnly) => api('/ticketing/types' + (activeOnly ? '?active=1' : '')),
  createType: (data) => api('/ticketing/types', { method: 'POST', body: JSON.stringify(data) }),
  updateType: (id, data) => api('/ticketing/types/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteType: (id) => api('/ticketing/types/' + id, { method: 'DELETE' }),

  assignableStaff: () => api('/ticketing/assignable-staff'),
  // Active staff for the assignee + @mention pickers (open to handlers, not just admins).
  staffDirectory: (q) => api('/ticketing/staff-directory' + (q ? '?q=' + encodeURIComponent(q) : '')),

  // Tickets
  list: ({ status, type_id, q, handling } = {}) => {
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (type_id) p.set('type_id', type_id)
    if (q) p.set('q', q)
    if (handling) p.set('handling', '1')
    const qs = p.toString()
    return api('/ticketing' + (qs ? '?' + qs : ''))
  },
  summary: (handling) => api('/ticketing/summary' + (handling ? '?handling=1' : '')),
  board: (days) => api('/ticketing/board' + (days ? '?days=' + days : '')),
  canHandle: () => api('/ticketing/can-handle'),
  get: (id) => api('/ticketing/' + id),
  create: (data) => api('/ticketing', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, patch) => api('/ticketing/' + id, { method: 'PATCH', body: JSON.stringify(patch) }),
  addComment: (id, body) => api('/ticketing/' + id + '/comments', { method: 'POST', body: JSON.stringify({ body }) }),
  // Photos are shrunk here rather than at each call site, so every path that
  // attaches a file (submit form, comment box, desktop or mobile) gets it.
  uploadAttachment: async (id, file, commentId) => {
    const payload = await downscaleImage(file)
    const fd = new FormData()
    fd.append('file', payload)
    if (commentId) fd.append('comment_id', commentId)
    return api('/ticketing/' + id + '/attachments', { method: 'POST', body: fd })
  },
  attachmentUrl: (attachmentId) => api('/ticketing/attachments/' + attachmentId + '/url'),
  // Public share link: no login, no expiry, revocable. Handlers/admins only.
  shareAttachment: (attachmentId) => api('/ticketing/attachments/' + attachmentId + '/share', { method: 'POST' }),
  unshareAttachment: (attachmentId) => api('/ticketing/attachments/' + attachmentId + '/share', { method: 'DELETE' }),
}

// Google Chat connection for the ticket bridge. When a staff member assigns or
// @mentions someone, the target gets a Chat DM sent as the actor — which needs
// the actor's Google token to carry the Chat scopes granted here.
export const googleChat = {
  status: () => api('/google-chat/status'),
  authorizeUrl: () => api('/google-chat/authorize-url', { method: 'POST' }),
  disconnect: () => api('/google-chat/disconnect', { method: 'POST' }),
  // The shared sender used for ticket-creation notices (noreply@), admin only.
  systemStatus: () => api('/google-chat/system/status'),
  systemAuthorizeUrl: () => api('/google-chat/system/authorize-url', { method: 'POST' }),
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

// Blog Automation
export const blogAutomation = {
  posts: (location) => api(`/blog-automation/posts${location ? `?location=${encodeURIComponent(location)}` : ''}`),
  status: () => api('/blog-automation/status'),
  run: (location, publish) => api('/blog-automation/run', { method: 'POST', body: JSON.stringify({ location, publish }) }),
  runAll: (publish) => api('/blog-automation/run-all', { method: 'POST', body: JSON.stringify({ publish }) }),
}

// Daily Snapshot
export async function getDailySnapshot({ date, location } = {}) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (location) params.set('location', location)
  const qs = params.toString()
  return api('/reports/daily-snapshot' + (qs ? '?' + qs : ''))
}

// Monthly POS sales-commission CSV upload (Admin → Payroll Commissions).
export async function previewSalesCommissions(file) {
  const fd = new FormData(); fd.append('file', file)
  return api('/reports/payroll/sales-commissions/preview', { method: 'POST', body: fd })
}

export async function applySalesCommissions(file, period) {
  const fd = new FormData(); fd.append('file', file); fd.append('period', period)
  return api('/reports/payroll/sales-commissions/apply', { method: 'POST', body: fd })
}

// Childcare headcounts (Admin → Reports → Childcare).
export async function getChildcareReport({ start, end, locationSlug } = {}, options = {}) {
  const qs = new URLSearchParams({ start, end })
  if (locationSlug) qs.set('location_slug', locationSlug)
  return api('/reports/childcare?' + qs.toString(), options)
}
