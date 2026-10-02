// Turns raw Zigbee messages into payloads like { action: 'single' } or
// { battery: 92 }, the way Zigbee2MQTT does: find the device's definition in
// zigbee-herdsman-converters and run every fromZigbee converter that matches
// the message's cluster and type.
//
// zhc: the zigbee-herdsman-converters module. onPayload(device, payload, data)
// is called for each decoded payload (converters may also publish later).
function createDecoder(zhc, onPayload) {
  const states = new Map() // ieee -> state object the converters keep

  return async function decode(data) {
    const device = data.device
    if (!device || device.type === 'Coordinator') return
    const definition = await zhc.findByDevice(device)
    if (!definition) return
    let state = states.get(device.ieeeAddr)
    if (!state) states.set(device.ieeeAddr, state = {})
    const publish = (payload) => {
      Object.assign(state, payload)
      onPayload(device, payload, data)
    }
    const meta = { state, device, deviceExposesChanged: () => {} }
    for (const converter of definition.fromZigbee) {
      if (converter.cluster !== data.cluster) continue
      const types = Array.isArray(converter.type) ? converter.type : [converter.type]
      if (!types.includes(data.type)) continue
      const payload = await converter.convert(definition, data, publish, {}, meta)
      if (payload) {
        zhc.postProcessConvertedFromZigbeeMessage(definition, payload, {}, device)
        publish(payload)
      }
    }
  }
}

module.exports = { createDecoder }
