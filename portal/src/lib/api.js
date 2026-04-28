const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

let authToken = null

// Restore token from localStorage (for new tabs like Reporting)
try {
  const stored = localStorage.getItem('wcs_token')
  if (stored) authToken = stored
} catch {}

export function setToken(token) {
  authToken = token
  try { localStorage.setItem('wcs_token', token) } catch {}
}

export function getToken() {
  return authToken
}

export function clearToken() {
  authToken = null
  try { localStorage.removeItem('wcs_token') } catch {}
}

// Listeners for auth expiry (401) so the UI can redirect to login
const authExpiredListeners = new Set()
export function onAuthExpired(fn) {
  authExpiredListeners.add(fn)
  return () => authExpiredListeners.delete(fn)
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (authToken) {
    headers['Authorization'] = 'Bearer ' + authToken
  }

  // Support AbortController signal for cancellable requests
  const fetchOptions = { ...options, headers }
  if (options.signal) fetchOptions.signal = options.signal

  const res = await fetch(API_URL + path, fetchOptions)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Server error — please try again')
  }

  if (res.status === 401 && authToken && path !== '/auth/login') {
    clearToken()
    authExpiredListeners.forEach(fn => fn())
    throw new Error('Session expired — please sign in again')
  }

  if (!res.ok) {
    throw new Error(data.error || 'Request failed')
  }

  return data
}

export async function login(email, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.token)
  return data
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
export async function getMembershipReport(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/membership' + (qs ? '?' + qs : ''))
}

export async function getPTReport(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt' + (qs ? '?' + qs : ''))
}

export async function getPTRoster(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-roster' + (qs ? '?' + qs : ''))
}

export async function getVIPReport(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/vip' + (qs ? '?' + qs : ''))
}

export async function getSalespersonStats(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/salesperson-stats' + (qs ? '?' + qs : ''))
}

export async function getClubHealthReport(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/club-health' + (qs ? '?' + qs : ''))
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
export async function getMetaAdsOverview(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/overview' + (qs ? '?' + qs : ''))
}

export async function getMetaAdsCampaigns(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/campaigns' + (qs ? '?' + qs : ''))
}

export async function getMetaAdsDaily(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/daily' + (qs ? '?' + qs : ''))
}

export async function getMetaAdsets(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/adsets' + (qs ? '?' + qs : ''))
}

export async function getMetaAds(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/meta-ads/ads' + (qs ? '?' + qs : ''))
}

// Google Business Profile
export async function getGoogleBusinessStatus() {
  return api('/google-business/status')
}

export async function getGoogleBusinessLocations() {
  return api('/google-business/locations')
}

export async function getGoogleBusinessPerformance(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/google-business/performance' + (qs ? '?' + qs : ''))
}

// Google Analytics 4
export async function getGoogleAnalyticsStatus() {
  return api('/google-analytics/status')
}

function gaQuery(path, params = {}) {
  const cleaned = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = v
  }
  const qs = new URLSearchParams(cleaned).toString()
  return api(path + (qs ? '?' + qs : ''))
}

export async function getGoogleAnalyticsOverview(params = {}) {
  return gaQuery('/google-analytics/overview', params)
}

export async function getGoogleAnalyticsSources(params = {}) {
  return gaQuery('/google-analytics/sources', params)
}

export async function getGoogleAnalyticsPages(params = {}) {
  return gaQuery('/google-analytics/pages', params)
}

export async function getGoogleAnalyticsDevicesGeo(params = {}) {
  return gaQuery('/google-analytics/devices-geo', params)
}

export async function getGoogleAnalyticsKeyEvents(params = {}) {
  return gaQuery('/google-analytics/key-events', params)
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
export async function getPaychexWorkers(slug) {
  const qs = slug ? '?slug=' + encodeURIComponent(slug) : ''
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
