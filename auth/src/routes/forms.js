const { buildFormsRouter } = require('./formsHandlers')
const { requireFormsBuilder } = require('../services/formsPermissions')

// Forms module (admin-only or an RBAC 'forms' grant). Quiz Funnels share these
// handlers via routes/quizzes.js.
module.exports = buildFormsRouter({ kind: 'form', gate: requireFormsBuilder })
