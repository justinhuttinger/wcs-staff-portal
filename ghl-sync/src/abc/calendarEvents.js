const axios = require('axios');
const supabase = require('../db/supabase');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const STATUSES_DEFAULT = ['completed', 'canceled-charge'];
const PAGE_SIZE = 200;

function fmtDate(d) {
  // ABC accepts "YYYY-MM-DD" for eventDateRange.
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function parseAbcTimestamp(s) {
  // ABC returns "YYYY-MM-DD HH:mm:ss[.SSSSSS]" with no timezone.
  // All WCS clubs are in America/Los_Angeles, so interpret accordingly.
  if (!s) return { utc: null, local: null };
  const cleaned = s.replace('T', ' ').replace(/\.\d+$/, '');
  const local = cleaned;
  const d = new Date(cleaned + 'Z'); // first parse as UTC for date math
  const isDst = isDstPacific(d);
  const offset = isDst ? '-07:00' : '-08:00';
  const utc = new Date(cleaned.replace(' ', 'T') + offset).toISOString();
  return { utc, local };
}

function isDstPacific(d) {
  // US DST: 2nd Sun of March 02:00 -> 1st Sun of November 02:00.
  const y = d.getUTCFullYear();
  const dst = (yy) => {
    const mar = new Date(Date.UTC(yy, 2, 1));
    mar.setUTCDate(mar.getUTCDate() + ((7 - mar.getUTCDay()) % 7) + 7);
    const nov = new Date(Date.UTC(yy, 10, 1));
    nov.setUTCDate(nov.getUTCDate() + ((7 - nov.getUTCDay()) % 7));
    return { start: mar, end: nov };
  };
  const { start, end } = dst(y);
  return d >= start && d < end;
}

function transformEvent(evt, clubNumber) {
  const ts = parseAbcTimestamp(evt.eventTimestamp);
  const member = (evt.members && evt.members[0]) || {};
  return {
    club_number: clubNumber,
    event_id: evt.eventId,
    event_type_id: evt.eventTypeId || null,
    event_name: evt.eventName || null,
    category: evt.category || null,
    event_timestamp: ts.utc,
    event_timestamp_local: ts.local,
    status: evt.status || null,
    duration_minutes: evt.duration ? parseInt(evt.duration, 10) : null,
    employee_id: evt.employeeId || null,
    employee_first_name: evt.employeeFirstName || null,
    employee_last_name: evt.employeeLastName || null,
    location_id: evt.locationId || null,
    location_name: evt.locationName || null,
    training_level: evt.eventTrainingLevel?.levelName || null,
    earnings_code: evt.earningsCode || null,
    member_id: member.memberId || null,
    member_first_name: member.firstName || null,
    member_last_name: member.lastName || null,
    attended_status: member.attendedStatus || null,
    modified_timestamp_abc: parseAbcTimestamp(evt.modifiedTimestamp).utc,
    fetched_at: new Date().toISOString(),
    raw: evt,
  };
}

async function fetchCalendarEvents(clubNumber, fromDate, toDate, status, page = 1) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const url = `${ABC_BASE_URL}/${clubNumber}/calendars/events`;
  const eventDateRange = `${fmtDate(fromDate)},${fmtDate(toDate)}`;
  const res = await axios.get(url, {
    params: { eventDateRange, eventStatus: status, size: PAGE_SIZE, page },
    headers: {
      app_id: ABC_APP_ID,
      app_key: ABC_APP_KEY,
      Accept: 'application/json',
    },
    timeout: 60000,
  });
  const events = res.data?.events || [];
  const nextPage = res.data?.status?.nextPage || null;
  return { events, nextPage };
}

async function syncCalendarEventsForClub(clubNumber, fromDate, toDate, statuses = STATUSES_DEFAULT, sleepMs = 0) {
  let totalUpserted = 0;
  for (const status of statuses) {
    let page = 1;
    while (true) {
      const { events, nextPage } = await fetchCalendarEvents(clubNumber, fromDate, toDate, status, page);
      // Sync all Appointments plus the Class events that report needs (Small
      // Group Training). Other classes (Yoga, Barbell Strength, etc.) are
      // out of scope for the PT Sessions report.
      const kept = events.filter((e) => {
        if (e.category === 'Appointment') return true;
        if (e.category === 'Class' && /small\s*group|\bsgt\b/i.test(e.eventName || '')) return true;
        return false;
      });
      if (kept.length > 0) {
        const rows = kept.map((e) => transformEvent(e, clubNumber));
        const { error } = await supabase
          .from('abc_calendar_events')
          .upsert(rows, { onConflict: 'club_number,event_id' });
        if (error) {
          console.error(`[CalEvents] ${clubNumber} ${status} p${page} upsert error: ${error.message}`);
        } else {
          totalUpserted += rows.length;
        }
      }
      console.log(`[CalEvents] ${clubNumber} ${status} p${page}: ${events.length} fetched, ${kept.length} kept (next=${nextPage || 'none'})`);
      if (!nextPage) break;
      page = parseInt(nextPage, 10);
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
  return totalUpserted;
}

// Sync a wide window by walking it in chunks. ABC's /calendars/events caps
// eventDateRange at ~31 days and SILENTLY returns empty for longer ranges, so a
// single 60–75 day request comes back with nothing. Walk in 28-day chunks.
async function syncCalendarEventsRange(clubNumber, fromDate, toDate, statuses = STATUSES_DEFAULT, sleepMs = 0, chunkDays = 28) {
  let total = 0;
  const end = new Date(toDate);
  let chunkStart = new Date(fromDate);
  while (chunkStart < end) {
    const chunkEnd = new Date(chunkStart.getTime() + chunkDays * 86400000);
    const actualEnd = chunkEnd > end ? end : chunkEnd;
    total += await syncCalendarEventsForClub(clubNumber, chunkStart, actualEnd, statuses, sleepMs);
    chunkStart = chunkEnd;
  }
  return total;
}

module.exports = {
  fetchCalendarEvents,
  syncCalendarEventsForClub,
  syncCalendarEventsRange,
  transformEvent,
  parseAbcTimestamp,
};
