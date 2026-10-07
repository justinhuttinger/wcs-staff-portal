// Starting points for new workflow maps, plus the JSON export/import format.
// The "New Lead Follow-up" graph is also seeded into the DB by migration 233.
import { KIND_KEYS, defaultBranches } from './kinds'

export const EXPORT_FORMAT = 'wcs-workflow-map'
export const EXPORT_VERSION = 1

const step = (id, type, x, y, data) => ({
  id, type, position: { x, y },
  data: { title: '', body: '', link: '', notes: '', change: '', ...data },
})

const edge = (source, target, sourceHandle) => ({
  id: `e-${source}-${sourceHandle ? sourceHandle + '-' : ''}${target}`,
  source, target, ...(sourceHandle ? { sourceHandle } : {}),
})

export function newLeadFollowUp() {
  return {
    name: 'New Lead Follow-up',
    description: 'Free pass lead: welcome text, free pass email, check-in text, then branch on reply.',
    category: 'Leads',
    status: 'draft',
    nodes: [
      step('trigger', 'trigger', 0, 0, {
        title: 'New lead submits free pass form',
        body: 'Form submitted: Free Pass (website or Meta lead form). Contact is tagged "free pass".',
      }),
      step('welcome', 'sms', 0, 190, {
        title: 'Welcome text',
        body: 'Hey {{contact.first_name}}! This is {{user.first_name}} at West Coast Strength {{location.name}}. Your free pass is ready. When were you thinking of coming in?',
      }),
      step('wait1', 'wait', 0, 380, { title: 'Wait 1 day', waitMode: 'duration', waitAmount: 1, waitUnit: 'days', waitUntil: '' }),
      step('email', 'email', 0, 570, {
        title: 'Free pass email',
        subject: 'Your free pass to West Coast Strength',
        previewText: 'Show this at the front desk to get started',
        body: 'Hi {{contact.first_name}},\n\nThanks for grabbing a free pass to West Coast Strength {{location.name}}. Bring this email to the front desk and we will get you set up.\n\nSee you soon,\nThe {{location.name}} team',
      }),
      step('wait2', 'wait', 0, 760, { title: 'Wait 2 days', waitMode: 'duration', waitAmount: 2, waitUnit: 'days', waitUntil: '' }),
      step('checkin', 'sms', 0, 950, {
        title: 'Check-in text',
        body: 'Hi {{contact.first_name}}, just checking in. Were you able to use your free pass yet? Happy to save you a time to come in.',
      }),
      step('replied', 'condition', 0, 1140, { title: 'Replied?', branches: defaultBranches() }),
      step('notify', 'action', -170, 1360, {
        title: 'Notify club staff', actionType: 'Internal notification',
        body: 'Text the front desk: lead replied, follow up today.',
      }),
      step('end', 'goal', -170, 1550, { title: 'End: staff takes over' }),
      step('wait3', 'wait', 170, 1360, { title: 'Wait 1 day', waitMode: 'duration', waitAmount: 1, waitUnit: 'days', waitUntil: '' }),
      step('call', 'call', 170, 1550, {
        title: 'Follow-up call',
        body: 'Call script: introduce yourself, ask if they still want to use the free pass, offer a tour time.',
      }),
      step('note', 'note', 340, 0, {
        title: 'How to use this map',
        body: 'Click any step to see its full copy. Use Edit to change text, + Add to add steps, and drag between the dots to connect them.',
      }),
    ],
    edges: [
      edge('trigger', 'welcome'), edge('welcome', 'wait1'), edge('wait1', 'email'),
      edge('email', 'wait2'), edge('wait2', 'checkin'), edge('checkin', 'replied'),
      edge('replied', 'notify', 'yes'), edge('notify', 'end'),
      edge('replied', 'wait3', 'no'), edge('wait3', 'call'),
    ],
  }
}

export const TEMPLATES = [
  { key: 'blank', label: 'Blank', desc: 'Start with just a trigger', build: () => ({
    name: 'Untitled workflow', description: '', category: '', status: 'draft',
    nodes: [step('trigger', 'trigger', 0, 0, { title: 'New trigger' })], edges: [],
  }) },
  { key: 'new-lead', label: 'New Lead Follow-up', desc: 'Text, email, waits and a reply branch', build: newLeadFollowUp },
]

export function exportPayload(map) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    workflow: {
      name: map.name, description: map.description || '', category: map.category || '',
      status: map.status || 'draft', clubs: map.clubs || [], ghl_workflow_url: map.ghl_workflow_url || '',
      nodes: map.nodes || [], edges: map.edges || [],
    },
  }
}

// Validate an uploaded export. Returns the workflow fields to create, or throws
// with a message a person can act on.
export function parseImport(text) {
  let json
  try { json = JSON.parse(text) } catch { throw new Error('That file is not valid JSON.') }
  const wf = json?.format === EXPORT_FORMAT ? json.workflow : json
  if (!wf || !Array.isArray(wf.nodes) || !Array.isArray(wf.edges)) {
    throw new Error('That file is not a workflow map export.')
  }
  const ids = new Set()
  const nodes = wf.nodes.map(n => {
    if (!n || typeof n.id !== 'string' || !KIND_KEYS.includes(n.type)) throw new Error('A step in that file has an unknown type.')
    ids.add(n.id)
    return { id: n.id, type: n.type, position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }, data: n.data || {} }
  })
  const edges = wf.edges
    .filter(e => e && ids.has(e.source) && ids.has(e.target))
    .map(e => ({ id: String(e.id || `e-${e.source}-${e.target}`), source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}) }))
  return {
    name: String(wf.name || 'Imported workflow').slice(0, 200),
    description: String(wf.description || ''),
    category: String(wf.category || ''),
    status: wf.status || 'draft',
    clubs: Array.isArray(wf.clubs) ? wf.clubs : [],
    ghl_workflow_url: String(wf.ghl_workflow_url || ''),
    nodes, edges,
  }
}
