// Glue: a recorded Operandio drawer CLOSE count -> a print_jobs row.
// Called from the operandio webhook's till-count branch (which already
// classified the email as a close count), so there is no job-name matching
// here — the per-location automation is just an on/off switch.
//
// Best-effort. Never throws to the caller (the Operandio webhook must not break).

const { dedupeKey, buildTillReceiptPayload } = require('./printJobs')

async function maybeEnqueueTillReceipt({ supabase, locationSlug, businessDate, loadReconciliation }) {
  try {
    const slug = String(locationSlug || '').toLowerCase()

    // 1. Is the till_close automation enabled for this location?
    const { data: automation } = await supabase
      .from('print_automations')
      .select('enabled')
      .eq('location_slug', slug)
      .maybeSingle()
    if (!automation || !automation.enabled) {
      return { enqueued: false, reason: 'no_automation' }
    }

    // 2. Is there an enabled device with a printer for this location?
    const { data: device } = await supabase
      .from('print_devices')
      .select('install_id, selected_printer, enabled')
      .eq('location_slug', slug)
      .eq('enabled', true)
      .maybeSingle()
    if (!device || !device.selected_printer) {
      return { enqueued: false, reason: 'no_device' }
    }

    // 3. Pull the reconciliation for the day (injected; wires to till service).
    const recon = await loadReconciliation(supabase, slug, businessDate)
    if (!recon) return { enqueued: false, reason: 'no_reconciliation' }

    // 4. Enqueue. Unique dedupe_key index makes a re-submit a no-op (23505).
    const payload = buildTillReceiptPayload(recon)
    const row = {
      location_slug: slug,
      install_id: device.install_id,
      type: 'till_close',
      dedupe_key: dedupeKey('till_close', slug, businessDate),
      payload,
      status: 'pending',
    }
    const { data, error } = await supabase
      .from('print_jobs').insert(row).select().maybeSingle()
    if (error) {
      if (error.code === '23505') return { enqueued: false, reason: 'duplicate' }
      return { enqueued: false, reason: 'insert_error', error: error.message }
    }
    return { enqueued: true, jobId: data.id }
  } catch (err) {
    return { enqueued: false, reason: 'exception', error: err && err.message }
  }
}

module.exports = { maybeEnqueueTillReceipt }
