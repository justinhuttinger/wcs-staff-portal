// Hub > Plan my week: puts the owner's open work (To do tasks, tasks needing
// review, all open/in-progress tickets) on his Google Calendar as yellow
// Focus blocks, the same way /briefing does. Each run clears the future
// blocks it made before and rebuilds. Owner-only.
const { Router } = require('express')
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { getStaffGoogleAccessToken } = require('../services/googleUserToken')
const dl = require('../services/hub/deliverables')
const { planWeek, orderItems, laIso, laParts, busyByDay, cleanEstimate, workdays, DAY_START, DAY_END } = require('../services/hub/plan')

const router = Router()
router.use(ownerOnly)

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.wcstrength.com'
const apiKey = process.env.ANTHROPIC_API_KEY
const claude = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60 * 1000 }) : null

function must({ data, error }) {
  if (error) throw error
  return data
}

async function cal(token, url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  if (!res.ok && !(init.method === 'DELETE' && (res.status === 404 || res.status === 410))) {
    const body = await res.text().catch(() => '')
    const e = new Error(`Calendar ${res.status}: ${body.slice(0, 200)}`)
    if (res.status === 401 || (res.status === 403 && !/rateLimit|quota/i.test(body))) e.notConnected = true
    throw e
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

// One Claude call: minutes per item like /briefing (quick 30, normal 60, big 90; bigger = 2-3 blocks).
async function estimate(items) {
  const out = new Map()
  if (!items.length || !claude) return out
  const lines = items.map((i, n) => `${n + 1}. [${i.kind}] ${i.title}${i.detail ? ` - ${String(i.detail).slice(0, 200)}` : ''}`)
  const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
    n: { type: 'integer' }, minutes: { type: 'integer' }, blocks: { type: 'integer' },
  }, required: ['n', 'minutes', 'blocks'], additionalProperties: false } } }, required: ['items'], additionalProperties: false }
  try {
    const r = await claude.messages.create({
      model: 'claude-opus-5-5', max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: `Estimate desk time for each item for a gym owner's week. Use 30 for quick (email, check, reply, approve), 60 for normal (build, investigate, draft, fix), 90 for big (rollout, new system, multi-step). Work bigger than 90 minutes: minutes 90 and blocks 2 or 3. Return one entry per item number.\n\n${lines.join('\n')}` }],
    })
    if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') return out
    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('')
    for (const e of JSON.parse(text).items || []) {
      const it = items[e.n - 1]
      if (it) out.set(it.key, cleanEstimate(e))
    }
  } catch (e) { console.warn('[HubPlan] estimate failed, using 60 min:', e.message) }
  return out
}

