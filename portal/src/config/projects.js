// Projects tile: members only. /auth/me answers projects_member from the
// members list (Admin > Projects); the API enforces the same list.
export function canUseProjects(staff) {
  return !!staff?.projects_member
}
