// Append GHL booking-widget prefill params to a location's Day One base link.
// GHL reliably honors first_name/last_name/email/phone. The team-member param
// name is unconfirmed across calendars, so we pass a best-effort `team_member`
// AND the raw tour member as a query hint; harmless if ignored. Verify against a
// real Day One link once one is entered in the admin page (see plan known-unknowns).
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
  set('team_member', tourMember)
  return url.toString()
}
