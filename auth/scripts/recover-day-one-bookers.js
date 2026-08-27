#!/usr/bin/env node
//
// Recover the booking team member for Day Ones the webhook never saw.
//
//   node scripts/recover-day-one-bookers.js                  # dry run
//   node scripts/recover-day-one-bookers.js --apply          # writes
//   node scripts/recover-day-one-bookers.js --days=30        # widen the window
//
// WHY THIS IS NEEDED
// The booking webhook only exists for the clubs whose GHL workflow has been set
// up. Everywhere else a Day One arrives through the reconciler, which cannot
// know who booked it: 94% of appointments are created by GHL's booking widget
// with createdBy.userId null. Those rows land with booked_by_name empty even
// though the answer is sitting on the contact in GHL.
//
// This reads it back off the contact and fills the gap.
//
// WHAT IT WILL NOT DO
//   - overwrite an existing booked_by_name. A first-hand value from the
//     courier, the booking widget or createdBy always wins.
//   - touch a reschedule_carryover. That credit was deliberately assigned to
//     the original booker and must not be reverted to whoever rebooked.
//
// A recovered value is marked booked_by_source = 'reconciler_field' precisely
// because it MIGHT BE STALE: the contact field holds one value forever, so a
// member with two Day Ones carries only the most recent booker. That is the
// whole reason this migration exists, and a recovered value should never be
// mistaken for a first-hand one.
require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')
const { LOCATIONS, getLocationBySlug } = require('../src/config/ghlLocations')
const { ghlFetch } = require('../src/services/ghlClient')
const { getFieldId } = require('../src/services/ghlCustomFields')

const APPLY = process.argv.includes('--apply')
const daysArg = process.argv.find(a => a.startsWith('--days='))
const DAYS = daysArg ? Number(daysArg.split('=')[1]) : 1

const COURIER_FIELD = 'contact.day_one_booking_team_member'

// One GET per contact, sequential per location. GHL rate limits per location and
// backs off five seconds per 429, so a fan-out here costs far more than it saves.
async function bookerForContact(loc, contactId, fieldId) {
  const data = await ghlFetch(`/contacts/${contactId}`, loc.apiKey)
  const contact = data?.contact || data
  const hit = (contact?.customFields || []).find(f => f.id === fieldId)
  const value = hit && typeof hit.value === 'string' ? hit.value.trim() : ''
  return value || null
}

async function main() {
  console.log(APPLY ? 'RECOVER: applying' : 'RECOVER: dry run (pass --apply to write)')
  console.log(`window: Day Ones booked in the last ${DAYS} day(s)\n`)

  const since = new Date(Date.now() - DAYS * 86400000).toISOString()
  const { data: rows, error } = await supabaseAdmin
    .from('day_one_appointments')
    .select('id, location_slug, ghl_contact_id, ghl_appointment_id, scheduled_date, booked_by_name, booked_by_source')
    .is('booked_by_name', null)
    .gte('booked_at', since)
    .order('location_slug')
  if (error) throw new Error(error.message)

  console.log(`rows missing a booking team member: ${rows.length}`)
  if (!rows.length) return

  const byLocation = {}
  for (const r of rows) {
    if (!r.ghl_contact_id) continue
    ;(byLocation[r.location_slug] = byLocation[r.location_slug] || []).push(r)
  }

  let found = 0
  let blank = 0
  let failed = 0
  const updates = []

  for (const [slug, list] of Object.entries(byLocation)) {
    const loc = getLocationBySlug(slug)
    if (!loc) {
      console.log(`  ${slug.padEnd(12)} SKIPPED, no GHL config`)
      failed += list.length
      continue
    }
    let fieldId = null
    try {
      fieldId = await getFieldId(loc.id, loc.apiKey, COURIER_FIELD)
    } catch (e) {
      console.log(`  ${slug.padEnd(12)} SKIPPED, field lookup failed: ${e.message}`)
      failed += list.length
      continue
    }
    if (!fieldId) {
      console.log(`  ${slug.padEnd(12)} SKIPPED, no ${COURIER_FIELD} at this location`)
      failed += list.length
      continue
    }

    let locFound = 0
    for (const r of list) {
      try {
        const name = await bookerForContact(loc, r.ghl_contact_id, fieldId)
        if (name) {
          updates.push({ id: r.id, name, slug, date: r.scheduled_date })
          locFound++
          found++
        } else {
          blank++
        }
      } catch (e) {
        // A deleted contact, or GHL having a moment. Neither is worth aborting
        // the whole recovery for.
        console.log(`     contact ${r.ghl_contact_id}: ${e.message}`)
        failed++
      }
    }
    console.log(`  ${slug.padEnd(12)} ${locFound}/${list.length} recovered`)
  }

  console.log(`\nrecovered: ${found} | field was blank: ${blank} | errors: ${failed}`)

  if (!updates.length) return
  if (!APPLY) {
    console.log('\nSample of what would be written:')
    for (const u of updates.slice(0, 8)) {
      console.log(`  ${u.slug.padEnd(12)} ${u.date}  ->  ${u.name}`)
    }
    return
  }

  let done = 0
  for (const u of updates) {
    const { error: upErr } = await supabaseAdmin
      .from('day_one_appointments')
      .update({
        booked_by_name: u.name,
        // Marked as possibly stale on purpose. See the header.
        booked_by_source: 'reconciler_field',
        updated_at: new Date().toISOString(),
      })
      .eq('id', u.id)
      // Belt and braces against a concurrent webhook or carryover landing first.
      .is('booked_by_name', null)
    if (upErr) {
      console.log(`  update failed for ${u.id}: ${upErr.message}`)
      continue
    }
    done++
  }
  console.log(`\nwrote ${done} of ${updates.length}`)
}

main().catch(err => { console.error('RECOVERY FAILED:', err.message); process.exit(1) })
