// Runs the Hub Gmail check (./check) every 10 minutes for the owner.
// Dark until HUB_TASKS_SYNC_ENABLED=true. Wires the real database, Gmail and
// Claude into runCheck; the rules themselves are tested there.
const cron = require('node-cron')
const Anthropic = require('@anthropic-ai/sdk').default
  || require('@anthropic-ai/sdk').Anthropic
  || require('@anthropic-ai/sdk')
const { supabaseAdmin } = require('../supabase')
const { getStaffGoogleAccessToken } = require('../googleUserToken')
const gmail = require('../followUps/gmail')
const { OWNER_EMAILS } = require('../../lib/ownerGate')
const dl = require('./deliverables')
const { runCheck } = require('./check')
const { kindAccepts } = require('./slots')
const { runSuggestions } = require('./suggest')

const MODEL = 'claude-opus-5-5'
const apiKey = process.env.ANTHROPIC_API_KEY
const claude = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60 * 1000 }) : null

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { attachment: { type: 'string' }, slot: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        required: ['attachment', 'slot'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

// Claude's best guess at which open slot each attachment belongs in. Only a
// suggestion: the owner files every tray item himself.
async function suggest({ attachments, slots }) {
  if (!claude) return new Map()
  // Short ids (a1, s1) so the model never has to echo Gmail's long ones.
  const attIds = attachments.map((a, i) => [`a${i + 1}`, a])
  const slotIds = slots.map((s, i) => [`s${i + 1}`, s])
  const lines = [
    'A person replied to an email with attachments. Match each attachment to the open slot it most likely fills, using the file name and the email text. Use null when unsure. Never put two attachments in one slot. An image slot only takes images.',
    '', 'Open slots:', ...slotIds.map(([id, s]) => `- ${id}: ${s.label} (${s.kind})`),
    '', 'Attachments:', ...attIds.map(([id, a]) => `- ${id}: "${a.name}" (${a.mime}). Email text: ${String(a.snippet || '').slice(0, 300)}`),
  ]
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
    messages: [{ role: 'user', content: lines.join('\n') }],
  })
  if (response.stop_reason === 'refusal') return new Map()
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const out = new Map()
  for (const it of JSON.parse(text).items || []) {
    const att = attIds.find(([id]) => id === it.attachment)?.[1]
    const slot = slotIds.find(([id]) => id === it.slot)?.[1]
    // Only suggest a slot that can actually take the file.
    if (att && slot && kindAccepts(slot.kind, att.mime)) out.set(att.key, slot.id)
  }
  return out
}

function must({ data, error }) {
  if (error) throw error
  return data
}

const db = {
  listOpenPeople: async ownerId => {
    const tasks = must(await supabaseAdmin.from('hub_tasks').select('id, status').eq('owner_staff_id', ownerId).in('status', ['todo', 'waiting']))
    if (!tasks.length) return []
    const people = must(await supabaseAdmin.from('hub_task_people').select('*').in('task_id', tasks.map(t => t.id)).not('gmail_thread_id', 'is', null))
    return people.map(person => ({ person, task: tasks.find(t => t.id === person.task_id) }))
  },
  knownKeys: personId => dl.knownGmailKeys(personId),
  markSeen: (personId, key) => dl.markGmailSeen(personId, key),
  pendingTray: personId => dl.pendingTrayFor(personId),
  openSlots: personId => dl.openSlotsFor(personId),
  updatePerson: async (id, patch) => { must(await supabaseAdmin.from('hub_task_people').update(patch).eq('id', id)) },
  fileAttachment: async ({ task, slotId, att, bytes, messageId }) => {
    try {
      await dl.addSlotItem({
        taskId: task.id, slotId, source: 'email', isNew: true,
        file: { buffer: bytes, originalname: att.name, mimetype: att.mime, size: bytes.length },
        gmail: { messageId, attachmentId: att.partId },
      })
    } catch (e) {
      if (e.code !== '23505') throw e // a concurrent run already filed it
    }
  },
  trayAttachment: ({ task, person, att, bytes, tooLarge, messageId, suggestedSlotId }) => dl.addTrayItem({
    taskId: task.id, personId: person.id, suggestedSlotId, tooLarge: !!tooLarge,
    meta: { name: att.name, mime: att.mime, size: att.size },
    file: bytes ? { buffer: bytes, originalname: att.name, mimetype: att.mime, size: bytes.length } : null,
    gmail: { messageId, attachmentId: att.partId },
  }),
  refreshDelivered: personId => dl.refreshPersonDelivered(personId),
}

// ---------- Suggestions (own switch: HUB_SUGGESTIONS_ENABLED) ----------

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          request: { type: 'boolean' },
          summary: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          due_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          clubs: { type: 'array', items: { type: 'string' } },
          category: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['id', 'request', 'summary', 'title', 'description', 'due_date', 'clubs', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

// Claude reads each message and says whether the sender is asking the owner
// to do something, with a guessed task. Short ids (m1, m2) keep output small.
async function classify(items, ctx) {
  if (!items.length) return new Map()
  if (!claude) throw new Error('Claude is not configured')
  const ids = items.map((it, i) => [`m${i + 1}`, it])
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const lines = [
    'You sort messages sent to the owner of a group of gyms. For each one decide if the sender is asking the owner to do, decide, approve, send, answer or fix something (request: true). Newsletters, FYIs, thank-yous, receipts and pure updates are request: false.',
    'For requests give: summary (one short line, what they need), title (a short task title, imperative), description (2-4 lines with the details the owner needs), due_date (YYYY-MM-DD only if the message names a deadline, else null), clubs (only from the club list, else []), category (only from the category list, else null). For non-requests still fill summary; other fields empty.',
    `Today is ${today}.`,
    `Clubs: ${ctx.clubSlugs.join(', ') || 'none'}`,
    `Categories: ${ctx.categories.map(c => c.name).join(', ') || 'none'}`,
    '',
    ...ids.map(([id, it]) => `--- ${id}\nFrom: ${it.from}\nSubject: ${it.subject}\n${it.text}`),
  ]
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 6000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
    messages: [{ role: 'user', content: lines.join('\n') }],
  })
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`classify stopped: ${response.stop_reason}`)
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const out = new Map()
  for (const r of JSON.parse(text).items || []) {
    const it = ids.find(([id]) => id === r.id)?.[1]
    if (it) out.set(it.key, r)
  }
  return out
}

