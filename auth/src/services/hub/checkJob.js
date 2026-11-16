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
        properties: { attachment_id: { type: 'string' }, slot_id: { type: ['string', 'null'] } },
        required: ['attachment_id', 'slot_id'],
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
  const lines = [
    'A person replied to an email with attachments. Match each attachment to the open slot it most likely fills, using the file name and the email text. Use null when unsure. Never put two attachments in one slot.',
    '', 'Open slots:', ...slots.map(s => `- ${s.id}: ${s.label} (${s.kind})`),
    '', 'Attachments:', ...attachments.map(a => `- ${a.attachmentId}: "${a.name}" (${a.mime}). Email text: ${String(a.snippet || '').slice(0, 300)}`),
  ]
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
    messages: [{ role: 'user', content: lines.join('\n') }],
  })
  if (response.stop_reason === 'refusal') return new Map()
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const valid = new Set(slots.map(s => s.id))
  const out = new Map()
  for (const it of JSON.parse(text).items || []) {
    if (it.slot_id && valid.has(it.slot_id)) out.set(it.attachment_id, it.slot_id)
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
  openSlots: personId => dl.openSlotsFor(personId),
  updatePerson: async (id, patch) => { must(await supabaseAdmin.from('hub_task_people').update(patch).eq('id', id)) },
  fileAttachment: async ({ task, slotId, att, bytes, messageId }) => {
    try {
      await dl.addSlotItem({
        taskId: task.id, slotId, source: 'email', isNew: true,
        file: { buffer: bytes, originalname: att.name, mimetype: att.mime, size: bytes.length },
        gmail: { messageId, attachmentId: att.attachmentId },
      })
    } catch (e) {
      if (e.code !== '23505') throw e // a concurrent run already filed it
    }
  },
  trayAttachment: ({ task, person, att, bytes, messageId, suggestedSlotId }) => dl.addTrayItem({
    taskId: task.id, personId: person.id, suggestedSlotId,
    file: { buffer: bytes, originalname: att.name, mimetype: att.mime, size: bytes.length },
    gmail: { messageId, attachmentId: att.attachmentId },
  }),
  refreshDelivered: personId => dl.refreshPersonDelivered(personId),
}

let running = false
async function runAll() {
  if (running) return
  running = true
  try {
    for (const email of OWNER_EMAILS) {
      const { data: staff } = await supabaseAdmin.from('staff').select('id, email').eq('email', email).maybeSingle()
      if (!staff) continue
      const r = await runCheck({ owner: staff, getToken: getStaffGoogleAccessToken, db, gmail, suggest })
      if (r.replies || r.filed || r.trayed || r.errors.length) console.log('[HubCheck]', email.replace(/@.*/, '@…'), r)
    }
  } catch (e) {
    console.error('[HubCheck] run failed:', e.message)
  } finally {
    running = false
  }
}

function start() {
  if (process.env.HUB_TASKS_SYNC_ENABLED !== 'true') return
  cron.schedule('*/10 * * * *', () => { runAll() })
  console.log('[HubCheck] scheduled every 10 minutes')
}

module.exports = { start, runAll, suggest }
