// Front-end mirror of the server's marketingContext() (auth/src/middleware/
// role.js). Derives a member's effective Marketing Tracker capabilities and
// effort-type scope from the /me payload so the UI shows exactly what the API
// will allow. Keep this in lockstep with the server logic.
//
// Fully grid-driven (migration 084): capabilities and effort types come from the
// marketing:<cap> / marketing_type:<slug> grants in visible_tools (seeded per
// role, editable in Admin -> Roles). The legacy per-staff marketing_addon flag
// still grants all three sections. Backend tier gates (marketingContext) remain
// the authorization safety net; this only governs what the UI shows.

export function marketingAccess(user) {
  const vt = Array.isArray(user?.visible_tools) ? user.visible_tools : []
  const addon = !!user?.staff?.marketing_addon

  const caps = {
    tracker: addon || vt.includes('marketing:tracker'),
    needs: addon || vt.includes('marketing:needs'),
    research: addon || vt.includes('marketing:research'),
  }

  // Effort-type scope. null = all types. Granted marketing_type:* slugs win,
  // else the member's legacy marketing_types, else null (all).
  let types = null
  const granted = vt
    .filter(k => k.startsWith('marketing_type:'))
    .map(k => k.slice('marketing_type:'.length))
  if (granted.length) types = granted
  else if (Array.isArray(user?.staff?.marketing_types) && user.staff.marketing_types.length) {
    types = user.staff.marketing_types.map(String)
  }

  return { ...caps, any: caps.tracker || caps.needs || caps.research, types }
}
