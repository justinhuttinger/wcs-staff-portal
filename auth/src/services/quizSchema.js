const { INPUT_TYPES, EMAIL_RE, normalizePhone } = require('./formsSchema')

// Pure helpers for Quiz Funnels (spec: docs/superpowers/specs/2026-09-25-quiz-funnels-design.md).
// No Supabase here so every function is unit-testable.

const CLUB_SLUGS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']
const PUBLIC_BASE = 'https://forms.westcoaststrength.com'
const GHL_HOST_SUFFIXES = ['msgsndr.com', 'leadconnectorhq.com', 'gohighlevel.com', 'westcoaststrength.com']
const TRACKING_ID_RE = /^tk_[A-Za-z0-9]{8,64}$/
const PIXEL_RE = /^\d{6,20}$/
const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/

const DEFAULT_QUIZ_SETTINGS = {
  contact_step: {
    heading: 'Where should we send your results?', subtext: '',
    require_first_name: true, require_last_name: false, require_phone: true,
  },
  thank_you: { heading: "You're all set!", message: '', redirect_url: '' },
  tracking: { meta_pixel_id: '', gtm_id: '' },
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function quizSettingsWithDefaults(s) {
  const src = s && typeof s === 'object' ? s : {}
  return {
    contact_step: { ...DEFAULT_QUIZ_SETTINGS.contact_step, ...(src.contact_step || {}) },
    thank_you: { ...DEFAULT_QUIZ_SETTINGS.thank_you, ...(src.thank_you || {}) },
    tracking: { ...DEFAULT_QUIZ_SETTINGS.tracking, ...(src.tracking || {}) },
  }
}

function httpsUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' ? u : null } catch { return null }
}

// Sections not present in `input` keep their existing values.
function normalizeQuizSettings(input, existing) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'settings must be an object' }
  }
  const out = quizSettingsWithDefaults(existing)
  if (input.contact_step !== undefined) {
    const c = input.contact_step || {}
    out.contact_step = {
      heading: str(c.heading, 200), subtext: str(c.subtext, 500),
      require_first_name: !!c.require_first_name,
      require_last_name: !!c.require_last_name,
      require_phone: !!c.require_phone,
    }
  }
  if (input.thank_you !== undefined) {
    const t = input.thank_you || {}
    const redirect = str(t.redirect_url, 1000)
    if (redirect && !httpsUrl(redirect)) return { ok: false, error: 'Redirect URL must be a full https:// link' }
    out.thank_you = { heading: str(t.heading, 200), message: str(t.message, 1000), redirect_url: redirect }
  }
  if (input.tracking !== undefined) {
    const t = input.tracking || {}
    const pixel = str(t.meta_pixel_id, 40)
    const gtm = str(t.gtm_id, 40).toUpperCase()
    if (pixel && !PIXEL_RE.test(pixel)) return { ok: false, error: 'Meta Pixel ID should be digits only' }
    if (gtm && !GTM_RE.test(gtm)) return { ok: false, error: 'GTM ID should look like GTM-XXXXXXX' }
    out.tracking = { meta_pixel_id: pixel, gtm_id: gtm }
  }
  return { ok: true, settings: out }
}

// Accepts the snippet GHL shows under Settings -> External Tracking:
// <script src="https://<link-domain>/js/external-tracking.js" data-tracking-id="tk_..."></script>
function parseGhlTrackingSnippet(text) {
  const s = String(text ?? '').trim()
  if (!s) return { ok: true, src: null, trackingId: null }
  const srcM = s.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  const idM = s.match(/\bdata-tracking-id\s*=\s*["']([^"']+)["']/i)
  if (!srcM || !idM) {
    return { ok: false, error: 'Paste the full <script> snippet from GHL Settings > External Tracking' }
  }
  const url = httpsUrl(srcM[1])
  if (!url) return { ok: false, error: 'The script src must be an https:// link' }
  const host = url.hostname.toLowerCase()
  if (!GHL_HOST_SUFFIXES.some(h => host === h || host.endsWith('.' + h))) {
    return { ok: false, error: `The script host ${host} is not a GHL domain` }
  }
  if (!url.pathname.endsWith('/js/external-tracking.js')) {
    return { ok: false, error: 'That is not the GHL external-tracking.js script' }
  }
  if (!TRACKING_ID_RE.test(idM[1])) return { ok: false, error: 'The tracking id should start with tk_' }
  return { ok: true, src: url.toString(), trackingId: idM[1] }
}

