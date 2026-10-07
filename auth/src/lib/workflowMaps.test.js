const test = require('node:test')
const assert = require('node:assert')
const { sanitizeMapInput, findLinkedValue, normalizeCvKey, findEmailSubject } = require('./workflowMaps')

const node = (id, type = 'sms', extra = {}) => ({ id, type, position: { x: 1, y: 2 }, data: { title: id }, ...extra })

test('create requires a name', () => {
  assert.equal(sanitizeMapInput({}, { requireName: true }).error, 'Name is required')
  assert.equal(sanitizeMapInput({ name: '   ' }, { requireName: true }).error, 'Name is required')
  assert.equal(sanitizeMapInput({ name: ' Lead flow ' }, { requireName: true }).fields.name, 'Lead flow')
})

test('a partial update only returns the fields sent', () => {
  const { fields } = sanitizeMapInput({ description: 'x' })
  assert.deepEqual(fields, { description: 'x' })
})

test('nodes and edges travel together', () => {
  assert.match(sanitizeMapInput({ nodes: [] }).error, /together/)
})

test('rejects unknown step types and duplicate ids', () => {
  assert.match(sanitizeMapInput({ nodes: [node('a', 'bogus')], edges: [] }).error, /unknown type/)
  assert.match(sanitizeMapInput({ nodes: [node('a'), node('a')], edges: [] }).error, /same id/)
})

test('drops edges to missing steps and strips extra node props', () => {
  const { fields } = sanitizeMapInput({
    nodes: [node('a', 'condition', { selected: true, measured: { width: 1 } }), node('b')],
    edges: [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'yes', animated: true },
      { id: 'e2', source: 'a', target: 'gone' },
    ],
  })
  assert.deepEqual(fields.nodes[0], { id: 'a', type: 'condition', position: { x: 1, y: 2 }, data: { title: 'a' } })
  assert.deepEqual(fields.edges, [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'yes' }])
})

test('validates status and viewport', () => {
  assert.equal(sanitizeMapInput({ status: 'nope' }).error, 'Invalid status')
  assert.equal(sanitizeMapInput({ viewport: { x: 'a' } }).fields.viewport, null)
  assert.deepEqual(sanitizeMapInput({ viewport: { x: 1, y: 2, zoom: 0.5, extra: 1 } }).fields.viewport, { x: 1, y: 2, zoom: 0.5 })
})

test('linked custom values resolve by key, then by name', () => {
  const values = [
    { id: '1', name: 'New Lead SMS 1', fieldKey: 'custom_values.new_lead_sms_1' },
    { id: '2', name: 'Past Due SMS 1', fieldKey: 'custom_values.past_due_sms_1' },
  ]
  assert.equal(normalizeCvKey('{{ custom_values.New_Lead_SMS_1 }}'), 'custom_values.new_lead_sms_1')
  assert.equal(findLinkedValue(values, { key: '{{ custom_values.past_due_sms_1 }}' }).id, '2')
  assert.equal(findLinkedValue(values, { name: ' new lead sms 1' }).id, '1')
  assert.equal(findLinkedValue(values, { key: 'custom_values.gone', name: 'Past Due SMS 1' }).id, '2')
  assert.equal(findLinkedValue(values, { key: 'custom_values.gone' }), null)
  assert.equal(findLinkedValue(values, null), null)
})

test('findEmailSubject pairs "<Name> HTML" with "<Name> Subject"', () => {
  const values = [
    { id: 'h', name: 'New Lead Email 1 HTML' },
    { id: 's', name: 'New Lead Email 1 Subject' },
    { id: 'x', name: 'New Lead SMS 1' },
  ]
  assert.equal(findEmailSubject(values, values[0]).id, 's')
  assert.equal(findEmailSubject(values, { name: 'new lead email 1 html ' }).id, 's')
  assert.equal(findEmailSubject(values, values[2]), null)
  assert.equal(findEmailSubject(values, { name: 'Free Pass Email 1 HTML' }), null)
  assert.equal(findEmailSubject(values, null), null)
})
