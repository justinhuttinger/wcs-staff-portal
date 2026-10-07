const { test } = require('node:test')
const assert = require('node:assert/strict')
const { triggerSignature } = require('./ghlWorkflowBackend')

test('triggerSignature matches same type + conditions regardless of ids, dates and order', () => {
  const a = { id: 'x', date_added: '1', type: 'contact_tag', conditions: [{ id: 'tag-added', operator: 'index-of-true', field: 'tagsAdded', value: 'checked in-90days', title: 'Tag added' }] }
  const b = { id: 'y', date_added: '2', type: 'contact_tag', conditions: [{ id: 'tag-added', operator: 'index-of-true', field: 'tagsAdded', value: 'checked in-90days' }] }
  const c = { ...b, conditions: [{ ...b.conditions[0], value: 'other' }] }
  assert.equal(triggerSignature(a), triggerSignature(b))
  assert.notEqual(triggerSignature(a), triggerSignature(c))
  const d1 = { type: 'custom_date_reminder', conditions: [{ id: 'x', value: 1 }, { id: 'y', value: 'sale' }] }
  const d2 = { type: 'custom_date_reminder', conditions: [{ id: 'y', value: 'sale' }, { id: 'x', value: 1 }] }
  assert.equal(triggerSignature(d1), triggerSignature(d2))
})

test('writeWorkflow creates missing triggers first and points if/else trigger checks at the target ids', async () => {
  const { writeWorkflow } = require('./ghlWorkflowBackend')
  const LOC = 'tgtLoc'
  const WF = 'wf-1'
  const dateCond = [{ id: 'custom-field', operator: 'custom-field-eq', field: 'contact.customFields', value: 'cfT' }]
  const tagCond = [{ id: 'tag-added', operator: 'index-of-true', field: 'tagsAdded', value: 'checked in-90days' }]
  let triggers = [{ id: 'tgtDate', type: 'custom_date_reminder', name: 'Custom Date Reminder', conditions: dateCond }]
  let workflow = { id: WF, status: 'published', companyId: 'co', version: 1, workflowData: { templates: [] } }
  const calls = []
  const orig = global.fetch
  global.fetch = async (url, opts = {}) => {
    const path = url.replace('https://backend.leadconnectorhq.com', '').split('?')[0]
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push(`${method} ${path}`)
    let out = null
    if (method === 'GET' && path === `/workflow/${LOC}/trigger`) out = triggers
    else if (method === 'GET' && path === `/workflow/${LOC}/${WF}`) out = workflow
    else if (method === 'POST' && path === `/workflow/${LOC}/trigger`) {
      const t = { ...body, id: 'tgtTag' }
      triggers = [...triggers, t]
      out = t
    } else if (method === 'PUT' && path === `/workflow/${LOC}/${WF}`) { workflow = { ...body, version: workflow.version + 1 }; out = workflow }
    else if (method === 'PUT' && path.startsWith(`/workflow/${LOC}/only-triggers/`)) out = { ok: true }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) }
  }
  try {
    const source = {
      workflow: { workflowData: { templates: [{ type: 'if_else', attributes: { branches: [{ segments: [{ conditions: [{ conditionType: 'trigger', conditionValue: 'srcTag' }] }] }] } }] } },
      triggers: [
        { id: 'srcTag', type: 'contact_tag', name: 'Contact Tag', conditions: tagCond },
        { id: 'srcDate', type: 'custom_date_reminder', name: 'Custom Date Reminder', conditions: dateCond },
      ],
    }
    const r = await writeWorkflow('a.b.c', LOC, WF, source)
    assert.equal(r.triggers, 1)
    assert.equal(r.triggersAlreadyThere, 1)
    assert.deepEqual(r.droppedTriggers, [])
    assert.deepEqual(r.unlinkedTriggerChecks, [])
    const cond = workflow.workflowData.templates[0].attributes.branches[0].segments[0].conditions[0]
    assert.equal(cond.conditionValue, 'tgtTag')
    // Trigger created before the steps were saved.
    assert.ok(calls.indexOf(`POST /workflow/${LOC}/trigger`) < calls.indexOf(`PUT /workflow/${LOC}/${WF}`))
  } finally {
    global.fetch = orig
  }
})

