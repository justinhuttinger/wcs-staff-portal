const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ghlFetch(path, apiKey, options = {}) {
  const { method = 'GET', params, body, version = '2021-07-28' } = options

  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += '?' + qs
  }

  const fetchOptions = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': version,
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

      // GHL returns 401 for a gateway TIMEOUT, not just for bad credentials:
      //     401 {"statusCode":401,"message":"Command timed out"}
      // Taken at face value that looks like a revoked key and sends you hunting
      // for one. It is transient, and it hit a different club on nearly every
      // Day One reconcile pass. Retry ONLY on that exact message, so a genuine
      // auth failure still fails fast instead of being retried three times.
      if (res.status === 401 && /command timed out/i.test(text) && attempt < 3) {
        console.warn(`[GHL] Timeout reported as 401 on ${path}, retrying in 2s (attempt ${attempt}/3)`)
        await sleep(2000)
        continue
      }

      throw new Error(`GHL API error ${res.status}: ${text}`)
    }

    return res.json()
  }
}

module.exports = { ghlFetch, sleep }
