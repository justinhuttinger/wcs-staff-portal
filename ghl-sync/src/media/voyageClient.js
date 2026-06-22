const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings'
const MODEL = 'voyage-multimodal-3.5'

// items: [{ text?, imageDataUrl? }]. Each becomes one input with one content part.
function buildMultimodalBody(items, inputType) {
  return {
    model: MODEL,
    input_type: inputType,
    inputs: items.map((it) => {
      const content = []
      if (it.imageDataUrl) content.push({ type: 'image_url', image_url: it.imageDataUrl })
      if (it.text) content.push({ type: 'text', text: it.text })
      return { content }
    }),
  }
}

async function embedMultimodal(items, inputType) {
  const key = process.env.VOYAGE_API_KEY
  if (!key) throw new Error('VOYAGE_API_KEY not set')
  if (!items.length) return []
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(buildMultimodalBody(items, inputType)),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Voyage error ' + res.status + ': ' + JSON.stringify(data))
  // Response: { data: [{ embedding: number[] }, ...] } preserving input order.
  return data.data.map((d) => d.embedding)
}

module.exports = { buildMultimodalBody, embedMultimodal, MODEL }
