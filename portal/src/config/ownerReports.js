// Analytics reports flagged `ownerOnly` in ANALYTICS_REPORTS (Member Map: home
// addresses) show only for these people. The API enforces the same list
// (MEMBER_MAP_EMAILS, admin role required); this copy just decides whether the
// report is listed.
export const OWNER_REPORT_EMAILS = ['justin@wcstrength.com']

export function canSeeOwnerReports(staff) {
  return staff?.role === 'admin' && OWNER_REPORT_EMAILS.includes(String(staff?.email || '').toLowerCase())
}
