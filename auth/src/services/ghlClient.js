const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ghlFetch(path, apiKey, options = {}) {
  const { method = 'GET', params, body } = options

  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += '?' + qs
  }

  const fetchOptions = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
  }
  if (body) fetchOptions.body = JSON.stringify(body)

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, fetchOptions)

    if (res.status === 429 && attempt < 3) {
      console.warn(`[GHL] Rate limited on ${path}, retrying in 5s (attempt ${attempt}/3)`)
      await sleep(5000)
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`GHL API error ${res.status}: ${text}`)
    }

    return res.json()
  }
}

module.exports = { ghlFetch, sleep }
