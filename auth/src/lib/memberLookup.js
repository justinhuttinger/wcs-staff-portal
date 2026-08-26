// Finding a member by name, for the VIP "who referred you" picker.
//
// This goes to our own abc_members table rather than ABC. ABC cannot do it:
// GET /{club}/members ignores firstName, lastName, email and every other filter
// -- probed live, a search for "Zzzznotreal" returns all 2,575 active Salem
// members -- and there is no search endpoint on the resource. lib/abcSearch.js
// does no client-side filtering either, so it hands back thousands of unrelated
// people for any query, which is why it cannot back a picker.
//
// abc_members is the ABC sync: complete, indexed by club, and refreshed hourly.

const { supabaseAdmin } = require('../services/supabase')

const MAX_RESULTS = 8

function digits(s) {
  return String(s || '').replace(/\D+/g, '')
}

/**
 * Search one club's members by name, or by phone/email when the query looks
 * like either. Staff type what the member says, so accept all three.
 *
 * @returns {Promise<Array<{memberId, firstName, lastName, email, phone, status}>>}
 */
async function searchMembersByName(clubNumber, query) {
  const q = String(query || '').trim()
  if (q.length < 2) return []

  const cols = 'member_id, first_name, last_name, email, primary_phone, mobile_phone, member_status'
  // Active only, and only this club: a referral has to be somebody who actually
  // trains here, and offering a cancelled member invites crediting the wrong
  // person for a reward they can no longer receive.
  const base = () =>
    supabaseAdmin
      .from('abc_members')
      .select(cols)
      .eq('club_number', String(clubNumber))
      .ilike('member_status', 'active')

  const phone = digits(q)
  let rows = []

  if (phone.length >= 7) {
    // Loose pattern then an exact re-check, because PostgREST cannot strip
    // punctuation and ABC stores numbers as "(503) 555-1212".
    const last = phone.slice(-10)
    const groups = last.length === 10
      ? `%${last.slice(0, 3)}%${last.slice(3, 6)}%${last.slice(6)}%`
      : `%${last}%`
    const { data } = await base()
      .or(`primary_phone.ilike.${groups},mobile_phone.ilike.${groups}`)
      .limit(MAX_RESULTS)
    rows = data || []
  } else if (q.includes('@')) {
    const { data } = await base().ilike('email', `%${q}%`).limit(MAX_RESULTS)
    rows = data || []
  } else {
    // "Henry Magnuson" searches both parts; a single word searches either.
    const parts = q.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      const [first, ...rest] = parts
      const lastName = rest.join(' ')
      const { data } = await base()
        .ilike('first_name', `${first}%`)
        .ilike('last_name', `${lastName}%`)
        .limit(MAX_RESULTS)
      rows = data || []
    }
    if (!rows.length) {
      const { data } = await base()
        .or(`first_name.ilike.${q}%,last_name.ilike.${q}%`)
        .limit(MAX_RESULTS)
      rows = data || []
    }
  }

  return rows.map(r => ({
    memberId: r.member_id,
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    email: r.email || '',
    phone: r.primary_phone || r.mobile_phone || '',
    status: r.member_status || '',
  }))
}

module.exports = { searchMembersByName }
