const axios = require('axios');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const MAX_PAGES = 50; // Safety limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all members from ABC Financial for a given club.
 * Paginates through all pages (5000 members per page).
 */
async function fetchAllABCMembers(clubNumber) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }

  const allMembers = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const url = `${ABC_BASE_URL}/${clubNumber}/members`;
    console.log(`[ABC] Fetching page ${page} for club ${clubNumber}...`);

    const res = await axios.get(url, {
      params: { joinStatus: 'member', page },
      headers: {
        'app_id': ABC_APP_ID,
        'app_key': ABC_APP_KEY,
        'Accept': 'application/json',
      },
      timeout: 60000,
    });

    const data = res.data;
    const members = data.members || [];

    if (!Array.isArray(members) || members.length === 0) {
      console.log(`[ABC] Page ${page}: 0 members — done`);
      break;
    }

    allMembers.push(...members);
    console.log(`[ABC] Page ${page}: ${members.length} members (total: ${allMembers.length})`);

    const nextPage = data.status?.nextPage;
    if (!nextPage || nextPage === '' || nextPage === String(page)) {
      break;
    }
    page = parseInt(nextPage);

    await sleep(500); // Be polite to ABC API
  }

  if (page > MAX_PAGES) {
    console.warn(`[ABC] Hit max page limit (${MAX_PAGES}) for club ${clubNumber}`);
  }

  return allMembers;
}

/**
 * Transform a raw ABC member into a flat object for Supabase upsert.
 * All ABC API values come as strings — cast booleans and numbers here.
 */
function transformABCMember(raw, clubNumber) {
  const p = raw.personal || {};
  const a = raw.agreement || {};

  return {
    member_id: raw.memberId,
    club_number: clubNumber,
    first_name: p.firstName || null,
    last_name: p.lastName || null,
    email: p.email || null,
    primary_phone: p.primaryPhone || null,
    mobile_phone: p.mobilePhone || null,
    barcode: p.barcode || null,
    birth_date: p.birthDate || null,
    gender: p.gender || null,
    is_active: p.isActive === 'true' || p.isActive === true,
    member_status: p.memberStatus || null,
    join_status: p.joinStatus || null,
    member_status_date: p.memberStatusDate || null,
    home_club: p.homeClub || null,
    total_check_in_count: p.totalCheckInCount ? parseInt(p.totalCheckInCount) : 0,
    first_check_in_timestamp: p.firstCheckInTimestamp || null,
    last_check_in_timestamp: p.lastCheckInTimestamp || null,
    create_timestamp: p.createTimestamp || null,
    last_modified_timestamp: p.lastModifiedTimestamp || null,
    agreement_number: a.agreementNumber || null,
    membership_type: a.membershipType || null,
    membership_type_abc_code: a.membershipTypeAbcCode || null,
    payment_plan: a.paymentPlan || null,
    payment_frequency: a.paymentFrequency || null,
    is_past_due: a.isPastDue === 'true' || a.isPastDue === true,
    down_payment: a.downPayment ? parseFloat(a.downPayment) : null,
    next_due_amount: a.nextDueAmount ? parseFloat(a.nextDueAmount) : null,
    projected_due_amount: a.projectedDueAmount ? parseFloat(a.projectedDueAmount) : null,
    past_due_balance: a.pastDueBalance ? parseFloat(a.pastDueBalance) : null,
    total_past_due_balance: a.totalPastDueBalance ? parseFloat(a.totalPastDueBalance) : null,
    late_fee_amount: a.lateFeeAmount ? parseFloat(a.lateFeeAmount) : null,
    since_date: a.sinceDate || null,
    begin_date: a.beginDate || null,
    expiration_date: a.expirationDate || null,
    next_billing_date: a.nextBillingDate || null,
    renewal_date: a.renewalDate || null,
    sign_date: a.signDate || null,
    last_sync_at: new Date().toISOString(),
  };
}

module.exports = { fetchAllABCMembers, transformABCMember };
