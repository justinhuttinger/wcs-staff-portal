const ROLE_HIERARCHY = ['front_desk', 'personal_trainer', 'lead', 'manager', 'director', 'admin']

function requireRole(minimumRole) {
  const minLevel = ROLE_HIERARCHY.indexOf(minimumRole)
  if (minLevel === -1) throw new Error('Invalid role: ' + minimumRole)

  return (req, res, next) => {
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Insufficient role. Requires: ' + minimumRole })
    }
    next()
  }
}

module.exports = { requireRole, ROLE_HIERARCHY }
