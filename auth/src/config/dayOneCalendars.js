// Which GHL calendars hold Day Ones, per club.
//
// WHY THIS IS A LIST AND NOT A RULE
// Most clubs run Day Ones on a calendar called exactly "Day One", and the code
// used to just look for that name. Two clubs don't:
//
//   Clackamas  also books a stretch-flavoured Day One on "Stretch"
//   Milwaukie  also books Day Ones on "Kirstyn Pagano-Jackson's Calendar"
//
// Those are different KINDS of Day One, unique to those clubs, and they count
// as Day Ones. But the fix is emphatically not to loosen the name match. Every
// sub-account also carries a Gym Tours calendar, trainer personal calendars and
// other booking types, and a Day One report that quietly absorbs gym tours is
// worse than one that misses a booking: nobody notices a number that is too big
// until someone acts on it.
//
// So: an explicit allowlist. Adding a club's calendar is a one-line edit here,
// and nothing is ever included by accident.
//
// FAILING LOUDLY
// A configured name that matches nothing is logged with the full list of
// calendars in that sub-account, because the failure this guards against is a
// calendar being renamed in GHL — which otherwise looks exactly like a club
// that simply stopped booking Day Ones.

const { ghlFetch } = require('../services/ghlClient')

const CAL_VERSION = '2021-04-15'
const TTL = 60 * 60 * 1000

// Every club gets this. It is the calendar the booking widget writes to.
const PRIMARY = 'Day One'

// Extra calendars that hold real Day Ones, by club slug. Names as they appear
// in GHL — compared case-insensitively, so capitalisation here doesn't matter.
const EXTRA_BY_SLUG = {
  clackamas: ['Stretch'],
  milwaukie: ["Kirstyn Pagano-Jackson's Calendar"],
}

// Curly apostrophes are the trap: a calendar named from a phone or pasted out
// of a doc carries U+2019, the config here carries U+0027, and an exact compare
// silently misses. Everything else is a plain case/whitespace fold.
function normalise(name) {
  return String(name || '')
    .replace(/[‘’ʼ]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** The calendar names that count as Day One for a club, lowest-common first. */
function dayOneCalendarNames(slug) {
  return [PRIMARY, ...(EXTRA_BY_SLUG[slug] || [])]
}

const cache = {}  // slug -> { promise, at }

/**
 * Every Day One calendar for a location, as full GHL calendar objects.
 *
 * Resolves by name against the sub-account's calendar list. A name that matches
 * nothing is warned about rather than thrown, so one renamed calendar at one
 * club cannot take that club's whole reconcile pass down with it — but the
 * PRIMARY calendar missing IS fatal, because that means the lookup is looking
 * at the wrong sub-account entirely.
 */
function resolveDayOneCalendars(loc) {
  const hit = cache[loc.slug]
  if (hit && (Date.now() - hit.at) < TTL) return hit.promise
  const promise = load(loc).catch(err => { delete cache[loc.slug]; throw err })
  cache[loc.slug] = { promise, at: Date.now() }
  return promise
}

async function load(loc) {
  const list = await ghlFetch('/calendars/', loc.apiKey, {
    params: { locationId: loc.id }, version: CAL_VERSION,
  })
  const calendars = list.calendars || []
  const byName = new Map(calendars.map(c => [normalise(c.name), c]))

  const wanted = dayOneCalendarNames(loc.slug)
  const found = []
  const missing = []
  for (const name of wanted) {
    const match = byName.get(normalise(name))
    if (match) found.push(match); else missing.push(name)
  }

  if (missing.includes(PRIMARY)) {
    throw new Error(`No "${PRIMARY}" calendar found for ${loc.name}`)
  }
  if (missing.length) {
    console.warn(
      `[dayOneCalendars] ${loc.slug}: configured calendar(s) not found: ${missing.join(', ')}. ` +
      `Calendars in this sub-account: ${calendars.map(c => c.name).join(' | ')}`)
  }
  console.log(`[dayOneCalendars] ${loc.slug}: ${found.map(c => c.name).join(' + ')}`)
  await register(loc, found)
  return found
}

/**
 * Record what this allowlist resolved to, for day_one_integrity()'s
 * phantom_calendars check (migration 192).
 *
 * The check used to carry its own hardcoded copy of the seven calendar ids, so
 * the moment this file grew Clackamas' Stretch and Milwaukie's Kirstyn calendar
 * the two lists disagreed and 61 correct rows were reported as a mis-scoped
 * workflow trigger, every Monday. The list is resolved here, so it is recorded
 * here, and there is one of it.
 *
 * Never deletes: a calendar renamed in GHL drops out of `found` (and is warned
 * about by name above), but the Day Ones already booked on it must not turn into
 * phantoms retroactively.
 *
 * Non-fatal on purpose. This is bookkeeping for a weekly report; it must never
 * be the reason a reconcile pass fails.
 *
 * Supabase is required HERE rather than at the top of the file: this module is
 * otherwise pure name-matching, and a module-level require would make merely
 * loading it depend on SUPABASE_URL being set.
 */
async function register(loc, found) {
  if (!found.length) return
  try {
    const { supabaseAdmin } = require('../services/supabase')
    const { error } = await supabaseAdmin
      .from('day_one_calendars')
      .upsert(found.map(c => ({
        ghl_calendar_id: c.id,
        location_slug: loc.slug,
        calendar_name: c.name,
        last_seen_at: new Date().toISOString(),
      })), { onConflict: 'ghl_calendar_id' })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.warn(`[dayOneCalendars] ${loc.slug}: could not record calendars: ${err.message}`)
  }
}

function clearCache(slug) {
  if (slug) delete cache[slug]; else for (const k of Object.keys(cache)) delete cache[k]
}

module.exports = {
  PRIMARY, EXTRA_BY_SLUG, dayOneCalendarNames, resolveDayOneCalendars, normalise, clearCache,
}
