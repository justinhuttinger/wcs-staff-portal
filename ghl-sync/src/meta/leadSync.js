// Pull Meta Instant Form leads into meta_leads (migration 223).
//
// Why: a lead id is the strongest key a Meta Purchase can carry for a member
// who came in through an Instant Form, and GHL's Facebook integration never
// keeps it (only the ad and form). metaPurchase.js looks the join up here.
//
// Which forms: the ones our ads actually point at, found from each ad's
// creative (lead_gen_form_id). Listing a Page's forms needs a Page token per
// Page; reading a form's leads works with the system user token directly, as
// long as the system user has the Page (and leads_retrieval). A form we can't
// read is logged and skipped, never fatal.
//
// Incremental: each form is read from its newest stored lead onward (first
// run: the last LOOKBACK_DAYS). Upsert on lead_id, so re-reading is harmless.
//
// Dependency-injectable (db, graph, nowMs) so tests run offline.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/`
const LOOKBACK_DAYS = parseInt(process.env.META_LEADS_LOOKBACK_DAYS || '120', 10)
// A little overlap on the incremental read, in case Meta files a lead a
// moment after one we already have.
const OVERLAP_SEC = 60 * 60

let _defaultDb = null
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase')
  return _defaultDb
}

async function graphGet(path, params = {}) {
  const url = new URL(path.startsWith('http') ? path : GRAPH + path)
  if (!path.startsWith('http')) {
    url.searchParams.set('access_token', process.env.META_ACCESS_TOKEN || '')
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
  }
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data.error) {
    const err = new Error(data.error.message || 'Meta API error')
    err.code = data.error.code
    throw err
  }
  return data
}

// Every page of a Graph list.
async function graphAll(graph, path, params) {
  const out = []
  let page = await graph(path, params)
  for (;;) {
    out.push(...(page.data || []))
    const next = page.paging && page.paging.next
    if (!next) break
    page = await graph(next)
  }
  return out
}

/** Instant Form ids (and their Page) referenced by any ad in the account. */
async function discoverForms(graph, accountId) {
  const ads = await graphAll(graph, `${accountId}/ads`, {
    fields: 'creative{object_story_spec,asset_feed_spec}',
    limit: 200,
  })
  const forms = new Map()
  for (const ad of ads) {
    const s = JSON.stringify(ad.creative || {})
    const form = s.match(/"lead_gen_form_id":"(\d+)"/)
    if (!form) continue
    const page = s.match(/"page_id":"(\d+)"/)
    if (!forms.has(form[1])) forms.set(form[1], page ? page[1] : null)
  }
  return forms
}

const EMAIL_KEYS = ['email', 'work_email']
const PHONE_KEYS = ['phone_number', 'phone', 'mobile_phone']

/** One Graph lead -> a meta_leads row. */
function parseLead(lead, formId, pageId) {
  const fields = {}
  for (const f of lead.field_data || []) {
    const v = Array.isArray(f.values) ? f.values[0] : f.values
    if (v != null && v !== '') fields[String(f.name).toLowerCase()] = String(v).trim()
  }
  const pick = keys => keys.map(k => fields[k]).find(Boolean) || null
  const email = pick(EMAIL_KEYS)
  const digits = String(pick(PHONE_KEYS) || '').replace(/\D/g, '')
  let first = fields.first_name || null
  let last = fields.last_name || null
  if (!first && fields.full_name) {
    const parts = fields.full_name.split(/\s+/)
    first = parts.shift() || null
    last = last || parts.join(' ') || null
  }
  return {
    lead_id: String(lead.id),
    form_id: String(formId),
    page_id: pageId ? String(pageId) : null,
    ad_id: lead.ad_id ? String(lead.ad_id) : null,
    campaign_id: lead.campaign_id ? String(lead.campaign_id) : null,
    created_time: new Date(lead.created_time).toISOString(),
    email: email && email.includes('@') ? email.toLowerCase() : null,
    phone: digits.length >= 10 ? digits.slice(-10) : null,
    first_name: first,
    last_name: last,
  }
}

async function newestStored(db, formId) {
  const { data, error } = await db.from('meta_leads')
    .select('created_time').eq('form_id', formId)
    .order('created_time', { ascending: false }).limit(1)
  if (error) throw new Error(`meta_leads lookup: ${error.message}`)
  return data && data[0] ? Date.parse(data[0].created_time) : null
}

async function syncMetaLeads(options = {}) {
  const {
    db = getDefaultDb(),
    graph = graphGet,
    nowMs = Date.now(),
    accountId = (() => {
      const id = process.env.META_AD_ACCOUNT_ID || ''
      return id.startsWith('act_') ? id : `act_${id}`
    })(),
  } = options
  const summary = { forms: 0, readable: 0, leads: 0, skipped: [] }

  const forms = await discoverForms(graph, accountId)
  summary.forms = forms.size

  for (const [formId, pageId] of forms) {
    const newest = await newestStored(db, formId)
    const sinceSec = newest
      ? Math.floor(newest / 1000) - OVERLAP_SEC
      : Math.floor(nowMs / 1000) - LOOKBACK_DAYS * 86400
    let leads
    try {
      leads = await graphAll(graph, `${formId}/leads`, {
        fields: 'id,created_time,ad_id,campaign_id,field_data',
        filtering: [{ field: 'time_created', operator: 'GREATER_THAN', value: sinceSec }],
        limit: 200,
      })
    } catch (err) {
      // Usually a Page the system user hasn't been given (East Side).
      summary.skipped.push({ formId, pageId, error: err.message })
      continue
    }
    summary.readable++
    if (!leads.length) continue
    const rows = leads.map(l => parseLead(l, formId, pageId))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('meta_leads').upsert(rows.slice(i, i + 500), { onConflict: 'lead_id' })
      if (error) throw new Error(`meta_leads upsert: ${error.message}`)
    }
    summary.leads += rows.length
  }
  return summary
}

module.exports = { syncMetaLeads, discoverForms, parseLead }
