// Which automated text did this reply answer?
//
// GHL threads everything into one conversation per contact with no reply
// linkage, so attribution is positional: an inbound SMS answers the most recent
// outbound SMS that preceded it, provided it landed inside the window. Two
// replies to one send count as one replied send (the caller dedupes on
// send_id); the rows here are per inbound message.
//
// Pure and I/O-free so the rules above are directly testable.

const DEFAULT_WINDOW_HOURS = 72;

// Standard carrier opt-out keywords, as a WHOLE message. Matching the keyword
// anywhere would flag "I cannot stop thinking about leg day" as an opt-out.
const OPT_OUT_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;

function isOptOut(body) {
  return typeof body === 'string' && OPT_OUT_RE.test(body);
}

function attributeReplies(messages, { windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const windowMs = windowHours * 60 * 60 * 1000;

  // Parse once, drop anything without a usable timestamp, then walk forward in
  // time carrying the most recent outbound.
  const sorted = (messages || [])
    .map(m => ({ m, t: Date.parse(m?.date_added) }))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const out = [];
  let lastSend = null;

  for (const { m, t } of sorted) {
    if (m.direction === 'outbound') {
      lastSend = { id: m.id, t };
      continue;
    }
    if (m.direction !== 'inbound') continue;
    if (!lastSend) continue; // an inbound with nothing before it is not a reply

    const delta = t - lastSend.t;
    if (delta < 0 || delta > windowMs) continue;

    out.push({
      inbound_id: m.id,
      send_id: lastSend.id,
      reply_minutes: Math.round(delta / 60000),
      is_opt_out: isOptOut(m.body),
    });
  }

  return out;
}

module.exports = { DEFAULT_WINDOW_HOURS, isOptOut, attributeReplies };
