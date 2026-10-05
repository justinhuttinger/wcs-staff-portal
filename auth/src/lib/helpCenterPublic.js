// Rules for the login-free front desk Help Center (routes/publicHelpCenter.js).

// app_config key holding the shared front desk token.
const HELP_TOKEN_KEY = 'help_center_public_token'

// The front desk link shows what the lowest built-in role can read: no role
// floor, or a Team Member+ floor. Lead+ and up stay behind the login, and an
// unknown floor is treated as restricted (fail closed).
function isFrontDeskVisible(minRole) {
  return !minRole || minRole === 'team_member'
}

module.exports = { HELP_TOKEN_KEY, isFrontDeskVisible }