function validateWebhookUrl(url) {
  const s = String(url ?? '').trim()
  if (!s) return { ok: true, url: null }
  if (s.length > 1000) return { ok: false, error: 'Webhook URL is too long' }
  const u = httpsUrl(s)
  if (!u) return { ok: false, error: 'Webhook URL must be a full https:// link' }
  return { ok: true, url: u.toString() }
}

function validateContact(contact, contactStep) {
  const c = contact && typeof contact === 'object' ? contact : {}
  const step = { ...DEFAULT_QUIZ_SETTINGS.contact_step, ...(contactStep || {}) }
  const errors = {}
  const cleaned = {}
  const first = str(c.first_name, 100)
  const last = str(c.last_name, 100)
  const email = str(c.email, 254)
  const phone = str(c.phone, 40)
  if (first) cleaned.first_name = first
  else if (step.require_first_name) errors.first_name = 'First name is required'
  if (last) cleaned.last_name = last
  else if (step.require_last_name) errors.last_name = 'Last name is required'
  if (!email) errors.email = 'Email is required'
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address'
  else cleaned.email = email.toLowerCase()
  if (phone) {
    const p = normalizePhone(phone)
    if (p) cleaned.phone = p
    else errors.phone = 'Enter a valid 10-digit phone number'
  } else if (step.require_phone) {
    errors.phone = 'Phone is required'
  }
  return { ok: Object.keys(errors).length === 0, errors, cleaned }
}

function questionFields(schema) {
  return (schema || []).filter(f => INPUT_TYPES.includes(f.type))
}

const formatAnswer = v => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v))

function quizPublicUrl(clubSlug, slug) {
  return `${PUBLIC_BASE}/q/${clubSlug}/${slug}`
}

function buildWebhookPayload({ form, clubName, submission, test = false }) {
  const data = submission.data || {}
  const questions = questionFields(form.schema)
    .map(f => ({ question: f.label, answer: formatAnswer(data[f.id]) }))
  // Flat map for GHL's inbound-webhook mapper (it can't index arrays).
  // Repeated question text gets " (2)", " (3)" so no answer is overwritten.
  const answers = {}
  for (const item of questions) {
    let key = item.question
    let n = 2
    while (Object.prototype.hasOwnProperty.call(answers, key)) key = `${item.question} (${n++})`
    answers[key] = item.answer
  }
  const utm = submission.utm || {}
  const clubSlug = String(clubName || '').toLowerCase()
  return {
    event: 'quiz_submission',
    test: !!test,
    quiz: form.title,
    quiz_slug: form.slug,
    club: clubName || '',
    club_slug: clubSlug,
    first_name: data.first_name || '',
    last_name: data.last_name || '',
    email: data.email || '',
    phone: data.phone || '',
    answers,
    questions,
    utm_source: utm.utm_source || '',
    utm_medium: utm.utm_medium || '',
    utm_campaign: utm.utm_campaign || '',
    page_url: quizPublicUrl(clubSlug, form.slug),
    submission_id: submission.id || null,
    submitted_at: submission.submitted_at || new Date().toISOString(),
  }
}

