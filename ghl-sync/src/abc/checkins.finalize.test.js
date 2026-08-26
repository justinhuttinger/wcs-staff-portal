const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Stub axios and the supabase client before requiring checkins.js, so the
// module under test talks to fakes rather than the network or the database.
const calls = { ranges: [], upserts: [] };
let stored = null;            // what the existing checkins_hourly row looks like
let apiCounts = { totalCheckins: 0, uniqueMembers: 0 };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') {
    return {
      get: async (_url, opts) => {
        calls.ranges.push(opts.params.checkInTimestampRange);
        // Shape the real endpoint returns: one entry per member, each holding
        // a per-club count.
        const members = Array.from({ length: apiCounts.uniqueMembers }, (_, i) => ({
          memberId: 'm' + i,
          checkInCounts: { checkInCount: [{ count: String(apiCounts.perMember || 1) }] },
        }));
        return { data: { members, status: { message: 'success' } } };
      },
    };
  }
  if (request === '../db/supabase') {
    return {
      from() { return this; },
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: stored }),
      upsert: async (row) => { calls.upserts.push(row); return { error: null }; },
    };
  }
  return origLoad.apply(this, arguments);
};

process.env.ABC_APP_ID = 'id';
process.env.ABC_APP_KEY = 'key';
const { finalizePreviousHour, refreshCurrentHourCheckins } = require('./checkins');
Module._load = origLoad;

function reset() {
  calls.ranges = [];
  calls.upserts = [];
  stored = null;
  apiCounts = { totalCheckins: 0, uniqueMembers: 3, perMember: 2 };
}

// "2026-08-26 14:37:00" style, as fmtAbcTimestamp produces.
function spanOf(range) {
  const [from, to] = range.split(',');
  return { from, to };
}

test('the finalize pass asks for a whole hour, not up to now', async () => {
  reset();
  await finalizePreviousHour(['31599']);
  assert.equal(calls.ranges.length, 1);
  const { from, to } = spanOf(calls.ranges[0]);
  // Starts on the hour and ends exactly one hour later. This is the actual
  // bug: the live path asked for hourStart -> now and lost the remainder.
  assert.match(from, /:00:00$/);
  assert.match(to, /:00:00$/);
  const span = (new Date(to.replace(' ', 'T') + 'Z') - new Date(from.replace(' ', 'T') + 'Z')) / 3600000;
  assert.equal(span, 1);
});

test('the finalized hour is the one before the current hour', async () => {
  reset();
  const { hourStart } = await finalizePreviousHour(['31599']);
  const { from } = spanOf(calls.ranges[0]);
  assert.equal(new Date(hourStart).toISOString().slice(0, 13), from.replace(' ', 'T').slice(0, 13));
});

test('it writes the full-hour figures back over the partial ones', async () => {
  reset();
  apiCounts = { uniqueMembers: 4, perMember: 3 };
  await finalizePreviousHour(['31599']);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].total_checkins, 12); // 4 members x 3 check-ins
  assert.equal(calls.upserts[0].unique_members, 4);
  assert.equal(calls.upserts[0].club_number, '31599');
});

test('an hour already written after it ended is left alone', async () => {
  reset();
  // Written well after the hour closed, so it is already complete. Re-fetching
  // it on all six ticks of the next hour would be six wasted ABC calls.
  stored = { fetched_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString() };
  const { results } = await finalizePreviousHour(['31599']);
  assert.equal(calls.ranges.length, 0);
  assert.equal(calls.upserts.length, 0);
  assert.equal(results[0].skipped, 'already final');
});

test('an hour written before it ended is re-read', async () => {
  reset();
  // The partial write the live path leaves behind.
  stored = { fetched_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString() };
  await finalizePreviousHour(['31599']);
  assert.equal(calls.ranges.length, 1);
  assert.equal(calls.upserts.length, 1);
});

test('every club is finalized', async () => {
  reset();
  const { results } = await finalizePreviousHour(['30935', '31599', '7655']);
  assert.equal(results.length, 3);
  assert.equal(calls.ranges.length, 3);
});

test('the tick writes the live hour and then closes the previous one', async () => {
  reset();
  const out = await refreshCurrentHourCheckins(['31599']);
  // Two reads: the partial current hour, then the full previous hour.
  assert.equal(calls.ranges.length, 2);
  assert.equal(calls.upserts.length, 2);
  assert.ok(out.finalized, 'the tick reports what it finalized');
  // The live read runs first, so a finalize failure cannot cost us the live
  // bucket.
  const live = spanOf(calls.ranges[0]);
  const final = spanOf(calls.ranges[1]);
  assert.ok(final.from < live.from, 'the finalized hour precedes the live one');
});
