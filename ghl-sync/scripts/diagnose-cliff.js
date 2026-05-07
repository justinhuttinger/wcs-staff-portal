#!/usr/bin/env node
/**
 * Deep-probe ABC for a single club where check-in data appears to have
 * stopped after a specific date. Tests:
 *
 *   1. /members/checkins/summaries across several dates (the endpoint our
 *      sync uses) - confirms whether the cliff is real per ABC.
 *   2. /members/checkins (raw, non-summarized) for one date - sees if the
 *      problem is summaries-specific.
 *   3. /clubs/{club} - confirms the club number resolves.
 *   4. /members?activeStatus=active (count only) - confirms our credential
 *      can still fetch OTHER data from this club.
 *
 * Usage:
 *   node scripts/diagnose-cliff.js                 # default: Springfield 31598
 *   node scripts/diagnose-cliff.js 31600           # one club
 */
require('dotenv').config();
const axios = require('axios');

const U = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const H = {
  app_id: process.env.ABC_APP_ID,
  app_key: process.env.ABC_APP_KEY,
  Accept: 'application/json',
};

const club = process.argv[2] || '31598';

const SUMMARY_PROBES = [
  '2026-03-15',
  '2026-03-25',
  '2026-03-26',
  '2026-03-27',
  '2026-03-28',
  '2026-03-29',
  '2026-04-01',
  '2026-04-15',
  '2026-05-01',
  '2026-05-06',
];

function fmt(d, t) {
  return `${d} ${t}`;
}

async function summariesForDay(date) {
  // Use a 1-hour window in the busy 22:00 UTC slot (3pm Pacific)
  const range = `${fmt(date, '20:00:00')},${fmt(date, '23:00:00')}`;
  const r = await axios.get(`${U}/${club}/members/checkins/summaries`, {
    params: { checkInTimestampRange: range, size: 5000 },
    headers: H,
    timeout: 60000,
  });
  const members = r.data?.members || [];
  let total = 0;
  for (const m of members) {
    for (const e of (m.checkInCounts?.checkInCount || [])) {
      total += parseInt(e.count, 10) || 0;
    }
  }
  return { members: members.length, total, raw: r.data?.status?.message };
}

async function rawCheckinsForDay(date) {
  // /members/checkins is the non-summarized endpoint. Take first page only.
  const range = `${fmt(date, '00:00:00')},${fmt(date, '23:59:59')}`;
  const r = await axios.get(`${U}/${club}/members/checkins`, {
    params: { checkInTimestampRange: range, size: 100, page: 1 },
    headers: H,
    timeout: 60000,
  });
  const checkins = r.data?.checkins || [];
  return { count: checkins.length, statusCount: r.data?.status?.count, msg: r.data?.status?.message };
}

async function memberCount() {
  const r = await axios.get(`${U}/${club}/members`, {
    params: { activeStatus: 'active', size: 1, page: 1 },
    headers: H,
    timeout: 60000,
  });
  return { firstPage: r.data?.members?.length || 0, statusCount: r.data?.status?.count };
}

async function clubInfo() {
  const r = await axios.get(`${U}/${club}/clubs`, { headers: H, timeout: 60000 });
  return r.data;
}

(async () => {
  if (!H.app_id || !H.app_key) {
    console.error('Missing ABC_APP_ID or ABC_APP_KEY in env.');
    process.exit(1);
  }
  console.log(`========== Club ${club} ==========`);
  console.log(`ABC_APP_ID prefix: ${H.app_id.slice(0, 4)}...`);

  // 1. Club info — does it resolve?
  console.log('\n--- /clubs ---');
  try {
    const c = await clubInfo();
    console.log(JSON.stringify(c).slice(0, 400));
  } catch (e) {
    console.log('ERR', e.message, e.response?.status);
  }

  // 2. Member count — does the credential still see this club's other data?
  console.log('\n--- /members?activeStatus=active (sanity check that creds work) ---');
  try {
    const m = await memberCount();
    console.log(`active members count=${m.statusCount} (page1 returned ${m.firstPage})`);
  } catch (e) {
    console.log('ERR', e.message, e.response?.status);
  }

  // 3. Summaries probes across the suspected cliff
  console.log('\n--- /members/checkins/summaries (the endpoint our sync uses) ---');
  console.log('(20:00-23:00 UTC window each day)');
  for (const d of SUMMARY_PROBES) {
    try {
      const r = await summariesForDay(d);
      const tag = r.total > 0 ? 'DATA' : 'empty';
      console.log(`  ${d}: ${tag} members=${r.members} total=${r.total} msg="${r.raw}"`);
    } catch (e) {
      console.log(`  ${d}: ERR ${e.message} status=${e.response?.status}`);
    }
  }

  // 4. Raw checkins endpoint for one recent day
  console.log('\n--- /members/checkins (raw, full day 2026-04-15) ---');
  try {
    const r = await rawCheckinsForDay('2026-04-15');
    console.log(`page1 count=${r.count} (status.count=${r.statusCount}) msg="${r.msg}"`);
  } catch (e) {
    console.log('ERR', e.message, e.response?.status);
  }

  // 5. Same raw call for a known-good day
  console.log('\n--- /members/checkins (raw, full day 2026-03-15 — should have data) ---');
  try {
    const r = await rawCheckinsForDay('2026-03-15');
    console.log(`page1 count=${r.count} (status.count=${r.statusCount}) msg="${r.msg}"`);
  } catch (e) {
    console.log('ERR', e.message, e.response?.status);
  }
})();
