// Which of the seven clubs a staff member may see and act on in Group X.
//
// The Group X routes used to be admin-only, so every caller implicitly had all
// seven clubs. Now that the tiles are on the home board for everyone, the club
// list has to be narrowed to the person's own assigned locations — and narrowed
// on the SERVER, not just by hiding pills. Every endpoint takes a club_number
// straight off the request, so without this a front desk lead at Salem could
// read (or, with the edit permission, write) Medford's calendar by changing one
// query parameter.
//
// All-location roles (marketing / corporate / director / admin — see
// canSeeAllLocations) keep every club.
const { CLUBS } = require('./groupXClubs')
const { canSeeAllLocations } = require('../middleware/role')
const { slugify } = require('../services/locationScope')

// Pure core, so the filtering is testable without Supabase: club slugs the user
// is assigned to -> the club records they may use, in CLUBS order.
function clubsForSlugs(slugs) {
  const set = new Set((slugs || []).map(s => String(s).toLowerCase()))
  return CLUBS.filter(c => set.has(c.slug))
}

// Resolves a staff member's allowed clubs. Returns [] when a restricted member
// has no assigned locations — deliberately empty rather than "all", so a
// misconfigured account sees nothing instead of everything.
async function allowedClubsFor(staff) {
  if (canSeeAllLocations(staff?.role)) return CLUBS
  const ids = staff?.location_ids || []
  if (!ids.length) return []
  const { supabaseAdmin } = require('../services/supabase')
  const { data, error } = await supabaseAdmin.from('locations').select('name').in('id', ids)
  if (error) throw new Error(error.message)
  return clubsForSlugs((data || []).map(l => slugify(l.name)))
}

module.exports = { clubsForSlugs, allowedClubsFor }
