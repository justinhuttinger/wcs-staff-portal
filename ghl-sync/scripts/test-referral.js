// ghl-sync/scripts/test-referral.js
/**
 * Manual test harness for the referral rewards flow. NOT used in production.
 *
 * Run from ghl-sync/ with .env loaded:
 *   node scripts/test-referral.js inspect <clubNumber> <abcMemberId>
 *   node scripts/test-referral.js zero    <clubNumber> <abcMemberId>
 *   node scripts/test-referral.js restore <clubNumber> <abcMemberId> <dueDate> <amount>
 *   node scripts/test-referral.js tag     <clubNumber> <ghlContactId> <friendFirstName>
 */
require('dotenv').config();
const LOCATIONS = require('../src/config/locations');
const referral = require('../src/config/referral');
const { fetchMemberInvoices, adjustInvoice } = require('../src/abc/client');
const { pickNextDuesInvoice, buildAdjustmentBody } = require('../src/abc/referralRewards');
const { get, put } = require('../src/ghl/client');
const supabase = require('../src/db/supabase');

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

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const club = args[0];
  try {
    if (cmd === 'inspect') await inspect(club, args[1]);
    else if (cmd === 'zero') await zero(club, args[1]);
    else if (cmd === 'restore') await restore(club, args[1], args[2], args[3]);
    else if (cmd === 'tag') await tag(club, args[1], args[2]);
    else {
      console.log('Usage:');
      console.log('  node scripts/test-referral.js inspect <club> <abcMemberId>');
      console.log('  node scripts/test-referral.js zero    <club> <abcMemberId>');
      console.log('  node scripts/test-referral.js restore <club> <abcMemberId> <dueDate> <amount>');
      console.log('  node scripts/test-referral.js tag     <club> <ghlContactId> <friendFirstName>');
      process.exit(1);
    }
  } catch (err) {
    console.error('ERROR:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
