const test = require('node:test')
const assert = require('node:assert/strict')
const { buildMultimodalBody } = require('../src/media/voyageClient')

test('buildMultimodalBody wraps text + image into Voyage content format', () => {
  const body = buildMultimodalBody(
    [{ imageDataUrl: 'data:image/jpeg;base64,AAAA' }, { text: 'deadlift' }],
    'document'
  )
  assert.equal(body.model, 'voyage-multimodal-3.5')
  assert.equal(body.input_type, 'document')
  assert.equal(body.inputs.length, 2)
  assert.deepEqual(body.inputs[0].content[0], { type: 'image_url', image_url: 'data:image/jpeg;base64,AAAA' })
  assert.deepEqual(body.inputs[1].content[0], { type: 'text', text: 'deadlift' })
})
