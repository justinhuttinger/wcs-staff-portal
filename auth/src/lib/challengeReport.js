// Pure logic for the Transformation Challenge report (routes/challengeReport.js).
//
// Input is GHL Payments -> Transactions rows. A challenge entry is a payment
// that succeeded, whose product (entitySourceName, e.g. "Transformation
// Challenge - Challenger") contains the season's name_match, inside the season.
// Failed card retries are their own transactions with status "failed", so the
// status check is what keeps one person from showing up five times.

const TIERS = [
  { key: 'kick_start', label: 'Kick Start', price: 25, match: /kick\s*-?\s*start/i },
  { key: 'challenger', label: 'Challenger', price: 57, match: /challenger/i },
  { key: 'all_in', label: 'All In', price: 97, match: /all\s*-?\s*in\b/i },
]
const OTHER_TIER = { key: 'other', label: 'Other' }

// Tier from the product name first; the price only when the name says nothing
// (a renamed link). Name wins because a discount would change the price.
function tierFor(productName, amount) {
  const name = String(productName || '')
  const byName = TIERS.find(t => t.match.test(name))
  if (byName) return { key: byName.key, label: byName.label }
  const byPrice = TIERS.find(t => Number(amount) === t.price)
  if (byPrice) return { key: byPrice.key, label: byPrice.label }
  return { ...OTHER_TIER }
}

// The Pacific calendar day of an ISO timestamp, as YYYY-MM-DD.
function pacificDay(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso))
}

// Is this transaction a challenge entry for the given season?
// season: { season_start: 'YYYY-MM-DD', season_end: 'YYYY-MM-DD' | null, name_match }
function isChallengePurchase(txn, season) {
  if (!txn || txn.status !== 'succeeded') return false
  const match = String(season?.name_match || '').trim().toLowerCase()
  if (!match) return false
  if (!String(txn.entitySourceName || '').toLowerCase().includes(match)) return false
  // Fully refunded entries are not participants.
  const amount = Number(txn.amount) || 0
  if (amount > 0 && Number(txn.amountRefunded || 0) >= amount) return false
  if (!txn.createdAt) return false
  const day = pacificDay(txn.createdAt)
  if (season.season_start && day < season.season_start) return false
  if (season.season_end && day > season.season_end) return false
  return true
}

// GHL returns transactions newest first. Once a page reaches past the season
// start there is nothing older worth fetching.
function pageReachedBeforeStart(page, seasonStart) {
  if (!page.length || !seasonStart) return false
  const oldest = page[page.length - 1]
  return !!oldest.createdAt && pacificDay(oldest.createdAt) < seasonStart
}

function titleCase(s) {
  return String(s || '').trim().replace(/\s+/g, ' ')
    .toLowerCase().replace(/(^|[\s'-])\S/g, c => c.toUpperCase())
}

// One report row. `contact` is the ghl_contacts_v2 row (or a GHL contact),
// used for the phone (transactions carry no phone) and a better name.
function toRow(txn, club, contact) {
  const tier = tierFor(txn.entitySourceName, txn.amount)
  const first = contact?.first_name ?? contact?.firstName
  const last = contact?.last_name ?? contact?.lastName
  const fromContact = [first, last].filter(Boolean).join(' ')
  return {
    id: txn._id,
    contact_id: txn.contactId || null,
    name: titleCase(fromContact || txn.contactName || ''),
    email: (txn.contactEmail || contact?.email || '').trim().toLowerCase(),
    phone: contact?.phone || '',
    tier: tier.key,
    tier_label: tier.label,
    product: txn.entitySourceName || '',
    amount: Number(txn.amount) || 0,
    purchased_at: txn.createdAt,
    club_slug: club.slug,
    club_name: club.name,
  }
}

// Counts per tier and per club, for the summary cards.
function summarize(rows) {
  const byTier = {}
  for (const t of [...TIERS, OTHER_TIER]) byTier[t.key] = { label: t.label, count: 0, revenue: 0 }
  const byClub = {}
  for (const r of rows) {
    byTier[r.tier].count++
    byTier[r.tier].revenue += r.amount
    if (!byClub[r.club_slug]) {
      byClub[r.club_slug] = { slug: r.club_slug, name: r.club_name, count: 0, revenue: 0, tiers: {} }
    }
    const c = byClub[r.club_slug]
    c.count++
    c.revenue += r.amount
    c.tiers[r.tier] = (c.tiers[r.tier] || 0) + 1
  }
  return {
    total: rows.length,
    revenue: rows.reduce((s, r) => s + r.amount, 0),
    tiers: byTier,
    clubs: Object.values(byClub),
  }
}

module.exports = { TIERS, tierFor, pacificDay, isChallengePurchase, pageReachedBeforeStart, titleCase, toRow, summarize }
