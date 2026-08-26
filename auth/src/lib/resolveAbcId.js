// Finding somebody's ABC record from what the tour card knows about them.
//
// Cards raised by the GHL survey never carry an ABC id: the survey fires
// /webhooks/tour-intake and /webhook/ghl-form at the same moment, so the card is
// written ~20 seconds before the ABC record exists, and nothing goes back to
// fill it in. That left Custom Pass permanently greyed out on every real
// check-in.
//
// Rather than fix the race, resolve on demand -- staff tap the button minutes
// later, by which point the record definitely exists.
//
// Prospects are checked first: somebody being toured is usually one, and only a
// prospect can have their expiration written. Members come second, where the
// grant degrades to an alert.

const { supabaseAdmin } = require('../services/supabase')

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
// ABC caps a prospect date range at 31 days. Anyone being toured today was
// created well inside that.
const PROSPECT_WINDOW_DAYS = 30

function digits(s) {
  return String(s || '').replace(/\D+/g, '')
}

function phone10(s) {
  const d = digits(s)
  return d.length >= 10 ? d.slice(-10) : ''
}

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86400000)
  return d.toISOString().slice(0, 10)
}

async function abcGet(path, params) {
  const url = new URL(ABC_BASE_URL + path)
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') url.searchParams.set(k, v)
  }
  const res = await fetch(url, {
    headers: {
      app_id: process.env.ABC_APP_ID,
      app_key: process.env.ABC_APP_KEY,
      Accept: 'application/json',
    },
  })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

/**
 * A recent prospect matching the phone or email.
 *
 * ABC ignores every filter parameter on this resource, so the range is the only
 * narrowing we get and the match happens here. A single day range returns
 * nothing at all, hence the window.
 */
async function findProspect(clubNumber, { phone, email }) {
  const wantPhone = phone10(phone)
  const wantEmail = String(email || '').trim().toLowerCase()
  if (!wantPhone && !wantEmail) return null

  const data = await abcGet(`/${clubNumber}/prospects`, {
    beginDateRange: `${isoDaysAgo(PROSPECT_WINDOW_DAYS)},${isoDaysAgo(-1)}`,
  })
  const list = (data && data.prospects) || []

  for (const p of list) {
    const per = p.personal || {}
    const theirPhone = phone10(per.primaryPhone) || phone10(per.mobilePhone)
    const theirEmail = String(per.email || '').trim().toLowerCase()
    if (wantPhone && theirPhone && theirPhone === wantPhone) return { id: p.prospectId, type: 'prospect' }
    if (wantEmail && theirEmail && theirEmail === wantEmail) return { id: p.prospectId, type: 'prospect' }
  }
  return null
}

/** A member matching the phone or email, from our synced table. */
async function findMember(clubNumber, { phone, email }) {
  const wantPhone = phone10(phone)
  const wantEmail = String(email || '').trim().toLowerCase()
  if (!wantPhone && !wantEmail) return null

  const cols = 'member_id, primary_phone, mobile_phone, email'
  const base = () =>
    supabaseAdmin.from('abc_members').select(cols).eq('club_number', String(clubNumber))

  if (wantPhone) {
    const pattern = `%${wantPhone.slice(0, 3)}%${wantPhone.slice(3, 6)}%${wantPhone.slice(6)}%`
    const { data } = await base()
      .or(`primary_phone.ilike.${pattern},mobile_phone.ilike.${pattern}`)
      .limit(25)
    const hit = (data || []).find(
      r => phone10(r.primary_phone) === wantPhone || phone10(r.mobile_phone) === wantPhone
    )
    if (hit) return { id: hit.member_id, type: 'member' }
  }

  if (wantEmail) {
    const { data } = await base().ilike('email', wantEmail).limit(5)
    if (data && data[0]) return { id: data[0].member_id, type: 'member' }
  }

  return null
}

/**
 * @returns {Promise<{id, type}|null>} type is 'prospect' or 'member'.
 */
async function resolveAbcId(clubNumber, { phone, email }) {
  if (!clubNumber) return null
  try {
    return (await findProspect(clubNumber, { phone, email }))
      || (await findMember(clubNumber, { phone, email }))
  } catch (err) {
    console.error('[resolveAbcId] lookup failed:', err.message)
    return null
  }
}

module.exports = { resolveAbcId, findProspect, findMember, phone10 }
