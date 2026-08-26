#!/usr/bin/env node
//
// One-off backfill: reconstruct day_one_appointments from the legacy GHL contact
// custom fields, so reports over historical ranges keep working after the cutover.
//
//   node scripts/backfill-day-one-appointments.js            # dry run, prints a summary
//   node scripts/backfill-day-one-appointments.js --apply    # writes
//
// Safe to re-run: rows already backfilled for the same contact and date are
// skipped, and rows the reconciler owns (they have a ghl_appointment_id) are
// never touched.
//
// WHAT IS LOST, AND WHY THAT IS NOT THIS SCRIPT'S FAULT
// One contact could only ever hold ONE Day One in custom fields, so a member with
// three Day Ones arrives here as one row. That history was destroyed on write,
// years ago, and no backfill can recover it. Every row produced here is stamped
// source = 'ghl_custom_field_backfill' precisely so nobody later mistakes this
// reconstruction for first-hand data.
require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')

const APPLY = process.argv.includes('--apply')
const CHUNK = 500

// The legacy day_one_date / day_one_booking_date fields are GHL DATE PICKERS.
// They store epoch milliseconds at UTC MIDNIGHT standing for a calendar date
// with no time of day. So the date must be read in UTC: running it through a
// Pacific conversion would land on the previous evening and shift every single
// historical Day One back by one day.
function dateFromLegacy(v) {
  if (v === null || v === undefined || v === '') return null
  const ms = Number(String(v).trim())
  if (!Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

// day_one_status carried the lifecycle; show_or_no_show carried the same
// information a second time and the two sometimes disagree. Status wins, because
// it is the one the GHL workflow maintained automatically.
function statusFrom(row) {
  const s = String(row.day_one_status || '').trim().toLowerCase()
  if (s === 'completed') return 'completed'
  if (s === 'no show') return 'no_show'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'sale') return 'completed'          // 8 rows, clearly a mis-set status
  if (s === 'scheduled') return 'scheduled'
  // No status at all: 2,217 of 3,929 rows. Fall back to the show flag, then give
  // up honestly rather than inventing a completion.
  const sh = String(row.show_or_no_show || '').trim().toLowerCase()
  if (sh === 'show') return 'completed'
  if (sh === 'no show') return 'no_show'
  return 'scheduled'
}

function mapRow(row) {
  const scheduled = dateFromLegacy(row.day_one_date)
  const booked = dateFromLegacy(row.day_one_booking_date)
  // Reports key on the appointment date. Without one the row cannot be placed on
  // a timeline at all, so fall back to the booking date before giving up.
  const scheduled_date = scheduled || booked
  if (!scheduled_date) return null
  if (!row.id) return null

  const status = statusFrom(row)
  const resolved = status === 'completed' || status === 'no_show' || status === 'cancelled'
  const why = String(row.why_no_sale || '').trim()

  return {
    location_slug: row.location_slug,
    ghl_appointment_id: null,
    ghl_contact_id: row.id,
    contact_name: row.full_name || null,
    contact_email: row.email || null,
    scheduled_date,
    // Deliberately null. The legacy field genuinely has no time of day, and
    // fabricating one would invent precision that was never recorded.
    scheduled_start: null,
    booked_at: booked ? new Date(booked + 'T12:00:00Z').toISOString() : null,
    booked_by_name: row.day_one_booking_team_member || null,
    booked_by_source: row.day_one_booking_team_member ? 'legacy_field' : null,
    trainer_name: row.day_one_trainer || null,
    status,
    outcome: status === 'completed' ? (row.day_one_sale || null) : null,
    pt_sale_type: row.pt_sale_type || null,
    // The legacy field was LARGE_TEXT and collected 400+ uncategorised answers.
    // Every one of them lands in 'Other' with the original text preserved: that
    // is what they actually were, and pretending otherwise would put fake
    // structure on historical data.
    why_no_sale: why ? 'Other' : null,
    why_no_sale_other: why || null,
    // Resolved rows must not look open, or the outcome form would offer a Day One
    // from last year to a trainer. Midday on the appointment date is the least
    // wrong stamp available.
    outcome_recorded_at: resolved ? new Date(scheduled_date + 'T12:00:00Z').toISOString() : null,
    source: 'ghl_custom_field_backfill',
  }
}

async function fetchAllContacts() {
  const cols = 'id, location_slug, full_name, email, day_one_booked, day_one_booking_date, ' +
    'day_one_booking_team_member, day_one_date, day_one_status, day_one_sale, day_one_trainer, ' +
    'show_or_no_show, pt_sale_type, why_no_sale'
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('ghl_contacts_report')
      .select(cols)
      .not('day_one_booked', 'is', null)
      .neq('day_one_booked', '')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

// Keys of every row this script has already written, paginated. Returns
// 'contactId|date' strings so the caller can build a Set directly.
async function fetchAllBackfilled() {
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('day_one_appointments')
      .select('ghl_contact_id, scheduled_date')
      .eq('source', 'ghl_custom_field_backfill')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []).map(r => `${r.ghl_contact_id}|${r.scheduled_date}`))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

async function main() {
  console.log(APPLY ? 'BACKFILL: applying' : 'BACKFILL: dry run (pass --apply to write)')

  const contacts = await fetchAllContacts()
  console.log(`legacy contacts with day_one_booked: ${contacts.length}`)

  const mapped = []
  let noDate = 0
  for (const c of contacts) {
    const r = mapRow(c)
    if (!r) { noDate++; continue }
    mapped.push(r)
  }
  console.log(`mappable: ${mapped.length}`)
  console.log(`skipped, no usable date: ${noDate}`)

  // Skip anything already present, so the script is re-runnable.
  //
  // This MUST paginate. Supabase caps an unpaginated select at 1000 rows, and a
  // truncated "already done" set silently turns a no-op re-run into 642 duplicate
  // inserts. Same class of trap as the fetchAll above.
  const seen = new Set(await fetchAllBackfilled())
  const fresh = mapped.filter(r => !seen.has(`${r.ghl_contact_id}|${r.scheduled_date}`))
  console.log(`already backfilled: ${mapped.length - fresh.length}`)
  console.log(`to insert: ${fresh.length}`)

  const byStatus = {}
  for (const r of fresh) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  console.log('status split:', JSON.stringify(byStatus))
  const withTrainer = fresh.filter(r => r.trainer_name).length
  const withBooker = fresh.filter(r => r.booked_by_name).length
  console.log(`with trainer: ${withTrainer} | with booking team member: ${withBooker}`)

  if (!APPLY) {
    console.log('\nSample row:')
    console.log(JSON.stringify(fresh[0], null, 2))
    return
  }

  let done = 0
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const batch = fresh.slice(i, i + CHUNK)
    const { error: insErr } = await supabaseAdmin.from('day_one_appointments').insert(batch)
    if (insErr) throw new Error(`insert at ${i}: ${insErr.message}`)
    done += batch.length
    console.log(`inserted ${done}/${fresh.length}`)
  }
  console.log('backfill complete')
}

main().catch(err => { console.error('BACKFILL FAILED:', err.message); process.exit(1) })
