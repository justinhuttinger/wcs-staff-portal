// Validation for the Admin -> Tour Check-In outcome editor.
//
// The editor speaks in three pass modes because that is how staff think about
// it; the table stores two columns because that is what the kiosk and the
// reports read. This file is the only place the two are translated:
//
//   none   -> grants_pass false, default_pass_days null   (Only Tour, NLPT)
//   fixed  -> grants_pass true,  default_pass_days N      (Trial 7, VIP 14)
//   choose -> grants_pass true,  default_pass_days null   (Custom Pass)

// Same ceiling as the trial-days route: a longer pass is a typo, and it writes a
// real expiration date into ABC.
const MAX_PASS_DAYS = 90

// The name is the key tour_intakes.outcome stores and the outbound webhook
// sends, so it is fixed once created: renaming would split one outcome's
// history in two. Kept short enough to fit a button on the iPad.
const MAX_NAME = 40

function passModeOf(row) {
  if (!row.grants_pass) return 'none'
  return row.default_pass_days == null ? 'choose' : 'fixed'
}

/**
 * @param body        { outcome?, pass_mode, pass_days?, location_slugs, counts_as_tour, sort_order? }
 * @param validSlugs  lowercase club names that exist
 * @param isNew       true on create, when the name is required
 * @returns { errors: string[], row }
 */
function validateOutcome(body, validSlugs, isNew) {
  const b = body || {}
  const errors = []
  const row = {}

  if (isNew) {
    const name = String(b.outcome || '').trim().replace(/\s+/g, ' ')
    if (!name) errors.push('Name is required.')
    else if (name.length > MAX_NAME) errors.push(`Name must be ${MAX_NAME} characters or fewer.`)
    row.outcome = name
    row.label = name
  }

  const mode = b.pass_mode
  if (mode === 'none') {
    row.grants_pass = false
    row.default_pass_days = null
  } else if (mode === 'choose') {
    row.grants_pass = true
    row.default_pass_days = null
  } else if (mode === 'fixed') {
    const n = Number(b.pass_days)
    if (!Number.isInteger(n) || n < 1 || n > MAX_PASS_DAYS) {
      errors.push(`Pass length must be a whole number from 1 to ${MAX_PASS_DAYS} days.`)
    }
    row.grants_pass = true
    row.default_pass_days = n
  } else {
    errors.push('Pick a pass length: none, a fixed number of days, or staff choose.')
  }

  // null = every club. An empty list is refused rather than stored: the kiosk
  // reads an empty list as every club, so it would mean the opposite of what
  // the editor showed. To take an outcome away everywhere, delete it.
  if (b.location_slugs === null) {
    row.location_slugs = null
  } else if (Array.isArray(b.location_slugs)) {
    const slugs = [...new Set(b.location_slugs.map(s => String(s).trim().toLowerCase()))]
    const unknown = slugs.filter(s => !validSlugs.includes(s))
    if (!slugs.length) errors.push('Pick at least one club, or All clubs.')
    if (unknown.length) errors.push('Unknown club: ' + unknown.join(', '))
    row.location_slugs = slugs.sort()
  } else {
    errors.push('Pick at least one club, or All clubs.')
  }

  row.counts_as_tour = b.counts_as_tour !== false
  // is_sale is left alone: nothing reads it. Sales in every report come from
  // ABC signups matched to the tour, never from the outcome picked at the desk.

  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order)
    if (!Number.isInteger(n)) errors.push('Order must be a whole number.')
    else row.sort_order = n
  }

  return { errors, row }
}

module.exports = { validateOutcome, passModeOf, MAX_PASS_DAYS }
