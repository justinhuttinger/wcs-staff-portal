#!/usr/bin/env node
/**
 * Probe ABC for when a club's check-in data first appears.
 * Walks backwards from "now" in 30-day steps until 4 consecutive
 * empty windows, then bisects the boundary down to ~1 day.
 *
 * Usage:
 *   node scripts/find-data-start.js                # default Medford 32073
 *   node scripts/find-data-start.js 32073 31600    # multiple
 */
require('dotenv').config();
const axios = require('axios');

const U = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const H = {
  app_id: process.env.ABC_APP_ID,
  app_key: process.env.ABC_APP_KEY,
  Accept: 'application/json',
};

function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function checkinsInWindow(club, from, to) {
  const range = `checkInTimestampRange=${encodeURIComponent(fmt(from) + ',' + fmt(to))}&size=5000`;
  const r = await axios.get(`${U}/${club}/members/checkins/summaries?${range}`, { headers: H, timeout: 60000 });
  const members = r.data?.members || [];
  let total = 0;
  for (const m of members) {
    for (const e of (m.checkInCounts?.checkInCount || [])) total += parseInt(e.count, 10) || 0;
  }
  return { members: members.length, total };
}

async function probeClub(club) {
  console.log(`\n========== Club ${club} ==========`);
  const now = new Date();
  let earliestNonEmpty = null;
  let firstEmpty = null;

  // Step 1: walk back in 30-day windows of 1 day each (sample 1 day per month)
  for (let monthsBack = 0; monthsBack <= 24; monthsBack++) {
    const sample = new Date(now.getTime() - monthsBack * 30 * 86400000);
    sample.setUTCHours(20, 0, 0, 0); // 20:00 UTC = 1pm Pacific, very busy
    const end = new Date(sample.getTime() + 3600000);
    let res;
    try { res = await checkinsInWindow(club, sample, end); }
    catch (e) { console.log(`  ${sample.toISOString().slice(0,10)}: ERR ${e.message}`); continue; }
    const tag = res.total > 0 ? 'DATA' : 'empty';
    console.log(`  ${sample.toISOString().slice(0,10)}: ${tag} (members=${res.members}, total=${res.total})`);
    if (res.total > 0) earliestNonEmpty = sample;
    else if (earliestNonEmpty && !firstEmpty) { firstEmpty = sample; break; }
  }

  if (!earliestNonEmpty) {
    console.log(`  -> No data found in last 24 months.`);
    return;
  }
  if (!firstEmpty) {
    console.log(`  -> Data goes back at least 24 months (limit reached).`);
    return;
  }

  // Step 2: bisect between firstEmpty and earliestNonEmpty
  let lo = firstEmpty.getTime();
  let hi = earliestNonEmpty.getTime();
  while (hi - lo > 86400000) {
    const mid = new Date((lo + hi) / 2);
    mid.setUTCHours(20, 0, 0, 0);
    const end = new Date(mid.getTime() + 3600000);
    let res;
    try { res = await checkinsInWindow(club, mid, end); }
    catch { res = { total: 0, members: 0 }; }
    if (res.total > 0) hi = mid.getTime();
    else lo = mid.getTime();
    console.log(`  bisect ${mid.toISOString().slice(0,10)}: total=${res.total}`);
  }
  const startDate = new Date(hi).toISOString().slice(0, 10);
  console.log(`  -> Earliest hour with data is ON or just before: ${startDate}`);
}

(async () => {
  if (!H.app_id || !H.app_key) {
    console.error('Missing ABC_APP_ID or ABC_APP_KEY in env.');
    process.exit(1);
  }
  const clubs = process.argv.slice(2);
  if (clubs.length === 0) clubs.push('32073');
  for (const c of clubs) await probeClub(c);
})();
