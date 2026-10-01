/**
 * Personal Training detail written to GHL (the "Personal Training" contact
 * field folder; scripts/setup-pt-fields.js creates it).
 *
 * Pure: turns a member's abc_pt_services rows (+ their PT session events from
 * abc_calendar_events) into one summary, and that into GHL field values.
 *
 * Status: Active / Past Client / None (never had PT in ABC).
 *
 * Paid in Full is the awkward one. ABC marks a PIF package inactive the moment
 * it's sold and records no end date, sessions or billed count (see the
 * abc PIF reference), so "active" is worked out instead:
 *   sessions bought = invoice_total / unit_price  (divides cleanly into the
 *                     package sizes actually sold)
 *   sessions used   = completed or charged-cancel PT sessions on the ABC
 *                     calendar since the purchase, oldest PIF used up first
 *   Active while any remain.
 * The calendar feed starts 2026-01-01, so a PIF bought before then also has
 * its pre-2026 use estimated at the measured 5.3 sessions per 30 days.
 * Sessions can't be told apart between a recurring package and a PIF held at
 * the same time, so overlapping packages are approximate.
 */
const { NORMALIZERS } = require('./memberDetailFields');

const CALENDAR_START = '2026-01-01';
const SESSIONS_PER_30_DAYS = 5.3;

// PT60, PT30, PT 60MIN, PT 60 NFW, PT 60MIN DBL, PARTNER60, Partner Training.
// Not PT Consult, Admin, Floor Hour, swim, stretch, workshops.
const SESSION_NAME_RE = /^(PT\s*\d|PARTNER\s*\d|Partner Training)/i;
const SESSION_STATUS_RE = /^(Completed|Canceled-Charge)$/i;

function isSessionEvent(ev) {
  return SESSION_NAME_RE.test(String(ev.event_name || '').trim()) && SESSION_STATUS_RE.test(String(ev.status || '').trim());
}

function ymd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function num(v) {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
}

const isPif = (row) => /paid in full/i.test(row.recurring_type_desc || '');

function sessionsBought(row) {
  const total = num(row.invoice_total);
  const unit = num(row.unit_price);
  if (!total || !unit) return null;
  return Math.round(total / unit);
}

/**
 * rows:     this member's abc_pt_services rows
 * sessions: [{ day: 'YYYY-MM-DD' }] PT sessions (already isSessionEvent-filtered)
 * today:    'YYYY-MM-DD'
 */
function summarizePt(rows, sessions, today) {
  if (!rows || !rows.length) return { status: 'None' };

  // Work out each PIF's remaining sessions, oldest purchase used first.
  const pifs = rows.filter(isPif).map(row => {
    const bought = sessionsBought(row);
    const sale = ymd(row.sale_date);
    let remaining = bought;
    if (bought !== null && sale && sale < CALENDAR_START) {
      const estUsed = Math.round(SESSIONS_PER_30_DAYS * daysBetween(sale, CALENDAR_START) / 30);
      remaining = Math.max(0, bought - estUsed);
    }
    return { row, sale, bought, remaining, usedUpOn: null };
  }).sort((a, b) => String(a.sale).localeCompare(String(b.sale)));

  const days = (sessions || []).map(s => ymd(s.day)).filter(Boolean).sort();
  for (const day of days) {
    const pkg = pifs.find(p => p.sale && p.sale <= day && p.remaining > 0);
    if (!pkg) continue;
    pkg.remaining -= 1;
    if (pkg.remaining === 0) pkg.usedUpOn = day;
  }

  const items = rows.map(row => {
    if (!isPif(row)) {
      return { row, pif: false, active: /^active/i.test(row.status || ''), sale: ymd(row.sale_date) || ymd(row.first_billing_date), ended: ymd(row.inactive_date) };
    }
    const p = pifs.find(x => x.row === row);
    return { row, pif: true, active: (p.remaining || 0) > 0, sale: p.sale, ended: p.usedUpOn, bought: p.bought, remaining: p.remaining };
  });

  const newest = (list, key) => list.slice().sort((a, b) => String(key(b) || '').localeCompare(String(key(a) || '')))[0];
  const active = items.filter(i => i.active);
  const primary = active.length
    ? newest(active, i => i.sale)
    : newest(items, i => [i.ended, i.sale].filter(Boolean).sort().pop());

  const r = primary.row;
  return {
    status: active.length ? 'Active' : 'Past Client',
    type: primary.pif ? 'PIF' : 'Recurring',
    trainer: r.trainer_name || null,
    package: r.service_item || null,
    pricePerSession: num(r.unit_price),
    billingAmount: num(r.invoice_total),
    frequency: primary.pif ? 'One Time' : (r.frequency || null),
    term: primary.pif ? 'Paid in Full' : (num(r.total_periods) ? `${num(r.total_periods)} payments` : 'Open'),
    paymentsMade: primary.pif ? null : num(r.number_billed),
    startDate: primary.sale,
    nextBillingDate: !primary.pif && primary.active ? ymd(r.next_billing_date) : null,
    endDate: primary.active ? null : primary.ended,
    soldBy: r.sales_person_name || null,
    sessionsPurchased: primary.pif ? primary.bought : null,
    sessionsRemaining: primary.pif && primary.bought !== null ? primary.remaining : null,
  };
}

