// Filling in the member name on a Day One.
//
// MOST DAY ONES HAVE NO contact_name. The booking widget writes the appointment
// before anybody types a name onto it: of 1,775 Day Ones in 2026, 499 carry no
// name of their own. Every one of those has a ghl_contact_id, so the name is a
// single lookup away — and a chase list that says "Unnamed member" forty-six
// times cannot do the only job it has.
//
// THIS LIVES IN ITS OWN MODULE BECAUSE THREE PLACES NEED IT and the third one
// did not have it. The pending panel and the records sets resolved names; the
// Problem Areas drill-down, written later, built its own list straight off
// contact_name and showed 46 of 66 rows as "Unnamed member". Any surface that
// shows a Day One should call this, and now there is one thing to call.

const CHUNK = 200

function lazySupabase() {
  return require('../services/supabase').supabaseAdmin
}

function fullName(c) {
  return `${c?.first_name || ''} ${c?.last_name || ''}`.trim()
}

/** Names for a set of GHL contact ids, chunked under PostgREST's `in` list cap. */
async function namesForContacts(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const out = new Map()
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await lazySupabase()
      .from('ghl_contacts_v2')
      .select('id, first_name, last_name')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const c of data || []) {
      const full = fullName(c)
      if (full) out.set(c.id, full)
    }
  }
  return out
}

/** GHL contact ids for a set of Day One appointment ids. */
async function contactIdsForAppointments(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const out = new Map()
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await lazySupabase()
      .from('day_one_appointments')
      .select('id, ghl_contact_id')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const r of data || []) out.set(r.id, r.ghl_contact_id)
  }
  return out
}

/**
 * Fill contact_name on any rows that lack one.
 *
 * Rows may carry `ghl_contact_id` directly, or only the appointment `id` — the
 * pending SQL function returns the id but not the contact, so that case is
 * looked up first. Only rows actually missing a name cost anything.
 *
 * A row whose contact has no name either is left as it was: that is a real gap,
 * and the caller still shows it as unnamed rather than inventing something.
 */
async function attachContactNames(rows) {
  const list = rows || []
  const missing = list.filter(r => !String(r.contact_name || '').trim())
  if (missing.length === 0) return list

  const needLookup = missing.filter(r => !r.ghl_contact_id && r.id)
  const byAppt = needLookup.length
    ? await contactIdsForAppointments(needLookup.map(r => r.id))
    : new Map()

  const contactIdOf = r => r.ghl_contact_id || byAppt.get(r.id)
  const names = await namesForContacts(missing.map(contactIdOf))

  return list.map(r => (
    String(r.contact_name || '').trim()
      ? r
      : { ...r, contact_name: names.get(contactIdOf(r)) || r.contact_name }
  ))
}

module.exports = { attachContactNames, namesForContacts, contactIdsForAppointments }
