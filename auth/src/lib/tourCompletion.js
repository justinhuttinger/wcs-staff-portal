// Validation and shaping for a completed tour, coming in from the portal
// product that records them. No I/O; the route fetches and writes.
//
// This is the half of the tour that reporting cares about: who gave it, which
// member it was for, and what came of it. The check-in half already exists in
// tour_intakes.
//
// EVERYTHING IS VALIDATED HERE RATHER THAN CONSTRAINED IN THE DATABASE. A
// foreign key on outcome would make an unknown value reject the whole tour and
// lose it; a 400 with the allowed list tells the caller exactly what to fix
// while the tour is still in their hands.

const { NAME_TO_CLUB } = require('../config/clubMap')

const CLUB_NUMBERS = new Set(Object.values(NAME_TO_CLUB))

function clean(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Collapse whitespace so "Jane  Doe" and "Jane Doe" are one person. */
function cleanName(v) {
  const s = clean(v)
  return s ? s.replace(/\s+/g, ' ') : null
}

function isIsoDate(v) {
  if (typeof v !== 'string') return false
  const t = Date.parse(v)
  return Number.isFinite(t)
}

/**
 * @param body            the request body
 * @param allowedOutcomes Set of outcome keys from tour_outcomes
 * @returns { ok, errors, value }
 *
 * Collects EVERY problem rather than failing on the first: a caller fixing one
 * field at a time across four round trips is a caller who gives up and writes
 * the tour down on paper.
 */
function validateTourCompletion(body, allowedOutcomes) {
  const b = body || {}
  const errors = []

  const tourIntakeId = clean(b.tourIntakeId)
  const ghlContactId = clean(b.ghlContactId)
  const abcMemberId = clean(b.abcMemberId)

  // A tour has to be attachable to somebody, or it is an anonymous tally that
  // no report can ever drill into.
  if (!tourIntakeId && !ghlContactId && !abcMemberId) {
    errors.push('one of tourIntakeId, ghlContactId or abcMemberId is required')
  }

  const clubNumber = clean(b.clubNumber)
  if (!clubNumber) errors.push('clubNumber is required')
  else if (!CLUB_NUMBERS.has(clubNumber)) {
    errors.push(`clubNumber must be one of ${[...CLUB_NUMBERS].join(', ')}`)
  }

  const outcome = clean(b.outcome)
  if (!outcome) errors.push('outcome is required')
  else if (allowedOutcomes && !allowedOutcomes.has(outcome)) {
    errors.push(`outcome must be one of ${[...allowedOutcomes].sort().join(', ')}`)
  }

  // Who GAVE the tour. Separate from whoever is posting this: a manager closing
  // out a colleague's tour must not take the credit.
  const givenByEmployeeId = clean(b.givenByEmployeeId)
  const givenByName = cleanName(b.givenByName)
  if (!givenByEmployeeId && !givenByName) {
    errors.push('givenByEmployeeId or givenByName is required')
  }

  const completedAt = clean(b.completedAt)
  if (completedAt && !isIsoDate(completedAt)) {
    errors.push('completedAt must be an ISO 8601 timestamp')
  }

  if (errors.length) return { ok: false, errors, value: null }

  return {
    ok: true,
    errors: [],
    value: {
      tourIntakeId,
      ghlContactId,
      abcMemberId,
      clubNumber,
      outcome,
      givenByEmployeeId,
      givenByName,
      notes: clean(b.notes),
      // Defaulted here rather than in the database so a replay of the same
      // payload lands on the same timestamp it was recorded with.
      completedAt: completedAt || new Date().toISOString(),
      contactName: cleanName(b.contactName),
      contactEmail: clean(b.contactEmail),
      contactPhone: clean(b.contactPhone),
    },
  }
}

/** The row to write, whether updating an intake or inserting a standalone tour. */
function toRow(v, { staffId = null } = {}) {
  return {
    status: 'completed',
    outcome: v.outcome,
    notes: v.notes,
    completed_at: v.completedAt,
    completed_by: staffId,
    abc_member_id: v.abcMemberId,
    club_number: v.clubNumber,
    given_by_employee_id: v.givenByEmployeeId,
    given_by_name: v.givenByName,
    ghl_contact_id: v.ghlContactId,
    contact_name: v.contactName,
    contact_email: v.contactEmail,
    contact_phone: v.contactPhone,
  }
}

module.exports = { validateTourCompletion, toRow, CLUB_NUMBERS }
