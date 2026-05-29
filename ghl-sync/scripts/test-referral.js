// ghl-sync/scripts/test-referral.js
/**
 * Manual test harness for the referral rewards flow. NOT used in production.
 *
 * Run from ghl-sync/ with .env loaded:
 *   node scripts/test-referral.js inspect <clubNumber> <abcMemberId>
 *   node scripts/test-referral.js zero    <clubNumber> <abcMemberId>
 *   node scripts/test-referral.js restore <clubNumber> <abcMemberId> <dueDate> <amount>
 *   node scripts/test-referral.js tag     <clubNumber> <ghlContactId> <friendFirstName>
 *   node scripts/test-referral.js cycle   <clubNumber> <newMemberGhlContactId>
 */
require('dotenv').config();
const crypto = require('crypto');
const LOCATIONS = require('../src/config/locations');
const referral = require('../src/config/referral');
const { fetchMemberInvoices, adjustInvoice } = require('../src/abc/client');
const { pickNextDuesInvoice, buildAdjustmentBody, processReferralReward } = require('../src/abc/referralRewards');
const { get, put } = require('../src/ghl/client');
const supabase = require('../src/db/supabase');

// Resolve a GHL custom-field id by field_key for a location.
async function fieldIdFor(loc, fieldKey) {
  const { data } = await supabase
    .from('ghl_custom_field_defs')
    .select('id, field_key')
    .eq('location_id', loc.id)
    .eq('field_key', fieldKey)
    .limit(1);
  return data?.[0]?.id || null;
}

function locForClub(clubNumber) {
  const loc = LOCATIONS.find((l) => l.clubNumber === String(clubNumber));
  if (!loc) throw new Error(`No configured location for club ${clubNumber}`);
  return loc;
}

