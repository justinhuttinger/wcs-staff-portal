/**
 * Pure builder for the POST /contacts/search request body used by the
 * attribution enrichment pass. Kept env-free so it can be unit tested
 * without pulling in the supabase client.
 */

const PAGE_LIMIT = parseInt(process.env.CONTACTS_PAGE_SIZE) || 100;

function buildSearchBody({ locationId, searchAfter, sinceIso }) {
  const body = {
    locationId,
    pageLimit: PAGE_LIMIT,
    sort: [{ field: 'dateAdded', direction: 'desc' }],
  };
  if (searchAfter) body.searchAfter = searchAfter;
  if (sinceIso) {
    body.filters = [{ field: 'dateAdded', operator: 'range', value: { gte: sinceIso } }];
  }
  return body;
}

module.exports = { buildSearchBody };
