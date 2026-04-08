const axios = require('axios');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function get(path, params = {}, apiKey) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < 3) {
        console.warn(`[GHL] Rate limited on ${path}, retrying in 5s (attempt ${attempt}/3)`);
        await sleep(5000);
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
 * @param {number} options.maxRecords - Safety cap (default: 50000)
 * @param {string} apiKey - Per-location API key
 */
async function getPaginated(path, baseParams, itemsKey, options = {}, apiKey) {
  const {
    paginationType = 'meta',
    maxRecords = 50000,
  } = options;

  const allItems = [];
  let metaCursor = null; // { startAfter, startAfterId } from response meta
  let offset = 0;
  let pageNum = 0;
  const limit = baseParams.limit || 100;
  const locationId = baseParams.locationId || baseParams.location_id || 'unknown';

  while (true) {
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

    if (items.length < limit || allItems.length >= maxRecords) {
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

    await sleep(650); // Rate limit: ~100 req/min
  }

  return allItems;
}

module.exports = { get, getPaginated, sleep };
