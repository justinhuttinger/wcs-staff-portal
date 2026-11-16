// "Plan my week": orders the owner's tasks and tickets and packs them into
// Focus blocks around his meetings, following his /briefing rules: weekdays
// 8:00-17:00 Pacific, back to back with no buffers, at most 3 hours a day,
// split work one block a day on consecutive days. Pure; tested.

const DAY_START = 8 * 60
const DAY_END = 17 * 60
const DAILY_CAP = 180
const RANK = { high: 0, medium: 1, low: 2 }

const atNoon = key => new Date(`${key}T12:00:00Z`)
const addDays = (key, n) => { const d = atNoon(key); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// The next n weekdays starting at fromKey (included when it's a weekday).
function workdays(fromKey, n) {
  const out = []
  for (let k = fromKey; out.length < n; k = addDays(k, 1)) {
    const dow = atNoon(k).getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(k)
  }
  return out
}

// Overdue or due by this Sunday first, then other due dates (nearest first),
// then undated work by priority, then oldest.
function orderItems(items, todayKey) {
  const dow = atNoon(todayKey).getUTCDay()
  const weekEnd = addDays(todayKey, dow === 0 ? 0 : 7 - dow)
  const group = i => (i.due ? (i.due <= weekEnd ? 0 : 1) : 2)
  const pr = i => RANK[i.priority] ?? 1
  return [...items].sort((a, b) =>
    group(a) - group(b)
    || (group(a) < 2 ? String(a.due).localeCompare(String(b.due)) : 0)
    || pr(a) - pr(b)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

// Free [start, end) minute ranges inside the work window, minus busy ranges.
function freeRanges(busy, from) {
  const sorted = [...busy].map(([s, e]) => [Math.max(s, from), Math.min(e, DAY_END)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])
  const out = []
  let cur = from
  for (const [s, e] of sorted) {
    if (s > cur) out.push([cur, s])
    cur = Math.max(cur, e)
  }
  if (cur < DAY_END) out.push([cur, DAY_END])
  return out
}

// days: [{ date, busy: [[startMin, endMin], ...] }] in order (weekdays only).
// items: already ordered; { key, title, minutes, blocks }.
function planWeek({ days, items, startToday = null }) {
  const parts = []
  for (const it of items) {
    const n = Math.max(1, it.blocks || 1)
    for (let p = 1; p <= n; p++) parts.push({ ...it, part: p, of: n, placed: null })
  }
  const blocks = []
  days.forEach((d, dayIndex) => {
    const from = dayIndex === 0 && startToday != null ? Math.max(DAY_START, startToday) : DAY_START
    const ranges = freeRanges(d.busy || [], from)
    let capLeft = DAILY_CAP
    const usedToday = new Set()
    for (const [rs, re] of ranges) {
      let pos = rs
      for (;;) {
        const room = Math.min(re - pos, capLeft)
        const pick = parts.find(p => !p.placed && p.minutes <= room && !usedToday.has(p.key)
          && (p.part === 1 || (parts.find(q => q.key === p.key && q.part === p.part - 1)?.placed?.dayIndex ?? Infinity) < dayIndex))
        if (!pick) break
        pick.placed = { dayIndex }
        usedToday.add(pick.key)
        blocks.push({ key: pick.key, title: pick.title, kind: pick.kind, date: d.date, start: pos, end: pos + pick.minutes, part: pick.part, of: pick.of })
        pos += pick.minutes
        capLeft -= pick.minutes
      }
      if (capLeft <= 0) break
    }
  })
  const unfit = [...new Set(parts.filter(p => !p.placed).map(p => p.key))]
  return { blocks, unfit }
}

// "YYYY-MM-DDTHH:MM:00-08:00" for a Pacific wall-clock minute on a date.
function laIso(dateKey, minute) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
  const name = fmt.formatToParts(atNoon(dateKey)).find(p => p.type === 'timeZoneName')?.value || 'GMT-8'
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  const off = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : '-08:00'
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return `${dateKey}T${hh}:${mm}:00${off}`
}

// An instant as a Pacific date key and minute of the day.
function laParts(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) }
}

// Calendar events -> busy minute ranges per Pacific day. The Daily Planning
// placeholder, all-day events, events marked free and our own old blocks
// (being replaced) don't count.
function busyByDay(events, replacing) {
  const out = new Map()
  for (const e of events || []) {
    if (!e.start?.dateTime || !e.end?.dateTime) continue
    if (e.transparency === 'transparent') continue
    if (/^\s*daily planning\s*$/i.test(e.summary || '')) continue
    if (e.id && replacing.has(e.id)) continue
    const s = laParts(e.start.dateTime)
    const t = laParts(e.end.dateTime)
    const end = t.date === s.date ? t.minute : 24 * 60
    if (!out.has(s.date)) out.set(s.date, [])
    out.get(s.date).push([s.minute, end])
  }
  return out
}

// Claude's estimate, kept to the /briefing sizes: 30/60/90 minutes, 1-3 blocks.
function cleanEstimate(e) {
  let minutes = Number(e?.minutes) || 60
  let blocks = Math.min(3, Math.max(1, Math.round(Number(e?.blocks) || 1)))
  if (minutes > 90) { blocks = Math.min(3, Math.max(blocks, Math.ceil(minutes / 90))); minutes = 90 }
  else minutes = minutes <= 30 ? 30 : minutes <= 60 ? 60 : 90
  return { minutes, blocks }
}

module.exports = { planWeek, orderItems, laIso, laParts, busyByDay, cleanEstimate, workdays, freeRanges, DAY_START, DAY_END, DAILY_CAP }
