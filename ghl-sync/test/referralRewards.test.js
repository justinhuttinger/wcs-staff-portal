// ghl-sync/test/referralRewards.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  pickNextDuesInvoice,
  isEligibleCandidate,
  buildAdjustmentBody,
} = require('../src/abc/referralRewards');

// Sample payload mirrors the real ABC /agreements/invoices response.
const SAMPLE_INVOICES = [
  { dueDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: 54.99, amountDue: 54.99 },
  { dueDate: '2026-06-29', profitCenterAbcCode: 'ANNUALFEE', invoiceAmount: 39.99, amountDue: 39.99 },
  { dueDate: '2026-06-30', profitCenterAbcCode: 'DUES', invoiceAmount: 54.99, amountDue: 54.99 },
];

test('pickNextDuesInvoice returns earliest future DUES invoice', () => {
  const inv = pickNextDuesInvoice(SAMPLE_INVOICES, '2026-05-28');
  assert.strictEqual(inv.dueDate, '2026-05-31');
  assert.strictEqual(inv.profitCenterAbcCode, 'DUES');
});

test('pickNextDuesInvoice skips ANNUALFEE', () => {
  const onlyAnnual = [{ dueDate: '2026-06-29', profitCenterAbcCode: 'ANNUALFEE', invoiceAmount: 39.99 }];
  assert.strictEqual(pickNextDuesInvoice(onlyAnnual, '2026-05-28'), null);
});

test('pickNextDuesInvoice ignores invoices whose dueDate is before today', () => {
  const inv = pickNextDuesInvoice(SAMPLE_INVOICES, '2026-06-01');
  assert.strictEqual(inv.dueDate, '2026-06-30');
});

test('pickNextDuesInvoice returns null on empty list', () => {
  assert.strictEqual(pickNextDuesInvoice([], '2026-05-28'), null);
});

test('isEligibleCandidate true for active, recent, referred member with no prior row', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, true);
});

test('isEligibleCandidate false when referredBy empty', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: '',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false when signed before program start', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-01' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false on self-referral', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'REF1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false when already zeroed (terminal)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: { dues_status: 'zeroed' },
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false when no_dues_invoice (terminal)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: { dues_status: 'no_dues_invoice' },
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate true when prior row errored (retry)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: { dues_status: 'error' },
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, true);
});

test('buildAdjustmentBody zeroes the given invoice', () => {
  const body = buildAdjustmentBody('2026-05-31');
  assert.deepStrictEqual(body, {
    startDate: '2026-05-31',
    profitCenterAbcCode: 'DUES',
    invoiceAmount: '0.00',
    numberOfInvoices: '1',
  });
});

test('isEligibleCandidate true when signed exactly on program start date (inclusive boundary)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, true);
  assert.strictEqual(r.reason, 'ok');
});

test('isEligibleCandidate uses since_date when sign_date is absent', () => {
  // sign_date missing → falls back to since_date for the program-start check
  const eligible = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: null, since_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(eligible.eligible, true);

  const tooEarly = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: null, since_date: '2026-05-01' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(tooEarly.eligible, false);
});

const { processReferralReward } = require('../src/abc/referralRewards');

function makeDeps(overrides = {}) {
  const calls = { adjust: [], tagged: [], recorded: [], notes: [] };
  const deps = {
    today: '2026-05-28',
    fetchMemberInvoices: async () => overrides.invoices ?? [
      { dueDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: 54.99 },
    ],
    adjustInvoice: async (club, id, body) => {
      calls.adjust.push({ club, id, body });
      return overrides.adjustResult ?? { ok: true, status: 200, data: {} };
    },
    addNote: async (club, id, note) => {
      if (overrides.noteThrows) throw new Error('abc note down');
      calls.notes.push({ club, id, note });
      return { ok: true, status: 200, data: {} };
    },
    tagReferrer: async (contactId, friendName) => {
      if (overrides.tagThrows) throw new Error('ghl down');
      calls.tagged.push({ contactId, friendName });
    },
    recordReward: async (row) => { calls.recorded.push(row); },
  };
  return { deps, calls };
}

const BASE = {
  location: { clubNumber: '30935', id: 'LOC1', name: 'Salem' },
  runId: 'run1',
  abcMember: { member_id: 'NEW1', first_name: 'Sam', last_name: 'Jones', sign_date: '2026-05-28', is_active: true },
  referrerAbcId: 'REF1',
  referrerContact: { id: 'GHLREF1' },
  dryRun: false,
};

test('processReferralReward: happy path zeroes then tags', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.adjust.length, 1);
  assert.deepStrictEqual(calls.adjust[0].body, {
    startDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: '0.00', numberOfInvoices: '1',
  });
  assert.strictEqual(calls.tagged.length, 1);
  assert.strictEqual(calls.tagged[0].friendName, 'Sam Jones');
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'tagged');
  assert.strictEqual(row.needs_review, false);
});

test('processReferralReward: no DUES invoice -> flag, never tags', async () => {
  const { deps, calls } = makeDeps({ invoices: [{ dueDate: '2026-06-29', profitCenterAbcCode: 'ANNUALFEE' }] });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.adjust.length, 0);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'no_dues_invoice');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: ABC adjust fails -> no tag, status error', async () => {
  const { deps, calls } = makeDeps({ adjustResult: { ok: false, status: 200, data: { status: { message: 'fail' } } } });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'error');
});

test('processReferralReward: no referrer contact -> zeroed but flagged, no tag', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, referrerContact: null, ...deps });
  assert.strictEqual(calls.adjust.length, 1);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'no_referrer_contact');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: zeroed but tag write fails -> flagged sms error', async () => {
  const { deps } = makeDeps({ tagThrows: true });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'error');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: dryRun zeroes nothing, records nothing', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, dryRun: true, ...deps });
  assert.strictEqual(calls.adjust.length, 0);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(calls.recorded.length, 0);
  assert.strictEqual(row.dry_run, true);
});

