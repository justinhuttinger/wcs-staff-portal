// Validation for the login-free childcare check-in link. Anyone holding the
// link can post, so every field is bounded and shaped here rather than trusted.
//
// Nothing is looked up or linked: each visit is exactly what the desk typed.

const MAX_NAME = 100
const MAX_CHILDREN = 6
const MAX_AGE_MONTHS = 216 // 18 years

function cleanName(value, label) {
  if (typeof value !== 'string' || !value.trim()) return { error: `${label} is required` }
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length > MAX_NAME) return { error: `${label} must be ${MAX_NAME} characters or fewer` }
  return { name }
}

// US numbers only (every club is in Oregon). Stored formatted the same way
// abc_members stores phones: "(503) 555-1234".
function parsePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return { error: 'Parent phone must be a 10-digit number' }
  return { phone: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` }
}

// The desk types a number and picks years or months.
function parseAge(value, unit) {
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) return { error: 'Age must be a whole number' }
  const n = parseInt(s, 10)
  if (unit !== 'years' && unit !== 'months') return { error: 'Age unit must be years or months' }
  const months = unit === 'years' ? n * 12 : n
  if (months > MAX_AGE_MONTHS) return { error: 'Age looks wrong, check the number' }
  return { months }
}

/**
 * Check-in body -> rows to insert, or { error }.
 * {
 *   parent_name, parent_phone, membership_kind: 'monthly'|'drop_in',
 *   alt_pickup: bool, alt_pickup_name,
 *   children: [{ name, age, age_unit }]
 * }
 */
function parseCheckin(body, clubNumber) {
  const b = body || {}

  const parent = cleanName(b.parent_name, 'Parent name')
  if (parent.error) return parent
  const phone = parsePhone(b.parent_phone)
  if (phone.error) return phone
  if (b.membership_kind !== 'monthly' && b.membership_kind !== 'drop_in') {
    return { error: 'Choose Monthly or Drop-in' }
  }

  let altPickup = null
  if (b.alt_pickup === true) {
    const alt = cleanName(b.alt_pickup_name, 'Name of the person picking up')
    if (alt.error) return alt
    altPickup = alt.name
  }

  const children = Array.isArray(b.children) ? b.children : []
  if (children.length === 0) return { error: 'Add at least one child' }
  if (children.length > MAX_CHILDREN) return { error: `At most ${MAX_CHILDREN} children per check-in` }

  const rows = []
  for (const [i, c] of children.entries()) {
    const label = children.length > 1 ? `Child ${i + 1}` : 'Child'
    const name = cleanName(c && c.name, `${label} name`)
    if (name.error) return name
    const age = parseAge(c && c.age, c && c.age_unit)
    if (age.error) return { error: `${label}: ${age.error}` }
    rows.push({
      club_number: String(clubNumber),
      child_name: name.name,
      child_age_months: age.months,
      parent_name: parent.name,
      parent_phone: phone.phone,
      membership_kind: b.membership_kind,
      alt_pickup_name: altPickup,
    })
  }
  return { rows }
}

/**
 * Check-out body -> the update for this visit, or { error }.
 * { picked_up_by: 'same_parent'|'approved_alternate'|'other', name }
 * The visit row is needed to fill the approved person's name from what was
 * recorded at check-in, so the desk cannot change it at the door.
 */
function parseCheckout(body, visit) {
  const by = (body || {}).picked_up_by
  if (by === 'same_parent') {
    return { update: { checked_out_by: 'same_parent', checked_out_by_name: visit.parent_name } }
  }
  if (by === 'approved_alternate') {
    if (!visit.alt_pickup_name) return { error: 'No one else was approved for pickup at check-in' }
    return { update: { checked_out_by: 'approved_alternate', checked_out_by_name: visit.alt_pickup_name } }
  }
  if (by === 'other') {
    const name = cleanName((body || {}).name, 'Name of the person picking up')
    if (name.error) return name
    return { update: { checked_out_by: 'other', checked_out_by_name: name.name } }
  }
  return { error: 'Choose who is picking up' }
}

module.exports = { MAX_CHILDREN, parsePhone, parseAge, parseCheckin, parseCheckout }
