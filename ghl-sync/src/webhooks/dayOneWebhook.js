const axios = require('axios');
const { get } = require('../ghl/client');
const supabase = require('../db/supabase');
const LOCATIONS = require('../config/locations');

// Cache: locationId -> { calendarIds, groupId }
const calendarCache = {};

async function getDayOneCalendarInfo(locationId, apiKey) {
  if (calendarCache[locationId]) return calendarCache[locationId];

  const data = await get('/calendars/', { locationId }, apiKey);
  const calendars = data.calendars || [];

  const dayOneCalendars = calendars.filter(cal => {
    const name = (cal.name || '').toLowerCase();
    return name.includes('day one') || name.includes('dayone') || name.includes('day 1');
  });

  if (dayOneCalendars.length > 0) {
    const groupId = dayOneCalendars[0].groupId || null;
    const result = { calendarIds: dayOneCalendars.map(c => c.id), groupId };
    calendarCache[locationId] = result;
    console.log(`[DayOneWebhook] Found ${result.calendarIds.length} Day One calendars for ${locationId}, groupId: ${groupId}`);
    return result;
  }

  console.log(`[DayOneWebhook] No Day One calendars found for ${locationId}`);
  return { calendarIds: [], groupId: null };
}

async function fetchTodayEvents(location) {
  const calInfo = await getDayOneCalendarInfo(location.id, location.apiKey);
  if (calInfo.calendarIds.length === 0) return [];

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  const params = {
    locationId: location.id,
    startTime: startOfDay.getTime().toString(),
    endTime: endOfDay.getTime().toString(),
  };

  let events = [];

  if (calInfo.groupId) {
    params.groupId = calInfo.groupId;
    const data = await get('/calendars/events', params, location.apiKey);
    events = data.events || [];
  } else {
    for (const calId of calInfo.calendarIds) {
      const data = await get('/calendars/events', { ...params, calendarId: calId }, location.apiKey);
      events.push(...(data.events || []));
    }
  }

  return events;
}

async function fetchUserMap(location) {
  const userMap = {};
  try {
    const data = await get('/users/', { locationId: location.id }, location.apiKey);
    for (const u of (data.users || [])) {
      userMap[u.id] = {
        name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        email: (u.email || '').toLowerCase(),
        phone: u.phone || null,
      };
    }
  } catch (e) {
    console.warn(`[DayOneWebhook] Could not fetch users for ${location.slug}:`, e.message);
  }
  return userMap;
}

async function getAlreadySent(eventIds, locationId) {
  if (eventIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('ghl_dayone_webhooks')
    .select('event_id')
    .eq('location_id', locationId)
    .eq('status', 'sent')
    .in('event_id', eventIds);

  if (error) {
    console.error(`[DayOneWebhook] Error checking sent webhooks:`, error.message);
    return new Set();
  }

  return new Set((data || []).map(r => r.event_id));
}

function parseEventTime(raw) {
  if (!raw) return null;
  const num = typeof raw === 'number' ? raw : parseInt(raw, 10);
  // If it looks like epoch milliseconds (after year 2000), use directly
  if (num > 946684800000) return new Date(num).toISOString();
  // Otherwise treat as ISO string
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function sendWebhook(location, event, userMap) {
  console.log(`[DayOneWebhook] Event time fields — startTime: ${event.startTime} (${typeof event.startTime}), endTime: ${event.endTime} (${typeof event.endTime}), start: ${event.start}, end: ${event.end}`);
  const trainerInfo = userMap[event.assignedUserId] || {};
  const payload = {
    contactId: event.contactId || null,
    contactName: event.title || event.contactName || 'Unknown',
    contactEmail: event.contactEmail || null,
    contactPhone: event.contactPhone || null,
    trainerName: trainerInfo.name || null,
    trainerPhone: trainerInfo.phone || null,
    appointmentId: event.id,
    appointmentStart: parseEventTime(event.startTime) || event.start || null,
    appointmentEnd: parseEventTime(event.endTime) || event.end || null,
    locationSlug: location.slug,
  };

  let status = 'sent';
  let error = null;

  try {
    await axios.post(location.dayOneWebhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    console.log(`[DayOneWebhook] Sent webhook for event ${event.id} at ${location.slug} — contact: ${payload.contactName}`);
  } catch (err) {
    status = 'failed';
    error = err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    console.error(`[DayOneWebhook] Failed for event ${event.id} at ${location.slug}: ${error}`);
  }

  await supabase
    .from('ghl_dayone_webhooks')
    .upsert({
      event_id: event.id,
      location_id: location.id,
      contact_id: event.contactId || null,
      webhook_url: location.dayOneWebhookUrl,
      payload,
      status,
      error,
      sent_at: new Date().toISOString(),
    }, { onConflict: 'event_id,location_id' });
}

async function run() {
  console.log('[DayOneWebhook] Checking for completed Day One appointments...');
  const now = Date.now();
  let totalSent = 0;
  let totalSkipped = 0;

  for (const location of LOCATIONS) {
    if (!location.dayOneWebhookUrl) {
      console.warn(`[DayOneWebhook] No webhook URL configured for ${location.slug}, skipping`);
      continue;
    }

    try {
      const events = await fetchTodayEvents(location);

      const completedEvents = events.filter(evt => {
        const endMs = evt.endTime ? parseInt(evt.endTime) : (evt.end ? new Date(evt.end).getTime() : 0);
        const isCancelled = (evt.appointmentStatus || '').toLowerCase() === 'cancelled';
        return endMs > 0 && endMs <= now && !isCancelled;
      });

      if (completedEvents.length === 0) continue;

      const eventIds = completedEvents.map(e => e.id);
      const alreadySent = await getAlreadySent(eventIds, location.id);

      const toSend = completedEvents.filter(e => !alreadySent.has(e.id));
      totalSkipped += completedEvents.length - toSend.length;

      if (toSend.length === 0) continue;

      const userMap = await fetchUserMap(location);

      for (const event of toSend) {
        await sendWebhook(location, event, userMap);
        totalSent++;
      }
    } catch (err) {
      console.error(`[DayOneWebhook] Error processing ${location.slug}:`, err.message);
    }
  }

  if (totalSent > 0 || totalSkipped > 0) {
    console.log(`[DayOneWebhook] Done. Sent: ${totalSent}, Already sent: ${totalSkipped}`);
  }
}

module.exports = { run };