// Fake-but-valid submission for the portal's "Send test" button, so GHL's
// mapper sees every key it will get from a real lead.
function sampleSubmission(form) {
  const data = { first_name: 'Test', last_name: 'Lead', email: 'test@example.com', phone: '(503) 555-0100' }
  for (const f of questionFields(form.schema)) {
    if (f.type === 'checkbox') data[f.id] = (f.options || []).slice(0, 2)
    else if (Array.isArray(f.options) && f.options.length) data[f.id] = f.options[0]
    else if (f.type === 'number') data[f.id] = '1'
    else if (f.type === 'date') data[f.id] = '2026-01-01'
    else if (f.type === 'email') data[f.id] = 'test@example.com'
    else if (f.type === 'phone') data[f.id] = '(503) 555-0100'
    else data[f.id] = 'Sample answer'
  }
  return { id: null, data, utm: { utm_source: 'test' }, submitted_at: new Date().toISOString() }
}

// What the public renderer may see. Deliberately rebuilt field-by-field so the
// club's webhook URL can never leak.
function publicQuizView(form, location, club) {
  const s = quizSettingsWithDefaults(form.settings)
  const hasGhl = !!(club && club.ghl_tracking_src && club.ghl_tracking_id)
  return {
    slug: form.slug,
    title: form.title,
    description: form.description || '',
    club: location.name,
    club_slug: String(location.name).toLowerCase(),
    schema: questionFields(form.schema),
    contact_step: s.contact_step,
    thank_you: s.thank_you,
    tracking: {
      ghl: hasGhl ? { src: club.ghl_tracking_src, tracking_id: club.ghl_tracking_id } : null,
      meta_pixel_id: s.tracking.meta_pixel_id || '',
      gtm_id: s.tracking.gtm_id || '',
    },
  }
}

// Every club, with its saved row (or blanks), for the portal Clubs tab.
function clubRowsView(locations, rows, form) {
  const byLoc = Object.fromEntries((rows || []).map(r => [r.location_id, r]))
  return (locations || []).map(l => {
    const r = byLoc[l.id] || {}
    const clubSlug = String(l.name).toLowerCase()
    return {
      location_id: l.id,
      name: l.name,
      club_slug: clubSlug,
      active: !!r.active,
      ghl_webhook_url: r.ghl_webhook_url || '',
      ghl_tracking_id: r.ghl_tracking_id || '',
      ghl_tracking_src: r.ghl_tracking_src || '',
      url: quizPublicUrl(clubSlug, form.slug),
    }
  })
}

// Validate a PUT /quizzes/:id/clubs body into upsert rows. Tracking only
// changes when `ghl_tracking_snippet` is sent ('' clears it).
function planClubUpserts(formId, input, existing, locations) {
  const locName = Object.fromEntries((locations || []).map(l => [l.id, l.name]))
  const prev = Object.fromEntries((existing || []).map(r => [r.location_id, r]))
  const rows = []
  for (const c of input || []) {
    const name = locName[c && c.location_id]
    if (!name) return { ok: false, error: 'Unknown club' }
    const hook = validateWebhookUrl(c.ghl_webhook_url)
    if (!hook.ok) return { ok: false, error: `${name}: ${hook.error}` }
    let src = prev[c.location_id]?.ghl_tracking_src || null
    let tid = prev[c.location_id]?.ghl_tracking_id || null
    if (c.ghl_tracking_snippet !== undefined) {
      const t = parseGhlTrackingSnippet(c.ghl_tracking_snippet)
      if (!t.ok) return { ok: false, error: `${name}: ${t.error}` }
      src = t.src
      tid = t.trackingId
    }
    rows.push({
      form_id: formId, location_id: c.location_id, active: !!c.active,
      ghl_webhook_url: hook.url, ghl_tracking_src: src, ghl_tracking_id: tid,
      updated_at: new Date().toISOString(),
    })
  }
  return { ok: true, rows }
}

module.exports = {
  CLUB_SLUGS, DEFAULT_QUIZ_SETTINGS, PIXEL_RE, GTM_RE, TRACKING_ID_RE,
  quizSettingsWithDefaults, normalizeQuizSettings, parseGhlTrackingSnippet, validateWebhookUrl,
  validateContact, questionFields, buildWebhookPayload, sampleSubmission, publicQuizView,
  quizPublicUrl, clubRowsView, planClubUpserts,
}