async function inspect(club, memberId) {
  const invoices = await fetchMemberInvoices(club, memberId);
  console.log(`Invoices for member ${memberId} @ club ${club}:`);
  for (const i of invoices) {
    console.log(`  ${i.dueDate}  ${String(i.profitCenterAbcCode).padEnd(10)}  amount=${i.invoiceAmount}  due=${i.amountDue}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const next = pickNextDuesInvoice(invoices, today);
  console.log(next
    ? `\nNext DUES invoice that WOULD be zeroed: ${next.dueDate} (currently ${next.invoiceAmount})`
    : `\nNo upcoming DUES invoice — would flag for manual review.`);
}

async function zero(club, memberId) {
  const invoices = await fetchMemberInvoices(club, memberId);
  const today = new Date().toISOString().slice(0, 10);
  const next = pickNextDuesInvoice(invoices, today);
  if (!next) { console.log('No upcoming DUES invoice — nothing to zero.'); return; }
  console.log(`Zeroing DUES invoice ${next.dueDate} (was ${next.invoiceAmount})...`);
  const res = await adjustInvoice(club, memberId, buildAdjustmentBody(next.dueDate));
  console.log(`Result ok=${res.ok} status=${res.status} body=${JSON.stringify(res.data)}`);
}

async function restore(club, memberId, dueDate, amount) {
  const body = {
    startDate: dueDate,
    profitCenterAbcCode: referral.DUES_PROFIT_CENTER,
    invoiceAmount: String(amount),
    numberOfInvoices: '1',
  };
  console.log(`Restoring invoice ${dueDate} to ${amount}...`);
  const res = await adjustInvoice(club, memberId, body);
  console.log(`Result ok=${res.ok} status=${res.status} body=${JSON.stringify(res.data)}`);
}

async function tag(club, contactId, friendName) {
  const loc = locForClub(club);
  const { data: defs } = await supabase
    .from('ghl_custom_field_defs')
    .select('id, field_key')
    .eq('location_id', loc.id)
    .eq('field_key', referral.FRIEND_NAME_FIELD_KEY)
    .limit(1);
  const friendFieldId = defs?.[0]?.id || null;

  const current = await get(`/contacts/${contactId}`, {}, loc.apiKey);
  const existingTags = current?.contact?.tags || [];
  const tags = existingTags.includes(referral.REWARD_TAG) ? existingTags : [...existingTags, referral.REWARD_TAG];
  const body = { tags };
  if (friendFieldId) body.customFields = [{ id: friendFieldId, value: friendName }];
  else console.warn(`(no ${referral.FRIEND_NAME_FIELD_KEY} field def for ${loc.name} — tagging without friend name)`);

  await put(`/contacts/${contactId}`, body, loc.apiKey);
  console.log(`Tagged contact ${contactId} with "${referral.REWARD_TAG}"${friendFieldId ? ` and friend name "${friendName}"` : ''}.`);
}

// Read a value off a live GHL contact's customFields array by field id.
function cfValue(contact, fieldId) {
  const arr = contact?.customFields || [];
  const hit = arr.find((f) => f.id === fieldId);
  return hit ? hit.value : null;
}

// Run the EXACT production path (processReferralReward) for one referred member,
// on demand. Real writes: zeroes the referrer's dues, tags the referrer, and
// records a referral_rewards row (so it shows in the admin portal).
async function cycle(club, newMemberContactId) {
  const loc = locForClub(club);
  const referredByFieldId = await fieldIdFor(loc, referral.REFERRED_BY_FIELD_KEY);
  const friendNameFieldId = await fieldIdFor(loc, referral.FRIEND_NAME_FIELD_KEY);
  const abcMemberIdFieldId = await fieldIdFor(loc, 'contact.abc_member_id');
  if (!referredByFieldId) throw new Error(`${referral.REFERRED_BY_FIELD_KEY} field def not found for ${loc.name}`);

  // 1. Load the referred new-member contact from GHL.
  const res = await get(`/contacts/${newMemberContactId}`, {}, loc.apiKey);
  const newContact = res?.contact;
  if (!newContact) throw new Error(`GHL contact ${newMemberContactId} not found`);

  const referrerAbcId = (cfValue(newContact, referredByFieldId) || '').trim();
  if (!referrerAbcId) throw new Error(`Contact ${newMemberContactId} has no ${referral.REFERRED_BY_FIELD_KEY} value`);
  const newMemberAbcId = (abcMemberIdFieldId && cfValue(newContact, abcMemberIdFieldId)) || newMemberContactId;
  const friendFirst = newContact.firstName || newContact.first_name || '';

  console.log(`New member: ${friendFirst} (${newMemberContactId}) referred by ABC #${referrerAbcId}`);

  // 2. Resolve the referrer's GHL contact from the ghl_contacts_v2 cache,
  //    exactly like reconcile's byMemberId index.
  let referrerContact = null;
  if (abcMemberIdFieldId) {
    const { data: matches } = await supabase
      .from('ghl_contacts_v2')
      .select('id')
      .eq('location_id', loc.id)
      .eq(`custom_fields->>${abcMemberIdFieldId}`, referrerAbcId)
      .limit(1);
    if (matches?.[0]) referrerContact = { id: matches[0].id };
  }
  console.log(`Referrer GHL contact: ${referrerContact?.id || '(none found — will flag no_referrer_contact)'}`);

  // 3. Closures matching reconcile's prod wiring.
  const tagReferrer = async (contactId, friendName) => {
    const current = await get(`/contacts/${contactId}`, {}, loc.apiKey);
    const existingTags = current?.contact?.tags || [];
    const tags = existingTags.includes(referral.REWARD_TAG) ? existingTags : [...existingTags, referral.REWARD_TAG];
    const updateBody = { tags };
    if (friendNameFieldId) updateBody.customFields = [{ id: friendNameFieldId, value: friendName }];
    await put(`/contacts/${contactId}`, updateBody, loc.apiKey);
  };
  const recordReward = async (row) => {
    const { error } = await supabase.from('referral_rewards').upsert(row, { onConflict: 'new_member_id' });
    if (error) console.error(`[cycle] recordReward failed: ${error.message}`);
  };

  // 4. Run the real production orchestrator.
  const row = await processReferralReward({
    location: { clubNumber: club, id: loc.id, name: loc.name },
    runId: crypto.randomUUID(),
    abcMember: { member_id: newMemberAbcId, first_name: friendFirst, last_name: newContact.lastName || '', is_active: true },
    referrerAbcId,
    referrerContact,
    dryRun: false,
    today: new Date().toISOString().slice(0, 10),
    fetchMemberInvoices,
    adjustInvoice,
    tagReferrer,
    recordReward,
  });

  console.log('\n=== Result (written to referral_rewards) ===');
  console.log(JSON.stringify(row, null, 2));
  if (row.dues_status === 'zeroed') {
    console.log(`\nNOTE: referrer ABC #${referrerAbcId} invoice ${row.dues_invoice_due_date} was zeroed. Restore with:`);
    console.log(`  node scripts/test-referral.js restore ${club} ${referrerAbcId} ${row.dues_invoice_due_date} <originalAmount>`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const club = args[0];
  try {
    if (cmd === 'inspect') await inspect(club, args[1]);
    else if (cmd === 'zero') await zero(club, args[1]);
    else if (cmd === 'restore') await restore(club, args[1], args[2], args[3]);
    else if (cmd === 'tag') await tag(club, args[1], args[2]);
    else if (cmd === 'cycle') await cycle(club, args[1]);
    else {
      console.log('Usage:');
      console.log('  node scripts/test-referral.js inspect <club> <abcMemberId>');
      console.log('  node scripts/test-referral.js zero    <club> <abcMemberId>');
      console.log('  node scripts/test-referral.js restore <club> <abcMemberId> <dueDate> <amount>');
      console.log('  node scripts/test-referral.js tag     <club> <ghlContactId> <friendFirstName>');
      console.log('  node scripts/test-referral.js cycle   <club> <newMemberGhlContactId>');
      process.exit(1);
    }
  } catch (err) {
    console.error('ERROR:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