const suggestDb = {
  getCursor: async ownerId => {
    const row = must(await supabaseAdmin.from('hub_owner_state').select('suggest_cursor').eq('owner_staff_id', ownerId).maybeSingle())
    return row?.suggest_cursor || null
  },
  setCursor: async (ownerId, iso) => {
    must(await supabaseAdmin.from('hub_owner_state').upsert({ owner_staff_id: ownerId, suggest_cursor: iso }, { onConflict: 'owner_staff_id' }))
  },
  seenIds: async (ownerId, ids) => {
    const out = new Set()
    for (let i = 0; i < ids.length; i += 150) {
      const rows = must(await supabaseAdmin.from('hub_suggest_seen').select('message_id').eq('owner_staff_id', ownerId).in('message_id', ids.slice(i, i + 150)))
      rows.forEach(r => out.add(r.message_id))
    }
    return out
  },
  markSeen: async (ownerId, ids) => {
    const rows = ids.map(message_id => ({ owner_staff_id: ownerId, message_id }))
    for (let i = 0; i < rows.length; i += 200) {
      must(await supabaseAdmin.from('hub_suggest_seen').upsert(rows.slice(i, i + 200), { onConflict: 'owner_staff_id,message_id', ignoreDuplicates: true }))
    }
  },
  trackedThreads: async ownerId => {
    const tasks = must(await supabaseAdmin.from('hub_tasks').select('id').eq('owner_staff_id', ownerId))
    const out = new Set()
    for (let i = 0; i < tasks.length; i += 150) {
      const people = must(await supabaseAdmin.from('hub_task_people').select('gmail_thread_id')
        .in('task_id', tasks.slice(i, i + 150).map(t => t.id)).not('gmail_thread_id', 'is', null))
      people.forEach(p => out.add(p.gmail_thread_id))
    }
    return out
  },
  muted: async ownerId => new Set(must(await supabaseAdmin.from('hub_muted_senders').select('email').eq('owner_staff_id', ownerId)).map(r => r.email)),
  openForThread: async (ownerId, threadId) => must(await supabaseAdmin.from('hub_suggestions').select('*')
    .eq('owner_staff_id', ownerId).eq('gmail_thread_id', threadId).eq('status', 'open').maybeSingle()),
  insertSuggestion: async row => {
    const { error } = await supabaseAdmin.from('hub_suggestions').insert(row)
    if (error && error.code !== '23505') throw error // a concurrent run opened it
  },
  updateSuggestion: async (id, patch) => { must(await supabaseAdmin.from('hub_suggestions').update(patch).eq('id', id)) },
  openEmailSuggestions: async ownerId => must(await supabaseAdmin.from('hub_suggestions')
    .select('id, gmail_thread_id, received_at, you_replied').eq('owner_staff_id', ownerId).eq('status', 'open').eq('source', 'email')),
  context: async ownerId => ({
    clubSlugs: Object.keys(await dl.clubNames()),
    categories: must(await supabaseAdmin.from('hub_categories').select('id, name').eq('owner_staff_id', ownerId)),
  }),
}

let running = false
async function runAll() {
  if (running) return
  running = true
  try {
    for (const email of OWNER_EMAILS) {
      const { data: staff } = await supabaseAdmin.from('staff').select('id, email').eq('email', email).maybeSingle()
      if (!staff) continue
      if (process.env.HUB_TASKS_SYNC_ENABLED === 'true') {
        const r = await runCheck({ owner: staff, getToken: getStaffGoogleAccessToken, db, gmail, suggest })
        if (r.replies || r.filed || r.trayed || r.errors.length) console.log('[HubCheck]', email.replace(/@.*/, '@…'), r)
      }
      // After the thread check, so replies on task threads are already handled.
      if (process.env.HUB_SUGGESTIONS_ENABLED === 'true' && !claude) {
        console.warn('[HubSuggest] ANTHROPIC_API_KEY missing; suggestions paused')
      } else if (process.env.HUB_SUGGESTIONS_ENABLED === 'true') {
        try {
          const s = await runSuggestions({ owner: staff, getToken: getStaffGoogleAccessToken, db: suggestDb, gmail, classify })
          if (s.suggested || s.updated || s.errors.length) console.log('[HubSuggest]', { ...s, errors: s.errors.slice(0, 5) })
        } catch (e) { console.error('[HubSuggest] run failed:', e.message) }
      }
    }
  } catch (e) {
    console.error('[HubCheck] run failed:', e.message)
  } finally {
    running = false
  }
}

function start() {
  if (process.env.HUB_TASKS_SYNC_ENABLED !== 'true' && process.env.HUB_SUGGESTIONS_ENABLED !== 'true') return
  cron.schedule('*/10 * * * *', () => { runAll() })
  console.log('[HubCheck] scheduled every 10 minutes')
}

module.exports = { start, runAll, suggest, classify }
