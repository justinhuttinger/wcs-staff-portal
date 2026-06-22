// auth/src/services/voyageQuery.js
const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings'

async function embedQuery(text) {
  const key = process.env.VOYAGE_API_KEY
  if (!key) throw new Error('VOYAGE_API_KEY not set')
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'voyage-multimodal-3.5',
      input_type: 'query',
      inputs: [{ content: [{ type: 'text', text }] }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Voyage query error ' + res.status + ': ' + JSON.stringify(data))
  return data.data[0].embedding
}

module.exports = { embedQuery }
