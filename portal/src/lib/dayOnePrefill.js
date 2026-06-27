// Append GHL booking-widget prefill params to a location's Day One base link.
// GHL honors first_name/last_name/email/phone, plus the Day One custom field
// for the tour member who ran the tour. The GHL booking widget prefills the
// custom field by its key WITHOUT the `contact.` prefix (verified live: the
// `contact.`-prefixed param does not fill; the bare `day_one_booking_team_member`
// does).
export function buildDayOneUrl(baseUrl, { name, email, phone, tourMember } = {}) {
  if (!baseUrl) return ''
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return baseUrl
  }
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const first = parts[0] || ''
  const last = parts.length > 1 ? parts.slice(1).join(' ') : ''
  const set = (k, v) => { if (v) url.searchParams.set(k, v) }
  set('first_name', first)
  set('last_name', last)
  set('email', email)
  set('phone', phone)
  set('day_one_booking_team_member', tourMember)
  return url.toString()
}
