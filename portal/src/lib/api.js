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

  const res = await fetch(API_URL + path, { ...options, headers })
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

// Webhook Logs
export async function getWebhookLogs(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/admin/webhook-logs' + (qs ? '?' + qs : ''))
}
