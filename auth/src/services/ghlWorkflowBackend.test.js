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
