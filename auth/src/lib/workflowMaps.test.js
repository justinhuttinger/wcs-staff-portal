const test = require('node:test')
const assert = require('node:assert')
const { sanitizeMapInput } = require('./workflowMaps')

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