router.post('/plan', async (req, res) => {
  try {
    const owner = req.staff.id
    const { accessToken } = await getStaffGoogleAccessToken(owner)

    // ---- what needs time ----
    const tasks = must(await supabaseAdmin.from('hub_tasks').select('id, title, description, due_date, priority, created_at, status, minutes_override')
      .eq('owner_staff_id', owner).in('status', ['todo', 'waiting']))
    const waitingIds = tasks.filter(t => t.status === 'waiting').map(t => t.id)
    const review = new Set()
    if (waitingIds.length) {
      const replied = must(await supabaseAdmin.from('hub_task_people').select('task_id').in('task_id', waitingIds).eq('state', 'replied').eq('reply_seen', false))
      replied.forEach(r => review.add(r.task_id))
      const summary = await dl.summaryByTask(waitingIds)
      for (const [id, s] of summary) if (s.newItems > 0) review.add(id)
    }
    const tickets = must(await supabaseAdmin.from('tickets').select('id, title, status, priority, created_at').in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: true }).limit(300))
    const ticketPriority = p => (p === 'urgent' || p === 'high' ? 'high' : p === 'low' ? 'low' : 'medium')

    const items = [
      ...tasks.filter(t => t.status === 'todo' || review.has(t.id)).map(t => ({
        key: `task:${t.id}`, kind: 'task', refId: t.id, title: t.title, detail: t.description,
        due: t.due_date, priority: t.priority, created_at: t.created_at, override: t.minutes_override,
      })),
      ...tickets.map(t => ({ key: `ticket:${t.id}`, kind: 'ticket', refId: t.id, title: t.title || 'Ticket', due: null, priority: ticketPriority(t.priority), created_at: t.created_at })),
    ]
    const ordered = orderItems(items, laParts(new Date().toISOString()).date)
    const est = await estimate(ordered.filter(i => !i.override).slice(0, 60))
    for (const i of items) Object.assign(i, i.override ? cleanEstimate({ minutes: i.override }) : (est.get(i.key) || { minutes: 60, blocks: 1 }))

    // ---- the window: next 5 weekdays, today from the next quarter hour ----
    const now = new Date()
    const nowLa = laParts(now.toISOString())
    const days = workdays(nowLa.date, 5)
    let startToday = null
    if (days[0] === nowLa.date) {
      startToday = Math.ceil((nowLa.minute + 1) / 15) * 15
      if (startToday >= DAY_END) { days.shift(); startToday = null; days.push(workdays(days[days.length - 1], 2)[1]) }
    }

    // ---- clear our own future blocks, then read the calendar ----
    const old = must(await supabaseAdmin.from('hub_plan_events').select('event_id').eq('owner_staff_id', owner).gt('starts_at', now.toISOString()))
    const kept = must(await supabaseAdmin.from('hub_plan_events').select('ref_kind, ref_id, starts_at').eq('owner_staff_id', owner)
      .lte('starts_at', now.toISOString()).gte('starts_at', new Date(laIso(nowLa.date, 0)).toISOString()))
    const alreadyToday = kept.map(k => `${k.ref_kind}:${k.ref_id}`)
    const replacing = new Set(old.map(o => o.event_id))
    const timeMin = now.toISOString()
    const timeMax = new Date(laIso(days[days.length - 1], DAY_END)).toISOString()
    const events = []
    let pageToken = ''
    do {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })
      if (pageToken) q.set('pageToken', pageToken)
      const page = await cal(accessToken, `${CAL}?${q}`)
      events.push(...(page?.items || []))
      pageToken = page?.nextPageToken || ''
    } while (pageToken)
    const busy = busyByDay(events, replacing)

    for (const id of replacing) await cal(accessToken, `${CAL}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (replacing.size) must(await supabaseAdmin.from('hub_plan_events').delete().in('event_id', [...replacing]))

    // ---- plan and create ----
    const { blocks, unfit, partial } = planWeek({ days: days.map(d => ({ date: d, busy: busy.get(d) || [] })), items: ordered, startToday, alreadyToday })
    const byKey = new Map(items.map(i => [i.key, i]))
    const added = []
    for (const b of blocks) {
      const it = byKey.get(b.key)
      const summary = `Focus: ${b.title}${b.of > 1 ? ` (${b.part} of ${b.of})` : ''}`
      const description = [
        it.kind === 'ticket' ? 'Ticket' : 'Hub task',
        it.due ? `Due ${it.due}` : null,
        it.detail ? String(it.detail).slice(0, 1500) : null,
        `${PORTAL_URL}/#open/hub`,
      ].filter(Boolean).join('\n\n')
      const ev = await cal(accessToken, CAL, { method: 'POST', body: JSON.stringify({
        summary, description, colorId: '5', transparency: 'opaque',
        start: { dateTime: laIso(b.date, b.start), timeZone: 'America/Los_Angeles' },
        end: { dateTime: laIso(b.date, b.end), timeZone: 'America/Los_Angeles' },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
      }) })
      const { error: trackErr } = ev?.id ? await supabaseAdmin.from('hub_plan_events').insert({
        event_id: ev.id, owner_staff_id: owner, ref_kind: it.kind, ref_id: it.refId, starts_at: new Date(laIso(b.date, b.start)).toISOString(),
      }) : { error: new Error('Calendar returned no event id') }
      if (trackErr) {
        if (ev?.id) await cal(accessToken, `${CAL}/${encodeURIComponent(ev.id)}`, { method: 'DELETE' }).catch(() => {})
        throw trackErr
      }
      added.push({ title: summary, date: b.date, start: b.start, end: b.end, kind: it.kind })
    }
    res.json({ added, unfit: unfit.map(k => byKey.get(k)?.title).filter(Boolean), partial: partial.map(k => byKey.get(k)?.title).filter(Boolean), cleared: replacing.size })
  } catch (e) {
    if (e.notConnected) return res.status(412).json({ error: 'Connect Google first (Hub > Connect Gmail)', code: 'gmail_not_connected' })
    console.error('[HubPlan]', e.message)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