test('folders: path walks up by folderName, ensureFolderPath reuses existing and creates missing levels', async () => {
  const { folderPath, ensureFolderPath } = require('./ghlWorkflowBackend')
  const LOC = 'loc1'
  // root -> WCS (f1) -> Lead Calls (f2)
  const dirs = [
    { id: 'f1', name: 'WCS', parentId: null },
    { id: 'f2', name: 'Lead Calls', parentId: 'f1' },
  ]
  const posts = []
  const orig = global.fetch
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const method = opts.method || 'GET'
    let out = null
    if (method === 'GET' && u.pathname === `/workflow/${LOC}/list`) {
      const parent = u.searchParams.get('parentId')
      const pid = parent === 'root' ? null : parent
      const self = dirs.find(d => d.id === pid)
      const rows = dirs.filter(d => d.parentId === pid).map(d => ({ id: d.id, name: d.name, type: 'directory', parentId: pid }))
      out = { rows, count: rows.length, folderName: self ? self.name : null, parentId: self ? self.parentId : null }
    } else if (method === 'POST' && u.pathname === `/workflow/${LOC}/directory`) {
      const body = JSON.parse(opts.body)
      posts.push(body)
      const id = 'new' + posts.length
      dirs.push({ id, name: body.name, parentId: body.parentId })
      out = { id }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) }
  }
  try {
    assert.deepEqual(await folderPath('a.b.c', LOC, 'f2'), ['WCS', 'Lead Calls'])
    const same = await ensureFolderPath('a.b.c', LOC, ['wcs', 'Lead Calls'], { companyId: 'co', companyAge: 14 })
    assert.equal(same.folderId, 'f2')
    assert.deepEqual(same.created, [])
    const made = await ensureFolderPath('a.b.c', LOC, ['WCS', 'Lead Calls', 'October'], { companyId: 'co', companyAge: 14 })
    assert.deepEqual(made.created, ['October'])
    assert.equal(posts[0].parentId, 'f2')
    assert.equal(posts[0].type, 'directory')
    assert.equal(posts[0].company_id, 'co')
  } finally {
    global.fetch = orig
  }
})

function fakeGhl(LOC, WF, initialTriggers) {
  const state = { triggers: initialTriggers, workflow: { id: WF, status: 'published', companyId: 'co', version: 1, workflowData: { templates: [] } }, calls: [] }
  const fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    state.calls.push(`${method} ${u.pathname}${u.search}`)
    let out = null
    if (method === 'GET' && u.pathname === `/workflow/${LOC}/trigger`) out = state.triggers
    else if (method === 'GET' && u.pathname === `/workflow/${LOC}/${WF}`) out = state.workflow
    else if (method === 'DELETE' && u.pathname.startsWith(`/workflow/${LOC}/trigger/`)) {
      const tid = u.pathname.split('/').pop()
      state.triggers = state.triggers.filter(t => t.id !== tid)
      out = { ok: true }
    } else if (method === 'POST' && u.pathname === `/workflow/${LOC}/trigger`) {
      const t = { ...body, id: 'created' + state.calls.length }
      state.triggers = [...state.triggers, t]
      out = t
    } else if (method === 'PUT') { if (u.pathname === `/workflow/${LOC}/${WF}`) state.workflow = { ...body }; out = { ok: true } }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) }
  }
  return { state, fetch }
}

test('overwrite mirrors the source: a trigger the source no longer has is deleted with userId', async () => {
  const { writeWorkflow } = require('./ghlWorkflowBackend')
  const date = { type: 'custom_date_reminder', name: 'Custom Date Reminder', conditions: [{ id: 'custom-field', value: 'cfT' }] }
  const tag = { type: 'contact_tag', name: 'Contact Tag', conditions: [{ id: 'tag-added', value: 'checked in-90days' }] }
  const g = fakeGhl('L', 'W', [{ ...date, id: 'oldDate' }, { ...tag, id: 'oldTag' }])
  const orig = global.fetch
  global.fetch = g.fetch
  try {
    const r = await writeWorkflow('a.b.c', 'L', 'W', { workflow: { workflowData: { templates: [] } }, triggers: [{ ...tag, id: 'srcTag' }], triggersKnown: true })
    assert.deepEqual(r.removedTriggers.map(t => t.name), ['Custom Date Reminder'])
    assert.deepEqual(r.notRemovedTriggers, [])
    assert.equal(r.triggersAlreadyThere, 1)
    assert.deepEqual(g.state.triggers.map(t => t.id), ['oldTag'])
    const del = g.state.calls.find(c => c.startsWith('DELETE'))
    assert.match(del, /\/trigger\/oldDate\?userId=qHho9M6pxIE8YEgBhlxK$/)
    // Delete happens before the workflow save, as in the builder.
    assert.ok(g.state.calls.indexOf(del) < g.state.calls.indexOf('PUT /workflow/L/W'))
  } finally {
    global.fetch = orig
  }
})

test('a source with no trigger list never deletes the club\'s triggers', async () => {
  const { writeWorkflow } = require('./ghlWorkflowBackend')
  const g = fakeGhl('L', 'W', [{ id: 'keep', type: 'contact_tag', name: 'Contact Tag', conditions: [] }])
  const orig = global.fetch
  global.fetch = g.fetch
  try {
    const r = await writeWorkflow('a.b.c', 'L', 'W', { workflow: { workflowData: { templates: [] } }, triggers: [], triggersKnown: false })
    assert.equal(r.triggersUntouched, true)
    assert.deepEqual(r.removedTriggers, [])
    assert.ok(!g.state.calls.some(c => c.startsWith('DELETE')))
  } finally {
    global.fetch = orig
  }
})

test('a push carries the time window (8-7) setting', async () => {
  const { writeWorkflow } = require('./ghlWorkflowBackend')
  const g = fakeGhl('L', 'W', [])
  const orig = global.fetch
  global.fetch = g.fetch
  try {
    const window = { condition: 'when', start: '08:00', end: '19:00', days: [0, 1, 2, 3, 4, 5, 6] }
    await writeWorkflow('a.b.c', 'L', 'W', { workflow: { window, workflowData: { templates: [] } }, triggers: [], triggersKnown: true })
    assert.deepEqual(g.state.workflow.window, window)
  } finally {
    global.fetch = orig
  }
})
