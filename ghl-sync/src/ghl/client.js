const axios = require('axios');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const API_KEY = process.env.GHL_API_KEY;

const ghlClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  },
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function get(path, params = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ghlClient.get(path, { params });
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
 * @param {'cursor'|'offset'} options.paginationType - 'cursor' uses last item ID, 'offset' uses numeric offset
 * @param {string} options.cursorParam - Query param name for pagination (default: 'startAfter')
 * @param {number} options.maxRecords - Safety cap (default: 50000)
 */
async function getPaginated(path, baseParams, itemsKey, options = {}) {
  const {
    paginationType = 'cursor',
    cursorParam = 'startAfter',
    maxRecords = 50000,
  } = options;

  const allItems = [];
  let cursor = null;
  let offset = 0;
  let pageNum = 0;
  const limit = baseParams.limit || 100;
  const locationId = baseParams.locationId || baseParams.location_id || 'unknown';

  while (true) {
    const params = { ...baseParams };

    if (paginationType === 'cursor' && cursor) {
      params[cursorParam] = cursor;
    } else if (paginationType === 'offset' && offset > 0) {
      params[cursorParam] = offset;
    }

    const data = await get(path, params);
    const items = data[itemsKey] || [];
    pageNum++;

    console.log(`[GHL] Fetched page ${pageNum} for ${itemsKey} @ ${locationId}: ${items.length} records`);

    allItems.push(...items);

    if (items.length < limit || allItems.length >= maxRecords) {
      break;
    }

    if (paginationType === 'cursor') {
      cursor = items[items.length - 1]?.id;
      if (!cursor) break;
    } else {
      offset += limit;
    }

    await sleep(650); // Rate limit: ~100 req/min
  }

  return allItems;
}

module.exports = { get, getPaginated, sleep };