test('processReferralReward: notes the referrer ABC profile after zeroing', async () => {
  const { deps, calls } = makeDeps();
  await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.notes.length, 1);
  assert.strictEqual(calls.notes[0].id, 'REF1');
  assert.strictEqual(
    calls.notes[0].note,
    'VIP referral reward for referring Sam Jones: next month free. DUES invoice due 05/31/2026 adjusted from $54.99 to $0.00 automatically by WCS.',
  );
});

test('processReferralReward: failed note keeps the reward and still tags', async () => {
  const { deps, calls } = makeDeps({ noteThrows: true });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'tagged');
  assert.strictEqual(calls.tagged.length, 1);
  assert.match(row.error, /abc note failed/);
});

test('processReferralReward: adjust failure adds no note', async () => {
  const { deps, calls } = makeDeps({ adjustResult: { ok: false, status: 200, data: {} } });
  await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.notes.length, 0);
});

// --- Per-club reward (Milwaukie $50 off), ABC-sourced referrals, VIP writeback ---
const {
  rewardFor, rewardedAmount, vipWritebackNote, isEligibleCandidate: eligible,
} = require('../src/abc/referralRewards');

test('rewardFor: Milwaukie is $50 off, everyone else a free month', () => {
  assert.deepStrictEqual(rewardFor('31601'), { amountOff: 50 });
  assert.deepStrictEqual(rewardFor('30935'), { amountOff: null });
});

test('rewardedAmount: free month is 0.00; $50 off subtracts and floors at zero', () => {
  assert.strictEqual(rewardedAmount({ amountOff: null }, 54.99), '0.00');
  assert.strictEqual(rewardedAmount({ amountOff: 50 }, 54.99), '4.99');
  assert.strictEqual(rewardedAmount({ amountOff: 50 }, '89.00'), '39.00');
  assert.strictEqual(rewardedAmount({ amountOff: 50 }, 39.99), '0.00');
  assert.strictEqual(rewardedAmount({ amountOff: 50 }, undefined), null);
});

test('processReferralReward: Milwaukie referrer gets $50 off, status discounted', async () => {
  const { deps, calls } = makeDeps({ invoices: [{ dueDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: 89.99 }] });
  const row = await processReferralReward({ ...BASE, location: { ...BASE.location, clubNumber: '31601' }, ...deps });
  assert.strictEqual(calls.adjust[0].body.invoiceAmount, '39.99');
  assert.strictEqual(calls.adjust[0].club, '31601');
  assert.strictEqual(row.dues_status, 'discounted');
  assert.strictEqual(row.original_amount, 89.99);
  assert.strictEqual(row.new_amount, 39.99);
  assert.match(calls.notes[0].note, /\$50 off next month/);
  assert.match(calls.notes[0].note, /to \$39\.99/);
  assert.strictEqual(calls.tagged.length, 1);
});

test('processReferralReward: $50 off with no invoice amount -> review, no adjust, no tag', async () => {
  const { deps, calls } = makeDeps({ invoices: [{ dueDate: '2026-05-31', profitCenterAbcCode: 'DUES' }] });
  const row = await processReferralReward({ ...BASE, location: { ...BASE.location, clubNumber: '31601' }, ...deps });
  assert.strictEqual(calls.adjust.length, 0);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'error');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: cross-club referrer is paid at their home club', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, referrerClubNumber: '31601', source: 'abc', ...deps });
  assert.strictEqual(calls.adjust[0].club, '31601');
  assert.strictEqual(row.club_number, '31601');
  assert.strictEqual(row.source, 'abc');
  assert.strictEqual(row.dues_status, 'discounted');
});

test('processReferralReward: VIP writeback notes the NEW member with the referrer name', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, writeback: { referrerName: 'Jane Doe' }, ...deps });
  const wb = calls.notes.find((n) => n.id === BASE.abcMember.member_id);
  assert.ok(wb, 'note on the new member');
  assert.match(wb.note, /referred by Jane Doe/);
  assert.strictEqual(row.abc_writeback_status, 'noted');
});

test('processReferralReward: writeback already done is not repeated on retry', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, writeback: { referrerName: 'Jane Doe', done: true }, ...deps });
  assert.ok(!calls.notes.some((n) => n.id === BASE.abcMember.member_id));
  assert.strictEqual(row.abc_writeback_status, 'noted');
});

test('processReferralReward: no writeback needed when ABC already names the referrer', async () => {
  const { deps } = makeDeps();
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(row.abc_writeback_status, 'not_needed');
});

test('vipWritebackNote falls back to the referrer id when there is no name', () => {
  assert.match(vipWritebackNote({ referrerName: '', referrerAbcId: 'R9' }), /referred by member R9/);
});

test('isEligibleCandidate: discounted is terminal', () => {
  const r = eligible({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-10-25' },
    referredByValue: 'REF1', existingRow: { dues_status: 'discounted' }, programStartDate: '2026-10-22',
  });
  assert.deepStrictEqual(r, { eligible: false, reason: 'terminal' });
});

test('isEligibleCandidate: requireNewMember blocks a re-sign of an old member', () => {
  const abcMember = { member_id: 'NEW1', is_active: true, sign_date: '2026-10-25', since_date: '2024-03-01' };
  const base = { abcMember, referredByValue: 'REF1', existingRow: null, programStartDate: '2026-10-22' };
  assert.strictEqual(eligible(base).eligible, true);
  assert.strictEqual(eligible({ ...base, requireNewMember: true }).eligible, false);
});
