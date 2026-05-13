// Writes parsed revenue rows into Supabase with idempotent "delete window then
// insert" semantics. Window = (period_start..period_end) ∩ (clubs_in_file).
//
// Called by:
//   - POST /revenue/webhook  (source = 'sendgrid_webhook')
//   - POST /revenue/upload   (source = 'admin_upload')
//
// Spec: docs/superpowers/specs/2026-05-13-revenue-reporting-design.md

const { supabaseAdmin } = require('./supabase')

const INSERT_CHUNK = 5000

async function ingestParsedRevenue({ parsed, source, uploadedBy, filename, emailSubject }) {
  if (!parsed) throw new Error('parsed payload required')
  const {
    period_start, period_end, reported_total, rows, skipped = {}, errors = [],
  } = parsed

  if (!period_start || !period_end) {
    return { ok: false, error: 'missing_period', import_id: null, skipped, errors }
  }
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), import_id: null, skipped, errors }
  }

  // 1. Insert pending import row
  const { data: importRow, error: importErr } = await supabaseAdmin
    .from('abc_revenue_imports')
    .insert({
      source,
      uploaded_by: uploadedBy || null,
      period_start,
      period_end,
      reported_total,
      computed_total: null,
      row_count: rows.length,
      filename: filename || null,
      email_subject: emailSubject || null,
      status: 'partial',
    })
    .select('id')
    .single()

  if (importErr) {
    return { ok: false, error: `import insert failed: ${importErr.message}`, import_id: null }
  }
  const sourceFileId = importRow.id

  try {
    // 2. Delete prior rows in window for clubs touched by this file
    const clubsInFile = Array.from(new Set(rows.map(r => r.club_number)))
    if (clubsInFile.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from('abc_revenue_transactions')
        .delete()
        .gte('payment_date', period_start)
        .lte('payment_date', period_end)
        .in('club_number', clubsInFile)
      if (delErr) throw new Error(`delete window failed: ${delErr.message}`)
    }

    // 3. Bulk insert in chunks
    let inserted = 0
    let computed = 0
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK).map(r => ({ ...r, source_file_id: sourceFileId }))
      const { error: insErr } = await supabaseAdmin
        .from('abc_revenue_transactions')
        .insert(chunk)
      if (insErr) throw new Error(`insert chunk ${i / INSERT_CHUNK} failed: ${insErr.message}`)
      inserted += chunk.length
      computed += chunk.reduce((s, r) => s + (r.payment_amount || 0), 0)
    }

    // 4. Finalize import row
    const reconciled = reported_total !== null && Math.abs(computed - reported_total) < 0.01
    const status = reconciled ? 'success' : 'partial'
    await supabaseAdmin
      .from('abc_revenue_imports')
      .update({
        computed_total: Number(computed.toFixed(2)),
        status,
        error_message: reconciled ? null : `drift: computed ${computed.toFixed(2)} vs reported ${reported_total}`,
      })
      .eq('id', sourceFileId)

    return {
      ok: true,
      import_id: sourceFileId,
      period_start,
      period_end,
      row_count: inserted,
      reported_total,
      computed_total: Number(computed.toFixed(2)),
      reconciled,
      skipped,
    }
  } catch (err) {
    await supabaseAdmin
      .from('abc_revenue_imports')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', sourceFileId)
    return { ok: false, error: err.message, import_id: sourceFileId, skipped }
  }
}

module.exports = { ingestParsedRevenue }
