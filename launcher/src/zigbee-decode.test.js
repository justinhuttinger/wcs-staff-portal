const test = require('node:test')
const assert = require('node:assert/strict')
const zhc = require('zigbee-herdsman-converters')
const { createDecoder } = require('./zigbee-decode')

// The Aqara Wireless Mini Switch (WXKG11LM) as zigbee-herdsman reports it.
const button = {
  ieeeAddr: '0x00158d0001234567', type: 'EndDevice', modelID: 'lumi.sensor_switch.aq2',
  manufacturerName: 'LUMI', manufacturerID: 4151, powerSource: 'Battery', endpoints: [],
}
const message = (cluster, data) => ({ device: button, endpoint: { ID: 1 }, type: 'attributeReport', cluster, data, linkquality: 120, meta: {} })

async function decodeAll(messages) {
  const payloads = []
  const decode = createDecoder(zhc, (device, payload) => payloads.push(payload))
  for (const m of messages) await decode(m)
  return payloads
}

test('a single press on the Aqara mini switch decodes to action single', async () => {
  const payloads = await decodeAll([message('genOnOff', { onOff: 1 })])
  assert.deepEqual(payloads.map((p) => p.action).filter(Boolean), ['single'])
})

test('a double press decodes to action double', async () => {
  const payloads = await decodeAll([message('genOnOff', { 32768: 2 })])
  assert.deepEqual(payloads.map((p) => p.action).filter(Boolean), ['double'])
})

test('unknown devices and the coordinator are ignored', async () => {
  const payloads = []
  const decode = createDecoder(zhc, (d, p) => payloads.push(p))
  await decode({ device: { ...button, type: 'Coordinator' }, cluster: 'genOnOff', type: 'attributeReport', data: { onOff: 1 } })
  await decode({ device: { ...button, modelID: 'no.such.model', manufacturerName: 'nobody' }, endpoint: { ID: 1 }, cluster: 'genOnOff', type: 'attributeReport', data: { onOff: 1 } })
  assert.deepEqual(payloads, [])
})
