// Hub > New: everything that arrived that the owner hasn't opened yet (new
// tickets, submitted deliverables, replies, Incoming files). Each item clears
// when he opens it. Owner-only.
const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { buildFeed } = require('../services/hub/feed')
const { slotLabel } = require('../services/hub/slots')
const dl = require('../services/hub/deliverables')

const router = Router()
router.use(ownerOnly)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function must({ data, error }) {
  if (error) throw error
  return data
}

async function feedSince(ownerId) {
  const row = must(await supabaseAdmin.from('hub_owner_state').select('feed_since').eq('owner_staff_id', ownerId).maybeSingle())
  if (row) return row.feed_since
  // First visit: start the feed now, so tickets that already exist aren't "new".
  const { error } = await supabaseAdmin.from('hub_owner_state')
    .upsert({ owner_staff_id: ownerId }, { onConflict: 'owner_staff_id', ignoreDuplicates: true })
  if (error) throw error
  const again = must(await supabaseAdmin.from('hub_owner_state').select('feed_since').eq('owner_staff_id', ownerId).single())
  return again.feed_since
}

router.get('/new', async (req, res) => {
  try {
    const owner = req.staff.id
    const since = await feedSince(owner)
    const [tickets, seen, tasks] = await Promise.all([
      supabaseAdmin.from('tickets').select('id, title, status, created_at, type_id')
        .gt('created_at', since).in('status', ['open', 'in_progress']).limit(200).then(must),
      supabaseAdmin.from('hub_seen_tickets').select('ticket_id').eq('owner_staff_id', owner).then(must),
      supabaseAdmin.from('hub_tasks').select('id, title').eq('owner_staff_id', owner).in('status', ['todo', 'waiting']).then(must),
    ])
    const typeIds = [...new Set(tickets.map(t => t.type_id).filter(Boolean))]
    const types = typeIds.length ? must(await supabaseAdmin.from('ticket_types').select('id, name').in('id', typeIds)) : []
    const typeName = Object.fromEntries(types.map(t => [t.id, t.name]))

    const taskTitle = Object.fromEntries(tasks.map(t => [t.id, t.title]))
    const taskIds = tasks.map(t => t.id)
    let people = []
    let items = []
    let tray = []
    if (taskIds.length) {
      people = must(await supabaseAdmin.from('hub_task_people').select('id, task_id, name, state, reply_seen, last_reply_at').in('task_id', taskIds))
      const dels = must(await supabaseAdmin.from('hub_deliverables').select('id, task_id, name').in('task_id', taskIds))
      if (dels.length) {
        const slots = must(await supabaseAdmin.from('hub_slots').select('id, deliverable_id, club, person_id').in('deliverable_id', dels.map(d => d.id)))
        if (slots.length) {
          const newItems = must(await supabaseAdmin.from('hub_slot_items').select('id, slot_id, created_at')
            .in('slot_id', slots.map(s => s.id)).eq('is_new', true))
          const names = newItems.length ? await dl.clubNames() : {}
          items = newItems.map(i => {
            const s = slots.find(x => x.id === i.slot_id)
            const d = dels.find(x => x.id === s.deliverable_id)
            const p = people.find(x => x.id === s.person_id)
            return { id: i.id, at: i.created_at, person: p?.name, label: slotLabel(d, s.club, names), taskId: d.task_id, taskTitle: taskTitle[d.task_id] }
          })
        }
      }
      if (people.length) {
        const trayRows = must(await supabaseAdmin.from('hub_tray_items').select('person_id, created_at').in('person_id', people.map(p => p.id)))
        const byPerson = new Map()
        for (const r of trayRows) {
          const cur = byPerson.get(r.person_id) || { count: 0, at: r.created_at }
          cur.count++
          if (r.created_at > cur.at) cur.at = r.created_at
          byPerson.set(r.person_id, cur)
        }
        tray = [...byPerson].map(([pid, v]) => {
          const p = people.find(x => x.id === pid)
          return { personId: pid, name: p.name, count: v.count, at: v.at, taskId: p.task_id, taskTitle: taskTitle[p.task_id] }
        })
      }
    }
    const replies = people.filter(p => p.state === 'replied' && !p.reply_seen)
      .map(p => ({ personId: p.id, name: p.name, at: p.last_reply_at, taskId: p.task_id, taskTitle: taskTitle[p.task_id] }))

    res.json({
      items: buildFeed({
        since, seenTicketIds: new Set(seen.map(s => s.ticket_id)),
        tickets: tickets.map(t => ({ ...t, type_name: typeName[t.type_id] })),
        items, replies, tray,
      }),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Opening a ticket from the Hub clears it from New.
router.post('/new/tickets/:id/seen', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const { error } = await supabaseAdmin.from('hub_seen_tickets')
      .upsert({ owner_staff_id: req.staff.id, ticket_id: req.params.id }, { onConflict: 'owner_staff_id,ticket_id', ignoreDuplicates: true })
    if (error) throw error
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
