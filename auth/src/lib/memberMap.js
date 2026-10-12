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

module.exports = { buildMemberMap, milesBetween, RINGS }
