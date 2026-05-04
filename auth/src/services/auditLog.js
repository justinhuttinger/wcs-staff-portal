const { supabaseAdmin } = require('./supabase')

/**
 * Record an audit event. Fire-and-forget — callers should NOT await this
 * for user-facing operations. Errors are logged but never thrown.
 */
async function record(staffId, eventType, opts = {}) {
  try {
    const row = {
      staff_id: staffId || null,
      event_type: eventType,
      target: opts.target || null,
      metadata: opts.metadata || null,
      hostname: opts.hostname || null,
      ip: opts.ip || null,
    }
    const { error } = await supabaseAdmin.from('audit_log').insert(row)
    if (error) console.error('[audit] insert failed:', error.message)
  } catch (err) {
    console.error('[audit] record threw:', err.message)
  }
}

module.exports = { record }
