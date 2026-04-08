# Day One Tracker v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new "Day One Tracker" portal tile that pulls appointments from GHL's Day One calendar, lets trainers mark outcomes, and writes results back to GHL contact custom fields.

**Architecture:** Auth API gets 3 new endpoints (appointments list, submit outcome, field options) that call the GHL Calendar and Contacts APIs directly using per-location API keys. The portal frontend shows a card-based appointment list with a stepped outcome flow (show/no-show → sale/no-sale → details). No local DB — everything is live from GHL.

**Tech Stack:** Node/Express (auth API), React 19 + Tailwind 4 (portal), GHL API v2021-07-28, native `fetch`

---

## Task 1: GHL Location Config + API Client for Auth API

**Files:**
- Create: `auth/src/config/ghlLocations.js`
- Create: `auth/src/services/ghlClient.js`

- [ ] **Step 1: Create GHL location config**

Create `auth/src/config/ghlLocations.js`:

```javascript
require('dotenv').config()

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       apiKey: process.env.GHL_API_KEY_SALEM,       name: 'Salem',       slug: 'salem' },
  { id: process.env.GHL_LOCATION_KEIZER,      apiKey: process.env.GHL_API_KEY_KEIZER,      name: 'Keizer',      slug: 'keizer' },
  { id: process.env.GHL_LOCATION_EUGENE,      apiKey: process.env.GHL_API_KEY_EUGENE,      name: 'Eugene',      slug: 'eugene' },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, apiKey: process.env.GHL_API_KEY_SPRINGFIELD, name: 'Springfield', slug: 'springfield' },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   apiKey: process.env.GHL_API_KEY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas' },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   apiKey: process.env.GHL_API_KEY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie' },
  { id: process.env.GHL_LOCATION_MEDFORD,     apiKey: process.env.GHL_API_KEY_MEDFORD,     name: 'Medford',     slug: 'medford' },
].filter(loc => loc.id && loc.apiKey)

function getLocationBySlug(slug) {
  return LOCATIONS.find(l => l.slug === slug) || null
}

module.exports = { LOCATIONS, getLocationBySlug }
```

- [ ] **Step 2: Create GHL API client**

Create `auth/src/services/ghlClient.js`:

```javascript
const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ghlFetch(path, apiKey, options = {}) {
  const { method = 'GET', params, body } = options

  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += '?' + qs
  }

  const fetchOptions = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
  }
  if (body) fetchOptions.body = JSON.stringify(body)

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, fetchOptions)

    if (res.status === 429 && attempt < 3) {
      console.warn(`[GHL] Rate limited on ${path}, retrying in 5s (attempt ${attempt}/3)`)
      await sleep(5000)
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`GHL API error ${res.status}: ${text}`)
    }

    return res.json()
  }
}

module.exports = { ghlFetch, sleep }
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/config/ghlLocations.js auth/src/services/ghlClient.js
git commit -m "feat: add GHL location config and API client for auth API"
```

---

## Task 2: Day One Tracker Backend Routes

**Files:**
- Create: `auth/src/routes/dayOneTracker.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Create the dayOneTracker route file**

Create `auth/src/routes/dayOneTracker.js`:

```javascript
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()
router.use(authenticate)
router.use(requireRole('personal_trainer'))

// Cache calendar IDs per location (Day One calendar group)
const calendarCache = {}

async function getDayOneCalendarIds(locationId, apiKey) {
  const cacheKey = locationId
  if (calendarCache[cacheKey]) return calendarCache[cacheKey]

  const data = await ghlFetch('/calendars/', apiKey, {
    params: { locationId },
  })

  const calendars = data.calendars || []
  // Find calendars in the "Day One" group (check groupId or name contains "Day One")
  const dayOneCalendars = calendars.filter(cal => {
    const name = (cal.name || '').toLowerCase()
    const group = (cal.groupName || cal.group || '').toLowerCase()
    return name.includes('day one') || group.includes('day one')
  })

  const ids = dayOneCalendars.map(c => c.id)
  if (ids.length > 0) calendarCache[cacheKey] = ids
  return ids
}

