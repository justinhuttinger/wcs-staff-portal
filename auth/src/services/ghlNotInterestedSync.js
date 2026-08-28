const { supabaseAdmin } = require('./supabase')

// ---------------------------------------------------------------------------
// Sync: contacts who finished the "Not Interested Categorization" workflow.
//
// NOT A TAG. Lead Sources originally counted the 'not interested' tag and found
// 34 contacts; the workflow has around 3,800. The tag is applied at Eugene and
// nowhere else, so reading it as the signal understated not-interested by about
// a hundredfold.
//
// THE FILTER IS UNDOCUMENTED. contacts/search accepts
// { field: 'finishedWorkflows', operator: 'eq', value: <workflowId> }, which
// appears in no published list of supported filters. It was verified against
// the live API; if GHL ever withdraws it this sync starts returning zero, which
// is why every run records its own status rather than silently writing nothing.
//
// Run on a schedule, never on a report load: it is a paginated POST per club.
// ---------------------------------------------------------------------------

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'

// The workflow is named "Not Interested Categorization" — not "Not Interested
// Trigger", which is what it is called in conversation. Matched case-insensitively
// and trimmed, because a rename to sentence case should not silently break this.
const WORKFLOW_NAME = /^not interested categorization$/i

const CLUBS = [
  { slug: 'salem', env: 'SALEM' },
  { slug: 'keizer', env: 'KEIZER' },
  { slug: 'eugene', env: 'EUGENE' },
  { slug: 'springfield', env: 'SPRINGFIELD' },
  { slug: 'clackamas', env: 'CLACKAMAS' },
  { slug: 'milwaukie', env: 'MILWAUKIE' },
  { slug: 'medford', env: 'MEDFORD' },
]

const PAGE_LIMIT = 100

function credsFor(club) {
  return {
    key: process.env[`GHL_API_KEY_${club.env}`],
    locationId: process.env[`GHL_LOCATION_${club.env}`],
  }
}

async function ghlFetch(path, key, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GHL HTTP ${res.status} ${body.slice(0, 160)}`)
  }
  return res.json()
}

async function findWorkflow(key, locationId) {
  const data = await ghlFetch(`/workflows/?locationId=${encodeURIComponent(locationId)}`, key)
  return (data.workflows || []).find(w => WORKFLOW_NAME.test(String(w.name || '').trim())) || null
}

/**
 * Every contact that finished the workflow, paged.
 *
 * Paginated with searchAfter from the last contact rather than an offset:
 * offsets drift while the underlying set changes, and this set changes all day.
 */
async function fetchFinished(key, locationId, workflowId) {
  const out = []
  let searchAfter = null

  for (let page = 0; page < 200; page++) {
    const body = {
      locationId,
      pageLimit: PAGE_LIMIT,
      filters: [{ field: 'finishedWorkflows', operator: 'eq', value: workflowId }],
      ...(searchAfter ? { searchAfter } : {}),
    }
    const data = await ghlFetch('/contacts/search', key, { method: 'POST', body: JSON.stringify(body) })
    const rows = data.contacts || []
    if (rows.length === 0) break
    out.push(...rows.map(r => r.id).filter(Boolean))
    const last = rows[rows.length - 1]
    searchAfter = last && last.searchAfter
    // Without a cursor the next page would repeat this one for ever.
    if (!searchAfter || rows.length < PAGE_LIMIT) break
  }
  return [...new Set(out)]
}

/**
 * Sync every club. One club failing does not stop the others: a report that
 * loses six clubs because one token expired is worse than one that says which
 * club is stale.
 */
async function syncNotInterested({ clubs = CLUBS } = {}) {
  const summary = []

  for (const club of clubs) {
    const { key, locationId } = credsFor(club)
    if (!key || !locationId) {
      summary.push({ slug: club.slug, status: 'failed', error: 'no credentials', contacts: 0 })
      continue
    }

    try {
      const wf = await findWorkflow(key, locationId)
      if (!wf) {
        // Medford has no such workflow. Recorded explicitly: "nobody was marked
        // not interested" and "there is nothing to mark them with" are
        // different facts, and only one is about the staff.
        await supabaseAdmin.from('ghl_not_interested_sync').upsert({
          location_slug: club.slug, workflow_id: null, workflow_name: null,
          contacts: 0, status: 'no_workflow', error: null, ran_at: new Date().toISOString(),
        })
        summary.push({ slug: club.slug, status: 'no_workflow', contacts: 0 })
        continue
      }

      const ids = await fetchFinished(key, locationId, wf.id)

      if (ids.length) {
        const rows = ids.map(id => ({
          contact_id: id,
          location_id: locationId,
          location_slug: club.slug,
          workflow_id: wf.id,
          synced_at: new Date().toISOString(),
        }))
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabaseAdmin
            .from('ghl_not_interested')
            .upsert(rows.slice(i, i + 500), { onConflict: 'contact_id' })
          if (error) throw new Error(error.message)
        }
      }

      await supabaseAdmin.from('ghl_not_interested_sync').upsert({
        location_slug: club.slug, workflow_id: wf.id, workflow_name: wf.name,
        contacts: ids.length, status: 'ok', error: null, ran_at: new Date().toISOString(),
      })
      summary.push({ slug: club.slug, status: 'ok', contacts: ids.length })
    } catch (err) {
      await supabaseAdmin.from('ghl_not_interested_sync').upsert({
        location_slug: club.slug, contacts: 0, status: 'failed',
        error: err.message.slice(0, 300), ran_at: new Date().toISOString(),
      }).then(() => {}, () => {})
      summary.push({ slug: club.slug, status: 'failed', error: err.message, contacts: 0 })
    }
  }

  return summary
}

module.exports = { syncNotInterested, findWorkflow, fetchFinished, WORKFLOW_NAME, CLUBS }
