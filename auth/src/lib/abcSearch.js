// Live ABC Financial (DataTrak) contact search — members + prospects.
// Mirrors the ABC client in ghl-sync (base + app_id/app_key headers). Used by the
// tour check-in ABC lookup. Needs ABC_APP_ID / ABC_APP_KEY in the auth env.
//
// NOTE: ABC's API docs are gated, so the search param names (firstName/lastName/
// email) and the prospects response shape are a best read of their API and may
// need a tweak after the first live test.
const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

function abcConfigured() {
  return !!(ABC_APP_ID && ABC_APP_KEY)
}

async function abcGet(path, params) {
  const url = new URL(ABC_BASE_URL + path)
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') url.searchParams.set(k, v)
  }
  const res = await fetch(url, {
    headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error('ABC ' + res.status)
    err.status = res.status
    err.body = body.slice(0, 300)
    throw err
  }
  return res.json()
}

// Members: ABC is per-club. We pull both active and inactive so cancelled/expired
// members are findable too. ABC ANDs the personal filters server-side.
async function searchMembers(club, q) {
  const out = []
  for (const activeStatus of ['active', 'inactive']) {
    const params = { joinStatus: 'member', activeStatus, page: 1 }
    if (q.firstName) params.firstName = q.firstName
    if (q.lastName) params.lastName = q.lastName
    if (q.email) params.email = q.email
    let data
    try {
      data = await abcGet('/' + club + '/members', params)
    } catch (e) {
      if (e.status === 404) continue // 404 = no matches for this club/status
      throw e
    }
    for (const m of (data.members || [])) {
      const p = m.personal || {}
      const a = m.agreement || {}
      out.push({
        type: 'member', club, id: m.memberId,
        firstName: p.firstName || '', lastName: p.lastName || '',
        email: p.email || '', phone: p.primaryPhone || p.mobilePhone || '',
        barcode: p.barcode || '', status: p.memberStatus || '',
        isActive: p.isActive === 'true' || p.isActive === true,
        membershipType: a.membershipType || '', lastCheckIn: p.lastCheckInTimestamp || '',
        salesPerson: a.salesPersonName || '',
      })
    }
  }
  return out
}

async function searchProspects(club, q) {
  const params = { page: 1 }
  if (q.firstName) params.firstName = q.firstName
  if (q.lastName) params.lastName = q.lastName
  if (q.email) params.email = q.email
  let data
  try {
    data = await abcGet('/' + club + '/prospects', params)
  } catch (e) {
    if (e.status === 404) return []
    throw e
  }
  const list = data.prospects || data.prospect || []
  const arr = Array.isArray(list) ? list : [list]
  return arr.map(pr => {
    const p = pr.personal || pr
    return {
      type: 'prospect', club, id: pr.prospectId || pr.id || '',
      firstName: p.firstName || '', lastName: p.lastName || '',
      email: p.email || '', phone: p.primaryPhone || p.mobilePhone || p.cellPhone || p.homePhone || '',
      status: pr.prospectStatus || pr.status || 'Prospect',
      createTimestamp: pr.createTimestamp || p.createTimestamp || '',
      salesPerson: pr.salesPersonName || pr.assignedTo || '',
    }
  })
}

// Search members + prospects across one or more clubs. Per-source errors are
// collected (not thrown) so one failing club/endpoint doesn't sink the search.
async function searchAbc(clubs, q) {
  const results = []
  const errors = []
  for (const club of clubs) {
    try { results.push(...await searchMembers(club, q)) }
    catch (e) { errors.push('members ' + club + ': ' + (e.status || e.message)) }
    try { results.push(...await searchProspects(club, q)) }
    catch (e) { errors.push('prospects ' + club + ': ' + (e.status || e.message)) }
  }
  return { results, errors }
}

module.exports = { abcConfigured, searchMembers, searchProspects, searchAbc }
