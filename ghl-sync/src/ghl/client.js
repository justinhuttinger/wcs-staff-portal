const axios = require('axios');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 5;
const BACKOFF = [5000, 10000, 20000, 30000, 60000]; // exponential-ish backoff

async function get(path, params = {}, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = BACKOFF[attempt - 1] || 60000;
        console.warn(`[GHL] Rate limited on ${path}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

async function post(path, body = {}, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.post(`${BASE_URL}${path}`, body, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = BACKOFF[attempt - 1] || 60000;
        console.warn(`[GHL] Rate limited on POST ${path}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Paginate through a GHL endpoint.
 * @param {string} path - API path
 * @param {object} baseParams - Base query params (e.g., locationId, limit)
 * @param {string} itemsKey - Key in response containing the array (e.g., 'contacts')
 * @param {object} options
 * @param {'meta'|'offset'} options.paginationType
 *   - 'meta': uses response.meta.startAfter + meta.startAfterId (contacts)
 *   - 'offset': uses numeric startAfter offset (opportunities)
 * @param {string} apiKey - Per-location API key
 */
async function getPaginated(path, baseParams, itemsKey, options = {}, apiKey) {
  const {
    paginationType = 'meta',
  } = options;

  const allItems = [];
  let metaCursor = null; // { startAfter, startAfterId } from response meta
  let offset = 0;
  let pageNum = 0;
  const limit = baseParams.limit || 100;
  const locationId = baseParams.locationId || baseParams.location_id || 'unknown';
  const MAX_PAGES = 2000; // Safety limit: 2000 pages × 100 = 200K records max

  while (true) {
    if (pageNum >= MAX_PAGES) {
      console.warn(`[GHL] Hit max page limit (${MAX_PAGES}) for ${itemsKey} @ ${locationId}. Stopping pagination.`);
      break;
    }
    const params = { ...baseParams };

    if (paginationType === 'meta' && metaCursor) {
      params.startAfter = metaCursor.startAfter;
      params.startAfterId = metaCursor.startAfterId;
    } else if (paginationType === 'offset' && offset > 0) {
      params.startAfter = offset;
    }

    const data = await get(path, params, apiKey);
    const items = data[itemsKey] || [];
    pageNum++;

    console.log(`[GHL] Fetched page ${pageNum} for ${itemsKey} @ ${locationId}: ${items.length} records`);

    allItems.push(...items);

    if (items.length < limit) {
      break;
    }

    if (paginationType === 'meta') {
      // GHL contacts: meta contains startAfter (timestamp) + startAfterId (contact ID)
      if (!data.meta?.startAfter || !data.meta?.startAfterId) break;
      metaCursor = {
        startAfter: data.meta.startAfter,
        startAfterId: data.meta.startAfterId,
      };
    } else {
      offset += limit;
    }

    await sleep(300); // Rate limit for reads: ~200 req/min (writes use 650ms separately)
  }

  return allItems;
}

async function put(path, body = {}, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.put(`${BASE_URL}${path}`, body, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = BACKOFF[attempt - 1] || 60000;
        console.warn(`[GHL] Rate limited on PUT ${path}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

module.exports = { get, post, put, getPaginated, sleep };
