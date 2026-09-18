// Preview half of the multi-club ad launch: take one ad set + variant template
// and show exactly what each selected club would get, before anything is
// written to Meta. Pure functions only — no network, no database — so the
// preview costs zero API calls and is cheap to test.
//
// PR 2 reuses these to build the real writes, so what you previewed is what
// gets created.
const { renderFields, missingTokens, collectStrings } = require('./adsTokens')

// The token values for a club: its own tokens, plus {{club}} filled in from the
// location name so nobody has to type the obvious one. An explicit `club` token
// wins, because a club's marketing name is not always its record name.
function clubTokenValues(club) {
  return { club: club.name, ...(club.tokens || {}) }
}

// What stops this club from launching, in words an admin can act on. These are
// setup gaps (Club Setup), as opposed to missing tokens (the ad copy).
function clubBlockers(club) {
  const out = []
  if (!club.page_id) out.push('No Facebook Page set for this club')
  const targeting = club.targeting || {}
  if (!Object.keys(targeting).length) out.push('No geo targeting set for this club')
  if (!club.link && !club.lead_form_id) out.push('No destination link or lead form set for this club')
  return out
}

function previewForClub(club, template) {
  const values = clubTokenValues(club)
  const missing = missingTokens(collectStrings(template), values)
  const blockers = clubBlockers(club)
  return {
    location_id: club.location_id,
    name: club.name,
    // Rendered with whatever is known: unfilled tokens stay visible as
    // {{token}} so the gap is obvious on screen rather than silent.
    rendered: renderFields(template, values),
    missing_tokens: missing,
    blockers,
    ready: !missing.length && !blockers.length,
  }
}

function previewLaunch(clubs, template) {
  const previews = (clubs || []).map(c => previewForClub(c, template))
  return {
    clubs: previews,
    ready: previews.length > 0 && previews.every(p => p.ready),
    ready_clubs: previews.filter(p => p.ready).map(p => p.location_id),
    blocked_clubs: previews.filter(p => !p.ready).map(p => p.location_id),
  }
}

module.exports = { clubTokenValues, clubBlockers, previewForClub, previewLaunch }