// ---------------------------------------------------------------------------
// GET /day-one-tracker/appointments
// ---------------------------------------------------------------------------
router.get('/appointments', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query

  if (!location_slug) {
    return res.status(400).json({ error: 'location_slug is required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    // Get Day One calendar IDs for this location
    const calendarIds = await getDayOneCalendarIds(location.id, location.apiKey)
    if (calendarIds.length === 0) {
      return res.json({ appointments: [] })
    }

    // Default date range: current month
    const now = new Date()
    const startTime = start_date
      ? new Date(start_date + 'T00:00:00.000Z').toISOString()
      : new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endTime = end_date
      ? new Date(end_date + 'T23:59:59.999Z').toISOString()
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    // Fetch events from each Day One calendar
    let allEvents = []
    for (const calId of calendarIds) {
      const data = await ghlFetch('/calendars/events', location.apiKey, {
        params: {
          locationId: location.id,
          calendarId: calId,
          startTime,
          endTime,
        },
      })
      allEvents.push(...(data.events || []))
    }

    // Role check: managers see all, others see only their own
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const managerLevel = ROLE_HIERARCHY.indexOf('manager')
    const isManager = userLevel >= managerLevel
    const userEmail = req.staff.email?.toLowerCase()

    if (!isManager) {
      allEvents = allEvents.filter(evt => {
        const assignedEmail = (evt.assignedUserId || evt.selectedUser || evt.calendarOwnerEmail || '').toLowerCase()
        // Also check nested user object if available
        const userEmail2 = (evt.user?.email || '').toLowerCase()
        return assignedEmail === userEmail || userEmail2 === userEmail
      })
    }

    // For each event, try to get the contact's current day_one_status and day_one_sale
    // Batch: collect unique contact IDs
    const contactIds = [...new Set(allEvents.map(e => e.contactId).filter(Boolean))]

    // Fetch contact custom fields from our synced data (faster than GHL API per contact)
    let contactFields = {}
    if (contactIds.length > 0) {
      const { data: contacts } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('id, day_one_status, day_one_sale, show_or_no_show')
        .in('id', contactIds)
      if (contacts) {
        for (const c of contacts) {
          contactFields[c.id] = c
        }
      }
    }

    // Map to response format
    const appointments = allEvents
      .map(evt => {
        const cf = contactFields[evt.contactId] || {}
        return {
          id: evt.id,
          contact_id: evt.contactId || null,
          contact_name: [evt.firstName, evt.lastName].filter(Boolean).join(' ') || evt.title || 'Unknown',
          contact_email: evt.email || null,
          appointment_time: evt.startTime || evt.start || null,
          end_time: evt.endTime || evt.end || null,
          assigned_user: evt.selectedUser || evt.assignedUserId || null,
          assigned_user_name: evt.userName || evt.user?.name || null,
          calendar_name: evt.calendarName || null,
          status: evt.appointmentStatus || evt.status || 'confirmed',
          day_one_status: cf.day_one_status || null,
          day_one_sale: cf.day_one_sale || null,
          show_or_no_show: cf.show_or_no_show || null,
        }
      })
      .sort((a, b) => new Date(b.appointment_time) - new Date(a.appointment_time))

    res.json({ appointments })
  } catch (err) {
    console.error('[DayOneTracker] Error fetching appointments:', err.message)
    res.status(500).json({ error: 'Failed to fetch appointments: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /day-one-tracker/submit
// ---------------------------------------------------------------------------
router.post('/submit', async (req, res) => {
  const { contact_id, location_slug, show_no_show, sale_result, pt_sale_type, why_no_sale } = req.body

  if (!contact_id || !location_slug || !show_no_show) {
    return res.status(400).json({ error: 'contact_id, location_slug, and show_no_show are required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    // Look up custom field IDs for this location
    const { data: fieldDefs } = await supabaseAdmin
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', location.id)
      .in('field_key', [
        'contact.day_one_status',
        'contact.show_or_no_show',
        'contact.day_one_sale',
        'contact.pt_sale_type',
        'contact.why_no_sale',
      ])

    if (!fieldDefs || fieldDefs.length === 0) {
      return res.status(500).json({ error: 'Custom field definitions not found for location' })
    }

    const fieldMap = {}
    for (const f of fieldDefs) {
      fieldMap[f.field_key] = f.id
    }

    // Build custom fields update
    const customFields = []

    // day_one_status: "Completed" if Show, "No Show" if No Show
    if (fieldMap['contact.day_one_status']) {
      customFields.push({
        id: fieldMap['contact.day_one_status'],
        value: show_no_show === 'Show' ? 'Completed' : 'No Show',
      })
    }

    // show_or_no_show
    if (fieldMap['contact.show_or_no_show']) {
      customFields.push({
        id: fieldMap['contact.show_or_no_show'],
        value: show_no_show,
      })
    }

    // day_one_sale (only if showed)
    if (show_no_show === 'Show' && sale_result && fieldMap['contact.day_one_sale']) {
      customFields.push({
        id: fieldMap['contact.day_one_sale'],
        value: sale_result,
      })
    }

    // pt_sale_type (only if sale)
    if (sale_result === 'Sale' && pt_sale_type && fieldMap['contact.pt_sale_type']) {
      customFields.push({
        id: fieldMap['contact.pt_sale_type'],
        value: pt_sale_type,
      })
    }

    // why_no_sale (only if no sale)
    if (sale_result === 'No Sale' && why_no_sale && fieldMap['contact.why_no_sale']) {
      customFields.push({
        id: fieldMap['contact.why_no_sale'],
        value: why_no_sale,
      })
    }

    // Update the contact in GHL
    await ghlFetch(`/contacts/${contact_id}`, location.apiKey, {
      method: 'PUT',
      body: { customFields },
    })

    res.json({ success: true, fields_updated: customFields.length })
  } catch (err) {
    console.error('[DayOneTracker] Error submitting:', err.message)
    res.status(500).json({ error: 'Failed to update contact: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /day-one-tracker/field-options
// ---------------------------------------------------------------------------
router.get('/field-options', async (req, res) => {
  const { location_slug } = req.query

  if (!location_slug) {
    return res.status(400).json({ error: 'location_slug is required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    const { data: fields } = await supabaseAdmin
      .from('ghl_custom_field_defs')
      .select('field_key, picklist_options')
      .eq('location_id', location.id)
      .in('field_key', ['contact.pt_sale_type', 'contact.why_no_sale'])

    const result = { pt_sale_types: [], no_sale_reasons: [] }
    for (const f of (fields || [])) {
      if (f.field_key === 'contact.pt_sale_type') {
        result.pt_sale_types = f.picklist_options || []
      } else if (f.field_key === 'contact.why_no_sale') {
        result.no_sale_reasons = f.picklist_options || []
      }
    }

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch field options: ' + err.message })
  }
})

module.exports = router
```

- [ ] **Step 2: Register routes in index.js**

In `auth/src/index.js`, add after the `/sync-status` line (line 29):

```javascript
app.use('/day-one-tracker', require('./routes/dayOneTracker'))
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/dayOneTracker.js auth/src/index.js
git commit -m "feat: add Day One Tracker backend routes (appointments, submit, field-options)"
```

---

## Task 3: Portal API Functions

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add 3 API functions**

In `portal/src/lib/api.js`, add after the `getSyncStatus` function at the bottom:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat: add Day One Tracker API functions"
```

---

## Task 4: DayOneTrackerView Frontend Component

**Files:**
- Create: `portal/src/components/DayOneTrackerView.jsx`

- [ ] **Step 1: Create the component**

Create `portal/src/components/DayOneTrackerView.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getDayOneTrackerAppointments, submitDayOneResult, getDayOneFieldOptions } from '../lib/api'

const LOCATIONS = [
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

function StatusBadge({ appointment }) {
  const s = appointment.day_one_status
  const sale = appointment.day_one_sale
  if (s === 'No Show' || appointment.show_or_no_show === 'No Show') {
    return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs border border-red-200">No Show</span>
  }
  if (s === 'Completed') {
    if (sale === 'Sale') {
      return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Sale</span>
    }
    if (sale === 'No Sale') {
      return <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">No Sale</span>
    }
    return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Completed</span>
  }
  return <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-xs border border-yellow-200">Pending</span>
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function OutcomeModal({ appointment, locationSlug, onClose, onSubmitted }) {
  const [step, setStep] = useState(1)
  const [showNoShow, setShowNoShow] = useState(null)
  const [saleResult, setSaleResult] = useState(null)
  const [ptSaleType, setPtSaleType] = useState('')
  const [whyNoSale, setWhyNoSale] = useState('')
  const [fieldOptions, setFieldOptions] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDayOneFieldOptions({ location_slug: locationSlug })
      .then(setFieldOptions)
      .catch(() => setFieldOptions({ pt_sale_types: [], no_sale_reasons: [] }))
  }, [locationSlug])

  async function handleSubmit(data) {
    setSubmitting(true)
    setError('')
    try {
      await submitDayOneResult({
        contact_id: appointment.contact_id,
        location_slug: locationSlug,
        ...data,
      })
      onSubmitted()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  function handleShowNoShow(value) {
    setShowNoShow(value)
    if (value === 'No Show') {
      handleSubmit({ show_no_show: 'No Show', sale_result: null, pt_sale_type: null, why_no_sale: null })
    } else {
      setStep(2)
    }
  }

  function handleSaleResult(value) {
    setSaleResult(value)
    setStep(3)
  }

  function handleFinalSubmit() {
    handleSubmit({
      show_no_show: 'Show',
      sale_result: saleResult,
      pt_sale_type: saleResult === 'Sale' ? ptSaleType : null,
      why_no_sale: saleResult === 'No Sale' ? whyNoSale : null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{appointment.contact_name}</h3>
            <p className="text-xs text-text-muted">{formatDateTime(appointment.appointment_time)}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        {error && <p className="text-wcs-red text-sm mb-4">{error}</p>}

        {/* Step 1: Show or No Show */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Did they show up?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleShowNoShow('Show')}
                disabled={submitting}
                className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors disabled:opacity-50"
              >
                Show
              </button>
              <button
                onClick={() => handleShowNoShow('No Show')}
                disabled={submitting}
                className="py-6 rounded-xl bg-red-50 border-2 border-red-200 text-red-600 font-bold text-lg hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                No Show
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Sale or No Sale */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Sale or No Sale?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleSaleResult('Sale')}
                className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors"
              >
                Sale
              </button>
              <button
                onClick={() => handleSaleResult('No Sale')}
                className="py-6 rounded-xl bg-gray-50 border-2 border-gray-200 text-gray-600 font-bold text-lg hover:bg-gray-100 transition-colors"
              >
                No Sale
              </button>
            </div>
            <button onClick={() => setStep(1)} className="text-xs text-text-muted hover:text-text-primary mt-2">Back</button>
          </div>
        )}

        {/* Step 3a: What did they sell */}
        {step === 3 && saleResult === 'Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">What did they sell?</p>
            <select
              value={ptSaleType}
              onChange={e => setPtSaleType(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Select sale type...</option>
              {(fieldOptions?.pt_sale_types || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              onClick={handleFinalSubmit}
              disabled={!ptSaleType || submitting}
              className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
            <button onClick={() => setStep(2)} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}

        {/* Step 3b: Why no sale */}
        {step === 3 && saleResult === 'No Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">Why no sale?</p>
            <select
              value={whyNoSale}
              onChange={e => setWhyNoSale(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Select reason...</option>
              {(fieldOptions?.no_sale_reasons || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              onClick={handleFinalSubmit}
              disabled={!whyNoSale || submitting}
              className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
            <button onClick={() => setStep(2)} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DayOneTrackerView({ user, onBack }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locationSlug, setLocationSlug] = useState('salem')
  const [activeModal, setActiveModal] = useState(null)

  useEffect(() => { loadAppointments() }, [locationSlug])

  async function loadAppointments() {
    setLoading(true)
    setError('')
    try {
      const now = new Date()
      const start_date = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
      const end_date = now.toISOString().split('T')[0]
      const res = await getDayOneTrackerAppointments({ location_slug: locationSlug, start_date, end_date })
      setAppointments(res.appointments || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const pending = appointments.filter(a => !a.day_one_status && a.show_or_no_show !== 'No Show')
  const completed = appointments.filter(a => a.day_one_status || a.show_or_no_show === 'No Show')

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      {/* Header */}
      <div className="mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">Day One Tracker</h2>
          {pending.length > 0 && (
            <span className="px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-sm font-medium border border-yellow-200">
              {pending.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Location Selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {LOCATIONS.map(loc => (
          <button
            key={loc.slug}
            onClick={() => setLocationSlug(loc.slug)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              locationSlug === loc.slug
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}

      {/* Loading */}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading Day One appointments...</p>}

      {!loading && (
        <>
          {/* Pending Section */}
          {pending.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Pending</h3>
              <div className="flex flex-col gap-2">
                {pending.map(apt => (
                  <button
                    key={apt.id}
                    onClick={() => setActiveModal(apt)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-surface border border-border hover:border-wcs-red/50 transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{apt.contact_name}</p>
                      <p className="text-xs text-text-muted mt-0.5">{formatDateTime(apt.appointment_time)}</p>
                      {apt.assigned_user_name && (
                        <p className="text-xs text-text-muted">Trainer: {apt.assigned_user_name}</p>
                      )}
                    </div>
                    <StatusBadge appointment={apt} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Completed Section */}
          {completed.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Completed</h3>
              <div className="flex flex-col gap-2">
                {completed.map(apt => (
                  <div
                    key={apt.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-surface border border-border opacity-75"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{apt.contact_name}</p>
                      <p className="text-xs text-text-muted mt-0.5">{formatDateTime(apt.appointment_time)}</p>
                      {apt.assigned_user_name && (
                        <p className="text-xs text-text-muted">Trainer: {apt.assigned_user_name}</p>
                      )}
                    </div>
                    <StatusBadge appointment={apt} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {appointments.length === 0 && (
            <p className="text-text-muted text-sm py-8 text-center">No Day One appointments found for this month</p>
          )}
        </>
      )}

      {/* Outcome Modal */}
      {activeModal && (
        <OutcomeModal
          appointment={activeModal}
          locationSlug={locationSlug}
          onClose={() => setActiveModal(null)}
          onSubmitted={() => { setActiveModal(null); loadAppointments() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/DayOneTrackerView.jsx
git commit -m "feat: add DayOneTrackerView with stepped outcome flow"
```

---

## Task 5: Portal Integration (App.jsx + ToolGrid)

**Files:**
- Modify: `portal/src/App.jsx`
- Modify: `portal/src/components/ToolGrid.jsx`

- [ ] **Step 1: Add DayOneTrackerView to App.jsx**

In `portal/src/App.jsx`:

1. Add import after the ReportingView import (line 9):
```javascript
import DayOneTrackerView from './components/DayOneTrackerView'
```

2. Add state after `showReporting` (line 26):
```javascript
  const [showDayOneTracker, setShowDayOneTracker] = useState(false)
```

3. In the conditional rendering block (around line 141), add a new condition after `showTours` and before `showReporting`:
```jsx
      ) : showDayOneTracker ? (
        <DayOneTrackerView user={user} onBack={() => setShowDayOneTracker(false)} />
```

4. Add the `onDayOneTracker` prop to the ToolGrid (the line with `<ToolGrid`):
```jsx
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onDayOne={() => setShowDayOne(true)} onTours={() => setShowTours(true)} onDayOneTracker={() => setShowDayOneTracker(true)} />
```

- [ ] **Step 2: Add Day One Tracker tile to ToolGrid**

In `portal/src/components/ToolGrid.jsx`:

1. Add `onDayOneTracker` to the function signature (line 6):
```javascript
export default function ToolGrid({ abcUrl, location, visibleTools, locationId, onDayOne, onTours, onDayOneTracker }) {
```

2. Add the tile button after the Tours button block (after line ~131, before the `topLevelTiles.length > 0` check). Insert:
```jsx
      {onDayOneTracker && (
        <button
          onClick={onDayOneTracker}
          className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red group-hover:text-white transition-all duration-200">
            <span className="text-2xl">✅</span>
          </div>
          <div className="text-center">
            <span className="block text-base font-semibold text-text-primary">Day One Tracker</span>
            <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">v2</span>
          </div>
        </button>
      )}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/App.jsx portal/src/components/ToolGrid.jsx
git commit -m "feat: add Day One Tracker tile to portal"
```

---

## Task 6: Build and Verify

- [ ] **Step 1: Build the portal**

```bash
cd portal && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify auth module loads**

```bash
cd .. && node -e "try { require('./auth/src/routes/dayOneTracker'); console.log('OK') } catch(e) { console.error(e.message) }"
```

Expected: Will fail due to missing env vars for supabase, but module syntax should be valid.

- [ ] **Step 3: Commit build if any fixes needed, then push**

```bash
git push origin master
```
