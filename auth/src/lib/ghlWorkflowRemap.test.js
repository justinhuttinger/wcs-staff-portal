const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildIdMap, remapPayload, normalizePayload, replaceIds } = require('./ghlWorkflowRemap')

const SRC_LOC = 'srcLocation000000001'
const TGT_LOC = 'tgtLocation000000001'

const source = {
  customFields: [{ id: 'cfSrc00000000000000A', name: 'Lead Status', fieldKey: 'contact.lead_status' }],
  users: [{ id: 'userSrc0000000000001', email: 'Coach@WCS.com' }, { id: 'userSrc0000000000002', email: 'gone@wcs.com' }],
  tags: [{ id: 'tagSrc00000000000001', name: 'vip' }],
  workflows: [{ id: 'wfSrc000000000000001', name: 'B. Follow Up' }],
  calendars: null,
}
const target = {
  customFields: [{ id: 'cfTgt00000000000000A', name: 'Lead status (renamed)', fieldKey: 'contact.lead_status' }],
  users: [{ id: 'userTgt0000000000001', email: 'coach@wcs.com' }],
  tags: [{ id: 'tagTgt00000000000001', name: 'VIP' }, { id: 'tagTgt00000000000002', name: 'vip' }],
  workflows: [{ id: 'wfTgt000000000000001', name: 'B. Follow Up' }],
  calendars: [],
}

test('buildIdMap matches by field key, email (case-insensitive) and name', () => {
  const { map, unavailable } = buildIdMap(source, target)
  assert.equal(map.get('cfSrc00000000000000A').targetId, 'cfTgt00000000000000A')
  assert.equal(map.get('userSrc0000000000001').targetId, 'userTgt0000000000001')
  assert.equal(map.get('userSrc0000000000002').targetId, null)
  assert.equal(map.get('tagSrc00000000000001').targetId, 'tagTgt00000000000001')
  assert.equal(map.get('tagSrc00000000000001').ambiguous, true)
  assert.deepEqual(unavailable, [{ category: 'calendars', side: 'source' }])
})

test('remapPayload swaps ids in values, keys and embedded strings, and reports unmatched', () => {
  const { map } = buildIdMap(source, target)
  const workflow = {
    id: 'selfWorkflowId000001',
    locationId: SRC_LOC,
    workflowData: {
      templates: [
        { id: '7b1c3f0e-0000-4000-8000-000000000001', type: 'if_else', attributes: { field: 'cfSrc00000000000000A', url: `https://x/location/${SRC_LOC}/c` } },
        { id: '7b1c3f0e-0000-4000-8000-000000000002', type: 'assign_user', attributes: { user_list: ['userSrc0000000000001', 'userSrc0000000000002'] } },
        { id: '7b1c3f0e-0000-4000-8000-000000000003', type: 'add_to_workflow', attributes: { workflow_id: 'wfSrc000000000000001', byField: { cfSrc00000000000000A: 1 } } },
      ],
    },
  }
  const triggers = [{ workflow_id: 'selfWorkflowId000001', conditions: [{ field: 'contact.customField.cfSrc00000000000000A' }] }]
  const out = remapPayload({ workflow, triggers }, {
    idMap: map, sourceLocationId: SRC_LOC, targetLocationId: TGT_LOC, extra: { selfWorkflowId000001: 'newWorkflowId0000001' },
  })
  const t = out.workflow.workflowData.templates
  assert.equal(t[0].id, '7b1c3f0e-0000-4000-8000-000000000001')
  assert.equal(t[0].attributes.field, 'cfTgt00000000000000A')
  assert.equal(t[0].attributes.url, `https://x/location/${TGT_LOC}/c`)
  assert.deepEqual(t[1].attributes.user_list, ['userTgt0000000000001', 'userSrc0000000000002'])
  assert.equal(t[2].attributes.workflow_id, 'wfTgt000000000000001')
  assert.deepEqual(Object.keys(t[2].attributes.byField), ['cfTgt00000000000000A'])
  assert.equal(out.workflow.id, 'newWorkflowId0000001')
  assert.equal(out.triggers[0].conditions[0].field, 'contact.customField.cfTgt00000000000000A')
  assert.equal(out.triggers[0].workflow_id, 'newWorkflowId0000001')
  assert.deepEqual(out.unmatched.map(u => u.name), ['gone@wcs.com'])
  assert.equal(out.matched.length, 3)
  // Source untouched.
  assert.equal(workflow.workflowData.templates[0].attributes.field, 'cfSrc00000000000000A')
})

test('replaceIds prefers the longest id when one contains another', () => {
  const { value } = replaceIds({ a: 'abcdef-long' }, new Map([['abc', 'X'], ['abcdef-long', 'Y']]))
  assert.equal(value.a, 'Y')
})

test('normalizePayload accepts our format, the extension format, and raw workflows', () => {
  const wf = { locationId: SRC_LOC, workflowData: { templates: [] } }
  assert.equal(normalizePayload({ workflow: wf, triggers: [{ a: 1 }] }).triggers.length, 1)
  assert.equal(normalizePayload({ ...wf, exportedTriggers: [{ a: 1 }, { b: 2 }] }).triggers.length, 2)
  assert.equal(normalizePayload({ data: wf }).sourceLocationId, SRC_LOC)
  assert.throws(() => normalizePayload({ foo: 1 }))
})

test('club names are ignored when matching, and overrides fill gaps', () => {
  const src = { calendars: [{ id: 'calSrc00000000000001', name: 'Salem Gym Tour' }], users: [{ id: 'userSrc0000000000009', email: 'old@x.com' }] }
  const tgt = { calendars: [{ id: 'calTgt00000000000001', name: 'Keizer Gym Tour' }], users: [{ id: 'userTgt0000000000009', email: 'new@x.com' }] }
  const { map } = buildIdMap(src, tgt, { sourceAliases: ['Salem'], targetAliases: ['Keizer'] })
  assert.equal(map.get('calSrc00000000000001').targetId, 'calTgt00000000000001')
  const wf = { workflowData: { templates: [{ attributes: { cal: 'calSrc00000000000001', user: 'userSrc0000000000009' } }] } }
  const out = remapPayload({ workflow: wf, triggers: [] }, { idMap: map, overrides: { userSrc0000000000009: 'userTgt0000000000009' } })
  assert.equal(out.workflow.workflowData.templates[0].attributes.user, 'userTgt0000000000009')
  assert.equal(out.unmatched.length, 0)
  assert.equal(out.matched.find(m => m.category === 'users').manual, true)
})
