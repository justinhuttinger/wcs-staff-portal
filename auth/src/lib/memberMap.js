// Member Map: active members' geocoded home addresses against the club pins.
// Pure so the numbers can be tested without Supabase.

const EARTH_MILES = 3958.8
const RINGS = [3, 5, 10]

function milesBetween(aLat, aLng, bLat, bLng) {
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const round1 = n => (n === null ? null : Math.round(n * 10) / 10)

function titleName(first, last) {
  return [first, last]
    .map(s => String(s || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()))
    .filter(Boolean).join(' ')
}

/**
 * @param {object} p
 * @param {Array} p.members   active, counted members of the selected clubs:
 *                            { member_id, club_number, first_name, last_name,
 *                              address_line1, city, state, postal_code, address_key }
 * @param {Map}   p.geocodes  address_key -> { lat, lng } (matches only)
 * @param {Array} p.clubs     EVERY active club with a pin, { club_number, slug, name, address, lat, lng }.
 *                            Nearest-club is judged against all of them, not just the selected ones.
 * @param {Set}   p.selected  club_numbers in view
 */
function buildMemberMap({ members, geocodes, clubs, selected }) {
  const clubIndex = new Map(clubs.map((c, i) => [c.club_number, i]))
  const points = []
  const perClub = new Map()
  const bucket = cn => {
    if (!perClub.has(cn)) perClub.set(cn, { members: 0, mapped: 0, distances: [], nearerOther: 0 })
    return perClub.get(cn)
  }

  for (const m of members) {
    const home = clubIndex.get(m.club_number)
    if (home === undefined || !selected.has(m.club_number)) continue
    const b = bucket(m.club_number)
    b.members++
    const g = m.address_key ? geocodes.get(m.address_key) : null
    if (!g) continue

    let nearest = home
    let nearestMi = Infinity
    let homeMi = null
    clubs.forEach((c, i) => {
      const d = milesBetween(g.lat, g.lng, c.lat, c.lng)
      if (i === home) homeMi = d
      if (d < nearestMi) { nearestMi = d; nearest = i }
    })
    b.mapped++
    b.distances.push(homeMi)
    if (nearest !== home) b.nearerOther++

    const zip = String(m.postal_code || '').slice(0, 5)
    points.push([
      Math.round(g.lat * 1e5) / 1e5,
      Math.round(g.lng * 1e5) / 1e5,
      home,
      titleName(m.first_name, m.last_name),
      [m.address_line1, m.city, [m.state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      String(m.member_id),
      round1(homeMi),
      nearest,
    ])
  }

  // Clubs with no members in view are left out of the table entirely.
  const stats = clubs
    .filter(c => perClub.has(c.club_number))
    .map(c => {
      const b = perClub.get(c.club_number)
      const sorted = b.distances.slice().sort((x, y) => x - y)
      const within = {}
      for (const r of RINGS) {
        within[r] = b.mapped ? Math.round((sorted.filter(d => d <= r).length / b.mapped) * 1000) / 10 : null
      }
      return {
        club_number: c.club_number,
        name: c.name,
        members: b.members,
        mapped: b.mapped,
        unmapped: b.members - b.mapped,
        median_mi: round1(quantile(sorted, 0.5)),
        p90_mi: round1(quantile(sorted, 0.9)),
        within_pct: within,
        nearer_other: b.nearerOther,
      }
    })

  return {
    clubs: clubs.map(c => ({ club_number: c.club_number, slug: c.slug, name: c.name, address: c.address, lat: c.lat, lng: c.lng })),
    points,
    stats,
    rings: RINGS,
  }
}

// ---------------------------------------------------------------------------
// Who is on the map. Each population uses the same rule as the report that
// owns that number, so the map never disagrees with it:
//   active    Membership Mix: counted (abc_members_counted), not a lost status, not skip-listed
//   new       New Members records: since_date in range, not skip-listed
//   cancelled Attrition Analysis' cancels: lost status dated in range, not skip-listed
//   pending   Scheduled to Cancel: active + Pending Cancel, not skip-listed
//   pt        PT Roster today: a recurring service still running or PIF in the last 12 months
// ---------------------------------------------------------------------------

const LOST_STATUSES = ['Cancelled', 'Expired', 'Return For Collection']
const POPULATIONS = ['active', 'new', 'cancelled', 'pending', 'pt']
// How far back New Members / Cancelled can reach: what the geocoder covers (migration 237).
const HORIZON_DAYS = 730

const day = v => (v ? String(v).slice(0, 10) : null)
const inRange = (d, start, end) => !!d && d >= start && d <= end

/**
 * @param rows      abc_members rows (id, member_id, club_number, is_active,
 *                  member_status, member_status_date, since_date, membership_type, ...)
 * @param opts.countedIds Set of abc_members.id that count as members
 * @param opts.skip       Set of lower-cased skip-listed membership types
 * @param opts.ptKeys     Set of `${club_number}|${member_id}` on the PT roster
 */
function selectPopulation(rows, { population, start, end, countedIds, skip, ptKeys }) {
  const skipped = r => skip.has(String(r.membership_type || '').toLowerCase())
  switch (population) {
    case 'new':
      return rows.filter(r => !skipped(r) && inRange(day(r.since_date), start, end))
    case 'cancelled':
      return rows.filter(r => !skipped(r) && LOST_STATUSES.includes(r.member_status)
        && inRange(day(r.member_status_date), start, end))
    case 'pending':
      return rows.filter(r => !skipped(r) && r.is_active && r.member_status === 'Pending Cancel')
    case 'pt':
      return rows.filter(r => r.is_active && ptKeys.has(`${r.club_number}|${r.member_id}`))
    case 'active':
    default:
      return rows.filter(r => !skipped(r) && r.is_active && countedIds.has(r.id)
        && !LOST_STATUSES.includes(r.member_status))
  }
}

module.exports = { buildMemberMap, selectPopulation, milesBetween, RINGS, POPULATIONS, HORIZON_DAYS, LOST_STATUSES }
