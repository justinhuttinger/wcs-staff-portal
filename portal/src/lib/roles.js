// Role hierarchy, shared by anything that gates on tier.
//
// Lifted out of ToolGrid because the Press nav's pinned-tab picker has to apply
// the same gates the board does — a pinned tab must never reach a view the
// user's own board would not have offered.

export const ROLE_LEVELS = {
  front_desk: 0, personal_trainer: 0, team_member: 0,
  lead: 1,
  manager: 2,
  custom: 1,
  director: 3, corporate: 3,
  // 'marketing' sits at the corporate tier so it clears any corporate gate.
  marketing: 3,
  admin: 4,
}

/** Numeric tier for a role name. Unknown roles fall to the lowest tier. */
export function roleLevel(role) {
  return ROLE_LEVELS[role] ?? 0
}

/** True when `role` is at or above the named tier. */
export function roleAtLeast(role, tier) {
  return roleLevel(role) >= (ROLE_LEVELS[tier] ?? 0)
}
