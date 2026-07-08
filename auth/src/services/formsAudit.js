// Lazy-require: services/supabase creates the client at import time and throws
// without env vars. Pull it in only inside record() (matches middleware/role.js).
function db() {
  return require('./supabase').supabaseAdmin
}

// Fire-and-forget, mirrors services/auditLog.js. Never await on user paths,
// never throw. form_audit_log is append-only (enforced by trigger).
async function record(formId, actorId, action, detail = null) {
  try {
    const { error } = await db().from('form_audit_log').insert({
      form_id: formId, actor_id: actorId || null, action, detail,
    })
    if (error) console.error('[formsAudit] insert failed:', error.message)
  } catch (err) {
    console.error('[formsAudit] record threw:', err.message)
  }
}

module.exports = { record }
