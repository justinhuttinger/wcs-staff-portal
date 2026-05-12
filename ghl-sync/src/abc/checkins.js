const axios = require('axios');
const supabase = require('../db/supabase');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

// === Pacific-disguised UTC convention ======================================
// checkins_hourly.hour_start is stored as a UTC-tagged TIMESTAMPTZ whose
// digits are the Pacific wall-clock value (per migrations/004). Likewise
// ABC's /members/checkins/summaries reads `checkInTimestampRange` as
// Pacific local time. So we maintain a SINGLE internal convention:
//
//   "Pacific-disguised UTC" = a Date whose UTC components (Y/M/D/H/M/S)
//   equal the Pacific wall-clock value. E.g. new Date('2026-05-12T11:00:00Z')
//   represents 11:00 AM Pacific.
//
// Boundaries:
//   • Convert real UTC → Pacific-disguised exactly ONCE when capturing
//     the current moment: pacificNowAsUtc().
//   • Parse a 'YYYY-MM-DD' user-input as Pacific calendar day by appending
//     'T00:00:00Z' — the resulting Date's UTC digits already match Pacific
//     midnight, so no further conversion needed.
// Internal callers (hourFloor, fmtAbcTimestamp, backfill loops, storage)
// then operate on Pacific-disguised values with no further timezone math.

function fmtAbcTimestamp(d) {
  // d is already Pacific-disguised, so format the UTC digits directly.
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

// Floor to the start of the Pacific-disguised hour (zero minutes/seconds).
function hourFloor(d) {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}

// Convert a real UTC moment into a Pacific-disguised Date. Use ONLY at the
// boundary when capturing "now".
function pacificNowAsUtc(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return new Date(`${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}.000Z`);
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
 *
 * Returns a summary object: { hourStart, results: [{ clubNumber, ok, error?, totalCheckins?, uniqueMembers? }] }
 * so callers can write a sync-log entry and surface failures in monitoring
 * instead of letting them swallow into console output.
 */
async function refreshCurrentHourCheckins(clubs) {
  // Capture the current moment as Pacific-disguised UTC, then floor to the
  // hour. All downstream math (fmtAbcTimestamp, storage) operates on
  // Pacific-disguised values; no further conversion is needed.
  const now = pacificNowAsUtc();
  const hourStart = hourFloor(now);
  const results = [];

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
        results.push({ clubNumber, ok: false, error: `upsert: ${error.message}` });
        continue;
      }

      console.log(
        `[Checkins] ${clubNumber} ${hourStart.toISOString().slice(0, 16)}Z: ` +
          `${totalCheckins} check-ins, ${uniqueMembers} members`,
      );
      results.push({ clubNumber, ok: true, totalCheckins, uniqueMembers });
    } catch (err) {
      console.error(`[Checkins] ${clubNumber} fetch error: ${err.message}`);
      results.push({ clubNumber, ok: false, error: `fetch: ${err.message}` });
    }
  }

  return { hourStart: hourStart.toISOString(), results };
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
  pacificNowAsUtc,
  fmtAbcTimestamp,
  hourFloor,
};
