const axios = require('axios');
const supabase = require('../db/supabase');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

function fmtAbcTimestamp(d) {
  // ABC expects "YYYY-MM-DD HH:mm:ss"
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() + '-' +
    pad(d.getUTCMonth() + 1) + '-' +
    pad(d.getUTCDate()) + ' ' +
    pad(d.getUTCHours()) + ':' +
    pad(d.getUTCMinutes()) + ':' +
    pad(d.getUTCSeconds())
  );
}

function hourFloor(date) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/**
 * Fetch the check-in summary for one club over an arbitrary time window.
 * Returns the parsed counts and the raw member array.
 */
async function fetchCheckinsForRange(clubNumber, fromDate, toDate) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }

  const url = `${ABC_BASE_URL}/${clubNumber}/members/checkins/summaries`;
  const checkInTimestampRange = `${fmtAbcTimestamp(fromDate)},${fmtAbcTimestamp(toDate)}`;

  const res = await axios.get(url, {
    params: { checkInTimestampRange, size: 5000 },
    headers: {
      app_id: ABC_APP_ID,
      app_key: ABC_APP_KEY,
      Accept: 'application/json',
    },
    timeout: 60000,
  });

  const members = res.data?.members || [];
  let totalCheckins = 0;
  for (const m of members) {
    const arr = m.checkInCounts?.checkInCount || [];
    for (const entry of arr) {
      const n = parseInt(entry.count, 10);
      if (!isNaN(n)) totalCheckins += n;
    }
  }

  return {
    totalCheckins,
    uniqueMembers: members.length,
    members, // raw, in case the caller wants per-club tallies
  };
}

/**
 * Refresh the current hour's bucket for every club in `clubs`.
 * Call this on every delta tick. Idempotent — UPSERTs by (club_number, hour_start).
 */
async function refreshCurrentHourCheckins(clubs) {
  const now = new Date();
  const hourStart = hourFloor(now);

  for (const clubNumber of clubs) {
    try {
      const { totalCheckins, uniqueMembers } = await fetchCheckinsForRange(
        clubNumber,
        hourStart,
        now,
      );

      const { error } = await supabase
        .from('checkins_hourly')
        .upsert(
          {
            club_number: clubNumber,
            hour_start: hourStart.toISOString(),
            total_checkins: totalCheckins,
            unique_members: uniqueMembers,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'club_number,hour_start' },
        );

      if (error) {
        console.error(`[Checkins] ${clubNumber} upsert error: ${error.message}`);
        continue;
      }

      console.log(
        `[Checkins] ${clubNumber} ${hourStart.toISOString().slice(0, 16)}Z: ` +
          `${totalCheckins} check-ins, ${uniqueMembers} members`,
      );
    } catch (err) {
      console.error(`[Checkins] ${clubNumber} fetch error: ${err.message}`);
    }
  }
}

/**
 * Backfill an inclusive range of full hours for one club. The end hour is
 * computed as the floor of `endDate`. Use the script in scripts/ to drive this.
 */
async function backfillClub(clubNumber, startDate, endDate, sleepMs = 800) {
  const start = hourFloor(startDate);
  const end = hourFloor(endDate);

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCHours(cursor.getUTCHours() + 1)) {
    const hourStart = new Date(cursor);
    const hourEnd = new Date(cursor);
    hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);

    try {
      const { totalCheckins, uniqueMembers } = await fetchCheckinsForRange(
        clubNumber,
        hourStart,
        hourEnd,
      );

      await supabase
        .from('checkins_hourly')
        .upsert(
          {
            club_number: clubNumber,
            hour_start: hourStart.toISOString(),
            total_checkins: totalCheckins,
            unique_members: uniqueMembers,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'club_number,hour_start' },
        );

      console.log(
        `[Backfill] ${clubNumber} ${hourStart.toISOString().slice(0, 13)}Z: ` +
          `${totalCheckins} check-ins, ${uniqueMembers} members`,
      );
    } catch (err) {
      console.error(`[Backfill] ${clubNumber} ${hourStart.toISOString()} error: ${err.message}`);
    }

    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }
}

module.exports = {
  fetchCheckinsForRange,
  refreshCurrentHourCheckins,
  backfillClub,
};
