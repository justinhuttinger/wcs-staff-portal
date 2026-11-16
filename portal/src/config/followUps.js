// Follow-ups (personal tracker, sends from his Gmail) is the owner's tool only. The
// API enforces the same list (FOLLOW_UPS_EMAILS, admin role required);
// this copy just decides whether the tile shows.
export const FOLLOW_UPS_EMAILS = ['justin@wcstrength.com']

export function canUseFollowUps(staff) {
  return staff?.role === 'admin' && FOLLOW_UPS_EMAILS.includes(String(staff?.email || '').toLowerCase())
}
