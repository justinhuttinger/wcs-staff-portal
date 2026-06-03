const { get } = require('./client');
const { pickFirstHumanContact } = require('./firstContactPick');

// Find the first human outbound contact (manual SMS/call) for one contact.
// Returns { at, kind } or null. Throws on hard API errors (caller catches).
async function fetchFirstHumanContact(locationId, apiKey, contactId) {
  const search = await get('/conversations/search', { locationId, contactId, limit: 20 }, apiKey);
  const convos = search?.conversations || [];
  let messages = [];
  for (const c of convos) {
    const mres = await get(`/conversations/${c.id}/messages`, {}, apiKey);
    const msgs = mres?.messages?.messages || mres?.messages || [];
    messages = messages.concat(msgs);
  }
  return pickFirstHumanContact(messages);
}

module.exports = { fetchFirstHumanContact, pickFirstHumanContact };
