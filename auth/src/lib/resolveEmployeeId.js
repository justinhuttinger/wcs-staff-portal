/**
 * Turning "who gave the tour" from a name into an ABC employee id.
 *
 * The tour picker offers names, because that is what the GHL roster returns and
 * what staff recognise. Its option ids are array positions, so nothing about the
 * chosen option identifies a person -- given_by_employee_id has been null on
 * every tour ever recorded, and the only link to the staffer is a name string.
 *
 * That holds up until two people share a name or somebody changes their
 * surname, at which point a report either merges two staff or splits one across
 * a rename, silently and permanently. The id is stable across both.
 *
 * Resolved on the server rather than sent by the client: it fixes the portal
 * tile and the iPad at once, needs no coordinated deploy, and the name is the
 * only thing either of them actually knows.
 */

const { supabaseAdmin } = require('../services/supabase')

/** "Baley  Houldson " and "baley houldson" are one person. */
function normalize(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * name -> employee id for one club, built in a single read.
 *
 * A name that matches nobody, or more than one person, is absent. Guessing
 * between two people is worse than recording the name alone: the wrong one gets
 * credited and nothing ever says so.
 *
 * @returns {Promise<Map<string, string>>} keyed by normalized name.
 */
async function employeeIdMap(clubNumber) {
  const out = new Map()
  if (!clubNumber) return out

  const { data, error } = await supabaseAdmin
    .from('abc_employees')
    .select('employee_id, full_name, first_name, last_name, status')
    .eq('club_number', String(clubNumber))
  if (error) throw new Error(error.message)

  const byName = new Map()
  for (const e of data || []) {
    const full = e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ')
    const key = normalize(full)
    if (!key || !e.employee_id) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(e)
  }

  for (const [key, rows] of byName) {
    // Active first: a departed staffer sharing a name with a current one should
    // not win, and a rehire can leave two rows for the same person.
    const active = rows.filter(e => String(e.status || '').toLowerCase() === 'active')
    const pool = active.length ? active : rows
    if (pool.length === 1) out.set(key, pool[0].employee_id)
    else {
      console.warn(
        `[resolveEmployeeId] "${key}" matches ${pool.length} employees at club ${clubNumber}; leaving unresolved`
      )
    }
  }
  return out
}

/**
 * @returns {Promise<string|null>} the ABC employee id, or null when the name
 *          matches nobody or matches more than one person.
 */
async function resolveEmployeeId(clubNumber, name) {
  const want = normalize(name)
  if (!clubNumber || !want) return null
  try {
    return (await employeeIdMap(clubNumber)).get(want) || null
  } catch (err) {
    console.error('[resolveEmployeeId] lookup failed:', err.message)
    return null
  }
}

module.exports = { resolveEmployeeId, employeeIdMap, normalize }
