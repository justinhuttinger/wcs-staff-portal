// Front-end mirror of the server's marketingContext() (auth/src/middleware/
// role.js). Derives a member's effective Marketing Tracker capabilities and
// effort-type scope from the /me payload so the UI shows exactly what the API
// will allow. Keep this in lockstep with the server logic.
//
//  * Legacy access = corporate-or-higher tier OR the marketing_addon flag.
//    Either grants all three sections (tracker / needs / research).
//  * A role/override may instead grant any subset via the marketing:<cap> and
//    marketing_type:<slug> permission keys, which arrive in visible_tools.
//  * Effort-type scope: corporate+ tier sees every type (null); otherwise the
//    granted marketing_type:* slugs win, else the member's legacy
//    marketing_types, else null (all).

const CORPORATE_ROLES = new Set(['corporate', 'director', 'marketing', 'admin'])

function isFullTier(role) {
  return CORPORATE_ROLES.has(String(role || ''))
}

export function marketingAccess(user) {
  const vt = Array.isArray(user?.visible_tools) ? user.visible_tools : []
  const role = user?.staff?.role
  const addon = !!user?.staff?.marketing_addon
  const fullTier = isFullTier(role)
  const legacy = fullTier || addon

  const caps = {
    tracker: legacy || vt.includes('marketing:tracker'),
    needs: legacy || vt.includes('marketing:needs'),
    research: legacy || vt.includes('marketing:research'),
  }

  // null = all types. Only corporate+ tier is truly unrestricted; an add-on or
  // role-granted member is limited to their granted/legacy type list.
  let types = null
  if (!fullTier) {
    const granted = vt
      .filter(k => k.startsWith('marketing_type:'))
      .map(k => k.slice('marketing_type:'.length))
    if (granted.length) types = granted
    else if (Array.isArray(user?.staff?.marketing_types) && user.staff.marketing_types.length) {
      types = user.staff.marketing_types.map(String)
    }
  }

  return { ...caps, any: caps.tracker || caps.needs || caps.research, types }
}
