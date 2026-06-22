const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings'
const MODEL = 'voyage-multimodal-3.5'

// items: [{ text?, imageDataUrl? }]. Each becomes one input with one content part.
function buildMultimodalBody(items, inputType) {
  return {
    model: MODEL,
    input_type: inputType,
    inputs: items.map((it) => {
      const content = []
      if (it.imageDataUrl) content.push({ type: 'image_base64', image_base64: it.imageDataUrl })
      if (it.text) content.push({ type: 'text', text: it.text })
      return { content }
    }),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Max retries on a rate-limit (429) or transient 5xx before giving up.
const MAX_RETRIES = Number(process.env.VOYAGE_MAX_RETRIES || 6)

async function embedMultimodal(items, inputType) {
  const key = process.env.VOYAGE_API_KEY
  if (!key) throw new Error('VOYAGE_API_KEY not set')
  if (!items.length) return []
  const body = JSON.stringify(buildMultimodalBody(items, inputType))

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body,
    })
    if (res.ok) {
      const data = await res.json()
      // Response: { data: [{ embedding: number[] }, ...] } preserving input order.
      return data.data.map((d) => d.embedding)
    }

    const text = await res.text().catch(() => '')
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error('Voyage error ' + res.status + ': ' + text)
    }
    // Honor Retry-After when present, else exponential backoff (cap 60s).
    const retryAfter = Number(res.headers.get('retry-after'))
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 1000 * 2 ** attempt)
    console.warn(`[Voyage] ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`)
    await sleep(waitMs)
  }
}

module.exports = { buildMultimodalBody, embedMultimodal, MODEL }