// field key -> summary property + GHL kind.
const PT_FIELDS = {
  'contact.pt_status':             { kind: 'text',   from: s => s.status },
  'contact.pt_type':               { kind: 'text',   from: s => s.type },
  'contact.pt_trainer':            { kind: 'text',   from: s => s.trainer },
  'contact.pt_package':            { kind: 'text',   from: s => s.package },
  'contact.pt_price_per_session':  { kind: 'number', from: s => s.pricePerSession },
  'contact.pt_billing_amount':     { kind: 'number', from: s => s.billingAmount },
  'contact.pt_billing_frequency':  { kind: 'text',   from: s => s.frequency },
  'contact.pt_term':               { kind: 'text',   from: s => s.term },
  'contact.pt_payments_made':      { kind: 'number', from: s => s.paymentsMade },
  'contact.pt_start_date':         { kind: 'date',   from: s => s.startDate },
  'contact.pt_next_billing_date':  { kind: 'date',   from: s => s.nextBillingDate },
  'contact.pt_end_date':           { kind: 'date',   from: s => s.endDate },
  'contact.pt_sold_by':            { kind: 'text',   from: s => s.soldBy },
  'contact.pt_sessions_purchased': { kind: 'number', from: s => s.sessionsPurchased },
  'contact.pt_sessions_remaining': { kind: 'number', from: s => s.sessionsRemaining },
};
const PT_FIELD_KEYS = Object.keys(PT_FIELDS);

/** Field key -> value, for fields that have one. */
function desiredPtFields(summary) {
  const out = {};
  for (const [key, spec] of Object.entries(PT_FIELDS)) {
    const raw = spec.from(summary);
    if (NORMALIZERS[spec.kind](raw) === '') continue;
    out[key] = spec.kind === 'number' ? Number(raw) : spec.kind === 'date' ? ymd(raw) : String(raw).trim();
  }
  return out;
}

/**
 * { fieldId: value } for fields whose GHL value differs. Unlike the ABC
 * Membership fields, a PT field that no longer applies (next billing after
 * the package ended, sessions remaining on a new recurring client) is
 * cleared, so the folder always describes the package it names.
 */
function ptFieldUpdates(summary, currentCustomFields, fieldKeyToId) {
  const cf = currentCustomFields || {};
  const desired = desiredPtFields(summary);
  const updates = {};
  for (const key of PT_FIELD_KEYS) {
    const fieldId = fieldKeyToId[key];
    if (!fieldId) continue;
    const norm = NORMALIZERS[PT_FIELDS[key].kind];
    const want = key in desired ? desired[key] : '';
    if (norm(cf[fieldId]) !== norm(want)) updates[fieldId] = want;
  }
  return updates;
}

/**
 * Load every member's PT rows + PT session days once per reconcile run.
 * Returns member_id -> summary for members with any PT; everyone else is
 * { status: 'None' } (see ptSummaryFor).
 */
async function loadPtSummaries(supabase, today) {
  const PAGE = 1000;
  const pageAll = async (build) => {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  };
  const rows = await pageAll(() => supabase.from('abc_pt_services')
    .select('member_id, recurring_type_desc, status, service_item, unit_price, invoice_total, frequency, number_billed, total_periods, sale_date, first_billing_date, next_billing_date, inactive_date, trainer_name, sales_person_name')
    .order('recurring_service_id'));
  const byMember = new Map();
  for (const r of rows) {
    if (!byMember.has(r.member_id)) byMember.set(r.member_id, []);
    byMember.get(r.member_id).push(r);
  }

  // Session days only matter for members holding a PIF.
  const pifMembers = [...byMember].filter(([, list]) => list.some(isPif)).map(([id]) => id);
  const sessionsByMember = new Map();
  for (let i = 0; i < pifMembers.length; i += 200) {
    const events = await pageAll(() => supabase.from('abc_calendar_events')
      .select('member_id, event_name, status, event_timestamp_local, event_id')
      .in('member_id', pifMembers.slice(i, i + 200))
      .gte('event_timestamp_local', CALENDAR_START)
      .order('event_id'));
    for (const ev of events) {
      if (!isSessionEvent(ev)) continue;
      if (!sessionsByMember.has(ev.member_id)) sessionsByMember.set(ev.member_id, []);
      sessionsByMember.get(ev.member_id).push({ day: String(ev.event_timestamp_local).slice(0, 10) });
    }
  }

  const summaries = new Map();
  for (const [id, list] of byMember) summaries.set(id, summarizePt(list, sessionsByMember.get(id) || [], today));
  return summaries;
}

function ptSummaryFor(summaries, memberId) {
  return (summaries && summaries.get(memberId)) || { status: 'None' };
}

module.exports = {
  PT_FIELDS, PT_FIELD_KEYS, isSessionEvent, summarizePt, desiredPtFields, ptFieldUpdates,
  loadPtSummaries, ptSummaryFor,
};
