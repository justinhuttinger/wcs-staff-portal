// Step types for Workflow Maps. Each React Flow node's `type` is one of these
// keys; everything a step holds lives in node.data (see blankData()).
//
// The set mirrors what our GoHighLevel workflows actually do, so a GHL flow can
// be drawn one step per GHL action. `ghl` on node.data is reserved for a future
// sync (GHL step id + type) and is carried through untouched.

// Heroicons (outline, 24px) path data.
const ICONS = {
  trigger: 'm3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z',
  sms: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z',
  email: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
  wait: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  condition: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  call: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z',
  action: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  goal: 'M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5',
  note: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10',
}

export const KINDS = {
  trigger:   { label: 'Trigger',     color: '#16a34a', icon: ICONS.trigger,   hint: 'What starts the workflow' },
  sms:       { label: 'Text (SMS)',  color: '#2563eb', icon: ICONS.sms,       hint: 'Text message to the contact' },
  email:     { label: 'Email',       color: '#7c3aed', icon: ICONS.email,     hint: 'Email to the contact' },
  wait:      { label: 'Wait',        color: '#d97706', icon: ICONS.wait,      hint: 'Pause before the next step' },
  condition: { label: 'Condition',   color: '#db2777', icon: ICONS.condition, hint: 'If / else split' },
  call:      { label: 'Call',        color: '#0d9488', icon: ICONS.call,      hint: 'Staff phone call + script' },
  action:    { label: 'Action',      color: '#475569', icon: ICONS.action,    hint: 'Tag, notify, task, field update' },
  goal:      { label: 'Goal / End',  color: '#dc2626', icon: ICONS.goal,      hint: 'Workflow ends or goal reached' },
  note:      { label: 'Note',        color: '#ca8a04', icon: ICONS.note,      hint: 'Freeform annotation' },
}

export const KIND_KEYS = Object.keys(KINDS)

export const WAIT_UNITS = ['minutes', 'hours', 'days', 'weeks']

// GHL "Action" steps that are not a message, wait or branch.
export const ACTION_TYPES = [
  'Add tag', 'Remove tag', 'Internal notification', 'Assign to user', 'Create task',
  'Update contact field', 'Create / move opportunity', 'Add to workflow',
  'Remove from workflow', 'Book appointment', 'Webhook', 'Other',
]

// Per-step "what should change in GHL" marker, so a map can double as a
// change list for whoever edits the live workflow.
export const CHANGE_FLAGS = {
  '':       { label: 'Live as-is',      color: null },
  new:      { label: 'New: add to GHL', color: '#16a34a' },
  change:   { label: 'Change in GHL',   color: '#d97706' },
  remove:   { label: 'Remove from GHL', color: '#dc2626' },
}

export const WORKFLOW_STATUSES = { draft: 'Draft', live: 'Live', paused: 'Paused', idea: 'Idea' }

let seq = 0
export function newId(prefix = 'n') {
  seq = (seq + 1) % 1000
  return prefix + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 5)
}

export function defaultBranches() {
  return [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
}

export function blankData(kind) {
  const base = { title: '', body: '', link: '', notes: '', change: '' }
  switch (kind) {
    case 'trigger': return { ...base, title: 'New trigger' }
    case 'sms': return { ...base, title: 'Text message' }
    case 'email': return { ...base, title: 'Email', subject: '', previewText: '' }
    case 'wait': return { ...base, title: 'Wait', waitMode: 'duration', waitAmount: 1, waitUnit: 'days', waitUntil: '' }
    case 'condition': return { ...base, title: 'Condition?', branches: defaultBranches() }
    case 'call': return { ...base, title: 'Call' }
    case 'action': return { ...base, title: 'Action', actionType: 'Add tag' }
    case 'goal': return { ...base, title: 'End' }
    default: return { ...base, title: 'Note' }
  }
}

export function waitSummary(d) {
  if (d.waitMode === 'until') return d.waitUntil ? 'Until ' + d.waitUntil : 'Until event'
  const n = Number(d.waitAmount) || 0
  const unit = d.waitUnit || 'days'
  return `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`
}

// One-line preview shown on the card.
export function stepSummary(type, d) {
  if (type === 'wait') return waitSummary(d)
  if (type === 'email') return d.subject ? 'Subject: ' + d.subject : d.body
  if (type === 'action') return [d.actionType, d.body].filter(Boolean).join(': ')
  if (type === 'condition') return d.body
  return d.body
}

// {first_name} and GHL's {{contact.first_name}} style merge fields.
export const MERGE_FIELD_RE = /(\{\{[^{}]+\}\}|\{[a-z0-9_.]+\})/gi

export const MERGE_FIELDS = [
  '{{contact.first_name}}', '{{contact.last_name}}', '{{contact.phone}}', '{{contact.email}}',
  '{{location.name}}', '{{location.phone}}', '{{user.first_name}}', '{{appointment.start_time}}',
]

// SMS segments: GSM-7 = 160 chars (153 per part), anything else (emoji,
// curly quotes) = UCS-2 at 70 (67 per part). Merge fields are counted as typed.
export function smsSegments(text) {
  const s = text || ''
  if (!s) return { chars: 0, segments: 0, unicode: false }
  // eslint-disable-next-line no-control-regex
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]/.test(s)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  const chars = [...s].length
  return { chars, segments: chars <= single ? 1 : Math.ceil(chars / multi), unicode }
}
