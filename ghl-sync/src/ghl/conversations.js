const { get } = require('./client');
const { pickFirstHumanContact } = require('./firstContactPick');

const MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGES = 15; // up to ~1500 messages/convo — plenty to reach the oldest

// Fetch ALL messages for one conversation. GHL returns messages newest-first in
// pages of ~20 and paginates older ones via `lastMessageId`. The first manual
// contact is the OLDEST qualifying message, so we must walk back to the start —
// fetching only the default page made an active lead's true first text/call
// (older than the page) invisible, inflating its Speed to Lead.
async function fetchAllMessages(convoId, apiKey) {
  const all = [];
  let lastMessageId = null;
  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const params = { limit: MESSAGE_PAGE_SIZE };
    if (lastMessageId) params.lastMessageId = lastMessageId;
    const mres = await get(`/conversations/${convoId}/messages`, params, apiKey);
    const wrap = mres?.messages || {};
    const msgs = Array.isArray(wrap.messages) ? wrap.messages
      : (Array.isArray(mres?.messages) ? mres.messages : []);
    if (!msgs.length) break;
    all.push(...msgs);
    const nextPage = wrap.nextPage;
    // Older page = messages before the oldest id we've seen on this page.
    lastMessageId = wrap.lastMessageId || msgs[msgs.length - 1]?.id;
    if (!nextPage || !lastMessageId) break;
  }
  return all;
}

// Find the first human outbound contact (manual SMS/call) for one contact.
// Returns { at, kind } or null. Throws on hard API errors (caller catches).
async function fetchFirstHumanContact(locationId, apiKey, contactId) {
  const search = await get('/conversations/search', { locationId, contactId, limit: 20 }, apiKey);
  const convos = search?.conversations || [];
  let messages = [];
  for (const c of convos) {
    messages = messages.concat(await fetchAllMessages(c.id, apiKey));
  }
  return pickFirstHumanContact(messages);
}

// One page of a location's conversations, newest activity first.
//
// Pagination here is NOT the contacts/opportunities dual cursor, and it is not
// offset-based. Verified live 2026-08-19 against Salem: `startAfterId`, `page`,
// `skip`, and `offset` are all silently ignored and return page 1 again. The
// only cursor that works is `startAfterDate` — the epoch-ms `lastMessageDate`
// of the last row on the previous page. A four-page walk with it returned 80
// unique conversations, zero duplicates, strictly decreasing dates.
//
// NOTE: `lastMessageDate` is epoch MILLISECONDS (a number), not an ISO string.
async function searchConversations(locationId, apiKey, { limit = 100, startAfterDate = null } = {}) {
  const params = { locationId, limit, sortBy: 'last_message_date', sort: 'desc' };
  if (startAfterDate) params.startAfterDate = startAfterDate;
  const res = await get('/conversations/search', params, apiKey);
  return res?.conversations || [];
}

module.exports = { fetchFirstHumanContact, pickFirstHumanContact, fetchAllMessages, searchConversations };
