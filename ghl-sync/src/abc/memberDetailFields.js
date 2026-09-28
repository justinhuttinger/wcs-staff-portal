/**
 * Billing / agreement / check-in detail written to GHL from an abc_members row.
 *
 * Pure: turns one abc_members row into the value each GHL custom field should
 * hold, and compares against what the cached contact already has so reconcile
 * only PUTs real changes. GHL hands values back in its own shapes (dates as
 * epoch ms, money as numbers), so comparison is per kind, not by raw string.
 */

// field key → how to read it off the abc_members row, and how to compare it.
const MEMBER_DETAIL_FIELDS = {
  'contact.next_billing_date':   { kind: 'date',   from: (m) => m.next_billing_date },
  'contact.expiration_date':     { kind: 'date',   from: (m) => m.expiration_date },
  'contact.past_due':            { kind: 'text',   from: (m) => (m.is_past_due ? 'Yes' : 'No') },
  'contact.past_due_balance':    { kind: 'number', from: (m) => m.total_past_due_balance },
  'contact.next_due_amount':     { kind: 'number', from: (m) => m.next_due_amount },
  'contact.payment_method':      { kind: 'text',   from: (m) => m.agreement_payment_method },
  'contact.agreement_term':      { kind: 'text',   from: (m) => m.agreement_term },
  'contact.member_relationship': {
    kind: 'text',
    // null = ABC didn't say; leave the field alone rather than guess.
    from: (m) => (m.is_primary_member === true ? 'Primary' : m.is_primary_member === false ? 'Add-on' : null),
  },
  // ABC timestamps are club-local "YYYY-MM-DD HH:MM:SS.ffffff"; the date part is the visit day.
  'contact.last_checkin':        { kind: 'date',   from: (m) => (m.last_check_in_timestamp ? String(m.last_check_in_timestamp).slice(0, 10) : null) },
  'contact.total_checkins':      { kind: 'number', from: (m) => m.total_check_in_count },
  'contact.abc_barcode':         { kind: 'text',   from: (m) => m.barcode },
};

function normText(v) {
  return v == null ? '' : String(v).trim();
}

// GHL stores DATE fields as epoch ms; ABC and our cache use YYYY-MM-DD.
function normDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const d = new Date(Number(v));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return String(v).trim().slice(0, 10);
}

function normNumber(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : normText(v);
}

const NORMALIZERS = { text: normText, date: normDate, number: normNumber };

/**
 * Desired value per field key for this member. A key is omitted when ABC has
 * no value, so a missing ABC value never wipes what GHL already holds.
 */
function desiredMemberDetails(member) {
  const out = {};
  for (const [key, spec] of Object.entries(MEMBER_DETAIL_FIELDS)) {
    const raw = spec.from(member);
    if (NORMALIZERS[spec.kind](raw) === '') continue;
    out[key] = spec.kind === 'number' ? Number(raw) : spec.kind === 'date' ? normDate(raw) : normText(raw);
  }
  return out;
}

/**
 * The subset of fields whose GHL value differs from ABC, as { fieldId: value }.
 * `fieldKeyToId` maps field key → this location's field id; fields the
 * location doesn't have yet are skipped.
 */
function memberDetailUpdates(member, currentCustomFields, fieldKeyToId) {
  const cf = currentCustomFields || {};
  const updates = {};
  for (const [key, value] of Object.entries(desiredMemberDetails(member))) {
    const fieldId = fieldKeyToId[key];
    if (!fieldId) continue;
    const norm = NORMALIZERS[MEMBER_DETAIL_FIELDS[key].kind];
    if (norm(cf[fieldId]) !== norm(value)) updates[fieldId] = value;
  }
  return updates;
}

// GHL's standard Date of Birth; the cache holds it as a plain date.
function dateOfBirthUpdate(member, cachedDob) {
  const desired = normDate(member.birth_date);
  if (!desired || desired === normDate(cachedDob)) return null;
  return desired;
}

module.exports = {
  MEMBER_DETAIL_FIELDS,
  MEMBER_DETAIL_FIELD_KEYS: Object.keys(MEMBER_DETAIL_FIELDS),
  desiredMemberDetails,
  memberDetailUpdates,
  dateOfBirthUpdate,
};
