const axios = require('axios');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const MAX_PAGES = 50; // Safety limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch members from ABC Financial for a given club, paginating through all pages.
 *
 * @param {string} clubNumber
 * @param {object} [opts]
 * @param {'active'|'inactive'} [opts.activeStatus='active'] — pull active or inactive members
 * @param {string} [opts.lastModifiedSince] — ISO date; only fetch members modified on/after this date.
 *   Use this with activeStatus:'inactive' to avoid re-pulling tens of thousands of historical cancels every cycle.
 */
async function fetchAllABCMembers(clubNumber, opts = {}) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }

  const activeStatus = opts.activeStatus || 'active';
  const lastModifiedSince = opts.lastModifiedSince || null;

  const allMembers = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const url = `${ABC_BASE_URL}/${clubNumber}/members`;
    console.log(`[ABC] Fetching page ${page} for club ${clubNumber} (activeStatus=${activeStatus}${lastModifiedSince ? `, lastModifiedSince=${lastModifiedSince}` : ''})...`);

    const params = { joinStatus: 'member', activeStatus, page };
    if (lastModifiedSince) {
      params.lastModifiedTimestampRange = `${lastModifiedSince},`;
    }

    const res = await axios.get(url, {
      params,
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
    const parsed = parseInt(nextPage);
    if (isNaN(parsed)) {
      console.warn(`[ABC] nextPage value "${nextPage}" is not a number — stopping`);
      break;
    }
    page = parsed;

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
    sales_person_id: a.salesPersonId || null,
    sales_person_name: a.salesPersonName || null,
    sales_person_home_club: a.salesPersonHomeClub || null,
    agreement_entry_source: a.agreementEntrySourceReportName || null,
    last_sync_at: new Date().toISOString(),
  };
}

module.exports = { fetchAllABCMembers, transformABCMember };
