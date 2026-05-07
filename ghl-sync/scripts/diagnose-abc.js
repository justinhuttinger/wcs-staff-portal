#!/usr/bin/env node
/**
 * Diagnose ABC API connectivity for a club number.
 * Prints /clubs response and a check-in summary for a known busy 1-hour window.
 *
 * Usage:
 *   node scripts/diagnose-abc.js                        # tests Medford 32073 vs Salem 30935
 *   node scripts/diagnose-abc.js 32073                  # one club
 *   node scripts/diagnose-abc.js 32073 30935 31599      # multiple
 */
require('dotenv').config();
const axios = require('axios');

const U = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const H = {
  app_id: process.env.ABC_APP_ID,
  app_key: process.env.ABC_APP_KEY,
  Accept: 'application/json',
};

const clubs = process.argv.slice(2);
if (clubs.length === 0) clubs.push('32073', '30935');

const RANGE_FROM = '2026-05-06 22:00:00';
const RANGE_TO = '2026-05-06 23:00:00';
const range = `checkInTimestampRange=${encodeURIComponent(RANGE_FROM + ',' + RANGE_TO)}&size=5000`;

(async () => {
  if (!H.app_id || !H.app_key) {
    console.error('Missing ABC_APP_ID or ABC_APP_KEY in env.');
    process.exit(1);
  }
  console.log(`ABC_APP_ID prefix: ${H.app_id.slice(0, 4)}...`);
  console.log(`Testing window: ${RANGE_FROM}Z -> ${RANGE_TO}Z (3-4pm Pacific yesterday)`);
  console.log('');

  for (const club of clubs) {
    console.log(`========== Club ${club} ==========`);

    // /clubs — verifies the clubNumber exists under our app credentials
    try {
      const r = await axios.get(`${U}/${club}/clubs`, { headers: H, timeout: 30000 });
      const c = (r.data?.clubs && r.data.clubs[0]) || r.data;
      console.log(`  /clubs   OK ${r.status}  name="${c?.name || '?'}"  status="${c?.status || '?'}"`);
    } catch (e) {
      console.log(`  /clubs   ERR ${e.message}  status=${e.response?.status}  body=${JSON.stringify(e.response?.data || {}).slice(0, 200)}`);
    }

    // /members/checkins/summaries — same call the worker makes
    try {
      const r = await axios.get(`${U}/${club}/members/checkins/summaries?${range}`, { headers: H, timeout: 30000 });
      const members = r.data?.members || [];
      let total = 0;
      for (const m of members) {
        for (const e of (m.checkInCounts?.checkInCount || [])) {
          total += parseInt(e.count, 10) || 0;
        }
      }
      console.log(`  /summary OK ${r.status}  members=${members.length}  total_checkins=${total}`);
      if (members.length === 0 && r.data) {
        console.log(`           raw=${JSON.stringify(r.data).slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`  /summary ERR ${e.message}  status=${e.response?.status}  body=${JSON.stringify(e.response?.data || {}).slice(0, 200)}`);
    }
    console.log('');
  }
})();
