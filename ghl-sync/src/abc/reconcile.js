const supabase = require('../db/supabase');
const { get, post, put, sleep } = require('../ghl/client');
const { ABC_GHL_FIELD_MAP, ABC_TAGS } = require('../config/abc-field-map');
const { getSkipList } = require('../config/membership-skip-list');
const referral = require('../config/referral');
const { isEligibleCandidate, processReferralReward } = require('./referralRewards');
const { fetchMemberInvoices, adjustInvoice } = require('./client');

const DRY_RUN = (process.env.DRY_RUN || 'true') === 'true';

// Sanity floor: if the cached GHL contact list for a location holds fewer rows
// than this, the create branch is disabled for the run. Prevents mass-duplicate
// creates when ghl_contacts_v2 is stale/empty (root cause of the 2026-05-17/18
// duplicate storm — see abc_sync_run_log runs 473aac20 and a3de6687 which were
// 100% no_match).
const MIN_CACHED_CONTACTS_FOR_CREATES = parseInt(
  process.env.ABC_RECONCILE_MIN_CONTACTS || '500',
  10,
);

async function ghlContactExists(locationId, email, phone, apiKey) {
  const trimmedEmail = (email || '').trim();
  const trimmedPhone = (phone || '').trim();
  if (!trimmedEmail && !trimmedPhone) return null;
  try {
    const body = { locationId };
    if (trimmedEmail) body.email = trimmedEmail;
    if (trimmedPhone) body.phone = trimmedPhone;
    const res = await post('/contacts/search/duplicate', body, apiKey);
    return res?.contact || null;
  } catch (err) {
    // 404 = no duplicate (treat as null). Anything else: log and let caller
    // fall through to the create attempt, which will surface the real error.
    if (err.response?.status === 404) return null;
    console.warn(`[Reconcile] duplicate-check failed for ${trimmedEmail || trimmedPhone}: ${err.response?.data?.message || err.message}`);
    return null;
  }
}

/**
 * Detect GHL "contact deleted" responses. The Supabase cache (ghl_contacts_v2)
 * is eventually consistent, so a contact deleted in GHL can linger in the cache.
 * Every reconcile cycle then tries to update/tag that ghost id, GHL 404s, and it
 * gets counted as a sync error — which fires an SMS alert every 30 minutes. These
 * are not actionable failures, so we treat them separately and self-heal the cache.
 */
function isContactDeleted(err) {
  if (err?.response?.status === 404) return true;
  const detail = err?.response?.data?.message || err?.response?.data || err?.message || '';
  const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return /contact not found/i.test(msg);
}

/**
 * Reconcile ABC members against GHL contacts for one location.
 * Matches by: abc_member_id → email → phone → name (flagged for review).
 * Applies tags + custom field updates to matched GHL contacts.
 */
async function reconcileLocation(location, runId) {
  const { id: locationId, name: locationName, clubNumber, apiKey } = location;
  console.log(`[Reconcile] ${locationName}: starting (dry_run=${DRY_RUN})`);

  const skipMembershipTypes = await getSkipList();

  // 1. Load active ABC members + recently cancelled (last 24h) for this club
  // Paginate to avoid Supabase 1000 row default limit
  const activeMembers = [];
  let aFrom = 0;
  while (true) {
    const { data: aPage, error: aErr } = await supabase
      .from('abc_members')
      .select('*')
      .eq('club_number', clubNumber)
      .eq('is_active', true)
      .range(aFrom, aFrom + 999);

    if (aErr) throw new Error(`Failed to load active ABC members: ${aErr.message}`);
    if (!aPage || aPage.length === 0) break;
    activeMembers.push(...aPage);
    if (aPage.length < 1000) break;
    aFrom += 1000;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recentInactive = [];
  let iFrom = 0;
  while (true) {
    const { data: iPage, error: iErr } = await supabase
      .from('abc_members')
      .select('*')
      .eq('club_number', clubNumber)
      .eq('is_active', false)
      .gte('member_status_date', oneDayAgo)
      .range(iFrom, iFrom + 999);

    if (iErr) throw new Error(`Failed to load recent inactive ABC members: ${iErr.message}`);
    if (!iPage || iPage.length === 0) break;
    recentInactive.push(...iPage);
    if (iPage.length < 1000) break;
    iFrom += 1000;
  }

  const abcMembers = [...activeMembers, ...recentInactive];
  console.log(`[Reconcile] ${locationName}: ${activeMembers.length} active + ${recentInactive.length} recently inactive = ${abcMembers.length} to reconcile`);

  // 2. Load ALL GHL contacts for this location from Supabase (paginate past 1000 limit)
  const locContacts = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from('ghl_contacts_v2')
      .select('id, email, phone, first_name, last_name, tags, custom_fields')
      .eq('location_id', locationId)
      .range(from, from + PAGE_SIZE - 1);

    if (pageErr) throw new Error(`Failed to load location contacts: ${pageErr.message}`);
    if (!page || page.length === 0) break;
    locContacts.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  console.log(`[Reconcile] ${locationName}: ${locContacts.length} GHL contacts`);

  // Safety bail: when the cached contact list is suspiciously small, refuse to
  // create new contacts this run. The match indexes built below would be empty
  // or near-empty, causing the create branch to fire for hundreds of real GHL
  // contacts that simply weren't in the cache yet.
  const createsDisabled = locContacts.length < MIN_CACHED_CONTACTS_FOR_CREATES;
  if (createsDisabled) {
    console.warn(`[Reconcile] ${locationName}: only ${locContacts.length} cached contacts (< ${MIN_CACHED_CONTACTS_FOR_CREATES}) — creates DISABLED for this run`);
  }

  // 3. Build lookup indexes for GHL contacts
  const byMemberId = new Map();  // abc_member_id custom field → contact
  const byEmail = new Map();     // lowercase email → contact
  const byPhone = new Map();     // digits-only phone → contact
  const byName = new Map();      // "first last" lowercase → contact[]

  for (const c of locContacts) {
    if (c.email) {
      byEmail.set(c.email.toLowerCase().trim(), c);
    }
    if (c.phone) {
      const digits = c.phone.replace(/[^\d]/g, '');
      if (digits.length >= 10) {
        byPhone.set(digits.slice(-10), c); // Last 10 digits
      }
    }
    const name = `${(c.first_name || '').toLowerCase().trim()} ${(c.last_name || '').toLowerCase().trim()}`.trim();
    if (name) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(c);
    }
  }

  // Also index by abc_member_id from the custom field definitions
  // We need the field ID that corresponds to contact.abc_member_id
  const { data: fieldDefs } = await supabase
    .from('ghl_custom_field_defs')
    .select('id, field_key')
    .eq('location_id', locationId)
    .eq('field_key', 'contact.abc_member_id')
    .limit(1);

  const abcMemberIdFieldId = fieldDefs?.[0]?.id || null;

  if (abcMemberIdFieldId) {
    for (const c of locContacts) {
      const cf = c.custom_fields || {};
      const memberId = cf[abcMemberIdFieldId];
      if (memberId) {
        byMemberId.set(memberId, c);
      }
    }
    console.log(`[Reconcile] ${locationName}: ${byMemberId.size} contacts indexed by abc_member_id`);
  } else {
    console.warn(`[Reconcile] ${locationName}: abc_member_id field def not found — skipping member ID matching`);
  }

  // Also get field IDs for all our mapped fields
  const fieldKeyToId = {};
  if (Object.keys(ABC_GHL_FIELD_MAP).length > 0) {
    const fieldKeys = Object.values(ABC_GHL_FIELD_MAP);
    const { data: allFieldDefs } = await supabase
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', locationId)
      .in('field_key', fieldKeys);

    for (const fd of (allFieldDefs || [])) {
      fieldKeyToId[fd.field_key] = fd.id;
    }
  }

  // Referral field ids (looked up the same way as the mapped ABC fields).
  let referredByFieldId = null;
  let friendNameFieldId = null;
  if (referral.ENABLED) {
    const { data: refDefs } = await supabase
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', locationId)
      .in('field_key', [referral.REFERRED_BY_FIELD_KEY, referral.FRIEND_NAME_FIELD_KEY]);
    for (const fd of (refDefs || [])) {
      if (fd.field_key === referral.REFERRED_BY_FIELD_KEY) referredByFieldId = fd.id;
      if (fd.field_key === referral.FRIEND_NAME_FIELD_KEY) friendNameFieldId = fd.id;
    }
    if (!referredByFieldId) {
      console.warn(`[Reconcile] ${locationName}: ${referral.REFERRED_BY_FIELD_KEY} field def not found — referral rewards skipped this location`);
    }
  }
  const referralCandidates = [];

  // 4. Match and reconcile
  const logEntries = [];
  const processedGhlIds = new Set(); // Deduplicate — skip if already processed this contact
  let matched = 0;
  let unmatched = 0;
  let tagChanges = 0;
  let fieldUpdates = 0;
  let errors = 0;
  let staleContacts = 0; // cached contacts GHL 404'd on (deleted in GHL) — not alert-worthy
  const staleContactIds = new Set(); // self-heal: drop these from ghl_contacts_v2 after the run

  let skipped = 0;

  for (const abc of abcMembers) {
    // Skip non-member membership types
    if (abc.membership_type && skipMembershipTypes.has(abc.membership_type.toLowerCase())) {
      skipped++;
      continue;
    }

    let ghlContact = null;
    let matchMethod = null;

    // Match chain: member_id → email → phone → name
    // For email/phone/name matches, skip if the GHL contact already has a different
    // abc_member_id — that contact is claimed by another ABC member (e.g. family plans
    // where multiple members share a phone number).
    const isClaimedByOther = (candidate) => {
      if (!abcMemberIdFieldId || !candidate) return false;
      const existingId = (candidate.custom_fields || {})[abcMemberIdFieldId];
      return existingId && existingId !== abc.member_id;
    };

    if (abc.member_id && byMemberId.has(abc.member_id)) {
      ghlContact = byMemberId.get(abc.member_id);
      matchMethod = 'member_id';
    } else if (abc.email && byEmail.has(abc.email.toLowerCase().trim())) {
      const candidate = byEmail.get(abc.email.toLowerCase().trim());
      if (!isClaimedByOther(candidate)) {
        ghlContact = candidate;
        matchMethod = 'email';
      }
    }

    if (!ghlContact) {
      // Try phone match
      const abcPhone = (abc.primary_phone || abc.mobile_phone || '').replace(/[^\d]/g, '');
      if (abcPhone.length >= 10 && byPhone.has(abcPhone.slice(-10))) {
        const candidate = byPhone.get(abcPhone.slice(-10));
        if (!isClaimedByOther(candidate)) {
          ghlContact = candidate;
          matchMethod = 'phone';
        }
      }
    }

    if (!ghlContact) {
      // Try name match
      const abcName = `${(abc.first_name || '').toLowerCase().trim()} ${(abc.last_name || '').toLowerCase().trim()}`.trim();
      if (abcName && byName.has(abcName)) {
        const nameMatches = byName.get(abcName);
        if (nameMatches.length === 1 && !isClaimedByOther(nameMatches[0])) {
          ghlContact = nameMatches[0];
          matchMethod = 'name_review'; // Flag for review
        }
      }
    }

    if (!ghlContact) {
      // Skip inactive members — don't create GHL contacts for them
      if (!abc.is_active) {
        unmatched++;
        logEntries.push({
          run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
          ghl_contact_id: null, ghl_contact_name: null, ghl_contact_email: null,
          abc_member_id: abc.member_id, action: 'no_match',
          detail: { abc_name: `${abc.first_name} ${abc.last_name}`, abc_email: abc.email, reason: 'inactive' },
          applied: false, error: null,
        });
        continue;
      }

      // Skip family members whose phone/email is already on a claimed GHL contact
      const abcPhone = (abc.primary_phone || abc.mobile_phone || '').replace(/[^\d]/g, '');
      const abcEmail = (abc.email || '').trim().toLowerCase();
      const phoneContact = abcPhone.length >= 10 ? byPhone.get(abcPhone.slice(-10)) : null;
      const emailContact = abcEmail ? byEmail.get(abcEmail) : null;
      if ((phoneContact && isClaimedByOther(phoneContact)) || (emailContact && isClaimedByOther(emailContact))) {
        unmatched++;
        logEntries.push({
          run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
          ghl_contact_id: null, ghl_contact_name: null, ghl_contact_email: null,
          abc_member_id: abc.member_id, action: 'no_match',
          detail: { abc_name: `${abc.first_name} ${abc.last_name}`, abc_email: abc.email, reason: 'family_member_on_existing_contact' },
          applied: false, error: null,
        });
        continue;
      }

      // Skip members with no email AND no phone — can't reach them
      const hasContact = (abc.email || '').trim() || abc.primary_phone || abc.mobile_phone;
      if (!hasContact) {
        unmatched++;
        logEntries.push({
          run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
          ghl_contact_id: null, ghl_contact_name: null, ghl_contact_email: null,
          abc_member_id: abc.member_id, action: 'no_match',
          detail: { abc_name: `${abc.first_name} ${abc.last_name}`, reason: 'no_contact_info' },
          applied: false, error: null,
        });
        continue;
      }

      // Bail out early when this run can't be trusted to create contacts.
      const abcName = `${abc.first_name || ''} ${abc.last_name || ''}`.trim();
      if (createsDisabled) {
        unmatched++;
        logEntries.push({
          run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
          ghl_contact_id: null, ghl_contact_name: null, ghl_contact_email: null,
          abc_member_id: abc.member_id, action: 'no_match',
          detail: { abc_name: abcName, abc_email: abc.email, reason: 'creates_disabled_low_cache', cached_contacts: locContacts.length },
          applied: false, error: null,
        });
        continue;
      }

      // Ask GHL whether a contact with this email/phone already exists. The
      // Supabase cache (`ghl_contacts_v2`) is eventually consistent, so on its
      // own it cannot prevent duplicate creates. GHL's own duplicate-check
      // endpoint is authoritative.
      const phone = abc.primary_phone || abc.mobile_phone || null;
      const signDate = abc.sign_date || abc.since_date;
      const trimmedEmail = (abc.email || '').trim();
      const ghlDuplicate = await ghlContactExists(locationId, trimmedEmail, phone, apiKey);
      if (ghlDuplicate?.id) {
        // Treat the GHL-side duplicate as a match. Log it so we can see when
        // the Supabase cache lagged behind GHL, and skip the create.
        matched++;
        logEntries.push({
          run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
          ghl_contact_id: ghlDuplicate.id, ghl_contact_name: abcName, ghl_contact_email: abc.email,
          abc_member_id: abc.member_id, action: 'no_match',
          detail: { reason: 'cache_miss_existing_in_ghl', match_method: 'ghl_duplicate_check', existing_contact_id: ghlDuplicate.id },
          applied: true, error: null,
        });
        // Best-effort: append the 'sale' tag on the existing contact if it's
        // active, mirroring the matched-update flow below. Keep this minimal —
        // the next reconcile cycle (with a warm cache) will fully reconcile
        // tags and custom fields.
        if (abc.is_active) {
          try {
            const ex = await get(`/contacts/${ghlDuplicate.id}`, {}, apiKey);
            const existingTags = ex?.contact?.tags || [];
            if (!existingTags.includes(ABC_TAGS.active)) {
              await put(`/contacts/${ghlDuplicate.id}`, { tags: [...existingTags, ABC_TAGS.active] }, apiKey);
            }
            await sleep(650);
          } catch (err) {
            console.warn(`[Reconcile] could not tag existing GHL contact ${ghlDuplicate.id}: ${err.response?.data?.message || err.message}`);
          }
        }
        continue;
      }

      // Build custom fields for the new contact
      const newCustomFields = {};
      const memberIdFid = fieldKeyToId[ABC_GHL_FIELD_MAP.abc_member_id];
      if (memberIdFid) newCustomFields[memberIdFid] = abc.member_id;
      const membershipFid = fieldKeyToId[ABC_GHL_FIELD_MAP.membership_type];
      if (membershipFid) newCustomFields[membershipFid] = abc.membership_type || '';
      const statusFid = fieldKeyToId[ABC_GHL_FIELD_MAP.member_status];
      if (statusFid) newCustomFields[statusFid] = abc.member_status || '';
      const signFid = fieldKeyToId[ABC_GHL_FIELD_MAP.member_sign_date];
      if (signFid && signDate) newCustomFields[signFid] = signDate;
      const salespersonFid = fieldKeyToId[ABC_GHL_FIELD_MAP.salesperson];
      if (salespersonFid && abc.sales_person_name) newCustomFields[salespersonFid] = abc.sales_person_name;

      const createBody = {
        locationId,
        firstName: abc.first_name || '',
        lastName: abc.last_name || '',
        email: trimmedEmail || undefined,
        phone: phone || undefined,
        tags: [ABC_TAGS.active],
        customFields: Object.entries(newCustomFields).map(([id, value]) => ({ id, value })),
      };

      logEntries.push({
        run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
        ghl_contact_id: null, ghl_contact_name: abcName, ghl_contact_email: abc.email,
        abc_member_id: abc.member_id, action: 'create_contact',
        detail: { abc_name: abcName, abc_email: abc.email, phone, membership_type: abc.membership_type },
        applied: false, error: null,
      });

      if (!DRY_RUN) {
        try {
          const created = await post('/contacts/', createBody, apiKey);
          // Mark as applied
          const lastEntry = logEntries[logEntries.length - 1];
          lastEntry.applied = true;
          lastEntry.ghl_contact_id = created.contact?.id || null;
          matched++;
          await sleep(650);
        } catch (err) {
          const lastEntry = logEntries[logEntries.length - 1];
          const errDetail = err.response?.data?.message || err.response?.data || err.message;
          const errMsg = typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail);
          // Race condition: duplicate-check passed, but GHL still rejected as
          // duplicate. Demote create_contact → no_match and pull the existing
          // contact id off the error payload so the next reconcile cycle can
          // match it directly.
          const dupId = err.response?.data?.meta?.contactId;
          if (errMsg.toLowerCase().includes('duplicat') && dupId) {
            lastEntry.action = 'no_match';
            lastEntry.ghl_contact_id = dupId;
            lastEntry.detail = { ...(lastEntry.detail || {}), reason: 'create_race_duplicate', existing_contact_id: dupId };
            lastEntry.applied = true;
            console.warn(`[Reconcile] race-condition duplicate for ${abcName}, existing contact: ${dupId}`);
          } else {
            lastEntry.error = errMsg;
            errors++;
            console.error(`[Reconcile] Failed to create contact ${abcName}:`, lastEntry.error);
          }
        }
      } else {
        unmatched++;
      }
      continue;
    }

    // Skip if we already processed this GHL contact (e.g. same person has multiple ABC memberships)
    if (processedGhlIds.has(ghlContact.id)) continue;
    processedGhlIds.add(ghlContact.id);

    matched++;
    const contactName = `${ghlContact.first_name || ''} ${ghlContact.last_name || ''}`.trim();
    const isActive = abc.is_active === true;

    // --- Referral reward candidate detection ---
    // Read-only here: only collect candidates. They are processed after the loop.
    if (referral.ENABLED && referredByFieldId && isActive) {
      const referredByValue = (ghlContact.custom_fields || {})[referredByFieldId];
      if (referredByValue && String(referredByValue).trim()) {
        referralCandidates.push({
          abcMember: abc,
          referredByValue: String(referredByValue).trim(),
        });
      }
    }

    // --- Tag logic ---
    const currentTags = ghlContact.tags || [];
    const addTag = isActive ? ABC_TAGS.active : ABC_TAGS.inactive;
    const removeTag = isActive ? ABC_TAGS.inactive : ABC_TAGS.active;
    const needsAddTag = !currentTags.includes(addTag);
    const needsRemoveTag = currentTags.includes(removeTag);

    // --- Custom field logic ---
    // Normalize values to strings for comparison — GHL stores everything as strings in JSONB
    const norm = (v) => (v == null ? '' : String(v).trim());
    // Normalize dates: GHL stores dates as epoch ms, ABC provides YYYY-MM-DD strings
    const normDate = (v) => {
      if (v == null || v === '') return '';
      // If it's a number (epoch ms), convert to YYYY-MM-DD
      if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
        const d = new Date(Number(v));
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      }
      return String(v).trim();
    };
    const customFieldUpdates = {};
    const cf = ghlContact.custom_fields || {};

    // abc_member_id — always write to ensure it's set
    const memberIdFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.abc_member_id];
    if (memberIdFieldId) {
      const desired = norm(abc.member_id);
      if (desired && norm(cf[memberIdFieldId]) !== desired) {
        customFieldUpdates[memberIdFieldId] = abc.member_id;
      }
    }

    // membership_type
    const membershipTypeFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.membership_type];
    if (membershipTypeFieldId) {
      const desired = norm(abc.membership_type);
      if (norm(cf[membershipTypeFieldId]) !== desired) {
        customFieldUpdates[membershipTypeFieldId] = abc.membership_type || '';
      }
    }

    // member_status
    const memberStatusFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.member_status];
    if (memberStatusFieldId) {
      const desired = norm(abc.member_status);
      if (norm(cf[memberStatusFieldId]) !== desired) {
        customFieldUpdates[memberStatusFieldId] = abc.member_status || '';
      }
    }

    // member_sign_date ← agreement.signDate (actual contract sign date, not begin date)
    const actualSignDate = abc.sign_date || abc.since_date;
    const signDateFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.member_sign_date];
    if (signDateFieldId) {
      const desired = normDate(actualSignDate);
      if (desired && normDate(cf[signDateFieldId]) !== desired) {
        customFieldUpdates[signDateFieldId] = actualSignDate;
      }
    }

    // cancel_date ← memberStatusDate (only when inactive)
    const cancelDateFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.cancel_date];
    if (cancelDateFieldId) {
      if (!isActive && abc.member_status_date && normDate(cf[cancelDateFieldId]) !== normDate(abc.member_status_date)) {
        customFieldUpdates[cancelDateFieldId] = abc.member_status_date;
      } else if (isActive && normDate(cf[cancelDateFieldId]) !== '') {
        // Clear cancel date if member is now active
        customFieldUpdates[cancelDateFieldId] = '';
      }
    }

    // salesperson
    const salespersonFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.salesperson];
    if (salespersonFieldId) {
      const desired = norm(abc.sales_person_name);
      if (desired && norm(cf[salespersonFieldId]) !== desired) {
        customFieldUpdates[salespersonFieldId] = abc.sales_person_name;
      }
    }

    const hasChanges = needsAddTag || needsRemoveTag || Object.keys(customFieldUpdates).length > 0;
    if (!hasChanges) continue;

    // Build GHL update payload
    const newTags = [...currentTags];
    if (needsAddTag) newTags.push(addTag);
    if (needsRemoveTag) {
      const idx = newTags.indexOf(removeTag);
      if (idx !== -1) newTags.splice(idx, 1);
    }

    const updateBody = {};
    if (needsAddTag || needsRemoveTag) {
      updateBody.tags = newTags;
    }
    if (Object.keys(customFieldUpdates).length > 0) {
      updateBody.customFields = Object.entries(customFieldUpdates).map(([id, value]) => ({ id, value }));
    }

    // Log tag changes
    if (needsAddTag) {
      tagChanges++;
      logEntries.push({
        run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
        ghl_contact_id: ghlContact.id, ghl_contact_name: contactName, ghl_contact_email: ghlContact.email,
        abc_member_id: abc.member_id, action: 'add_tag',
        detail: { tag: addTag, match_method: matchMethod },
        applied: false, error: null,
      });
    }
    if (needsRemoveTag) {
      tagChanges++;
      logEntries.push({
        run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
        ghl_contact_id: ghlContact.id, ghl_contact_name: contactName, ghl_contact_email: ghlContact.email,
        abc_member_id: abc.member_id, action: 'remove_tag',
        detail: { tag: removeTag, match_method: matchMethod },
        applied: false, error: null,
      });
    }

    // Log field updates
    for (const [fieldId, value] of Object.entries(customFieldUpdates)) {
      fieldUpdates++;
      const fieldKey = Object.entries(fieldKeyToId).find(([k, v]) => v === fieldId)?.[0] || fieldId;
      logEntries.push({
        run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: DRY_RUN,
        ghl_contact_id: ghlContact.id, ghl_contact_name: contactName, ghl_contact_email: ghlContact.email,
        abc_member_id: abc.member_id, action: 'update_field',
        detail: { field: fieldKey, from: cf[fieldId] || null, to: value, match_method: matchMethod },
        applied: false, error: null,
      });
    }

    // Apply changes (or skip in dry run)
    if (!DRY_RUN) {
      try {
        await put(`/contacts/${ghlContact.id}`, updateBody, apiKey);
        // Mark all entries for this contact as applied
        for (const entry of logEntries) {
          if (entry.ghl_contact_id === ghlContact.id && !entry.applied) {
            entry.applied = true;
          }
        }
        await sleep(650); // Rate limit
      } catch (err) {
        const errDetail = err.response?.data?.message || err.response?.data || err.message;
        const errMsg = typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail);
        const deleted = isContactDeleted(err);
        // Contact was deleted in GHL but still cached — not a real error. Don't
        // count it toward the alert, and queue it for cache removal so next cycle
        // re-matches by email/phone or recreates it (create path runs its own
        // authoritative GHL duplicate-check, so this can't spawn duplicates).
        if (deleted) {
          staleContacts++;
          staleContactIds.add(ghlContact.id);
          console.warn(`[Reconcile] stale (deleted-in-GHL) contact ${contactName} [${ghlContact.id}] — dropping from cache`);
        } else {
          errors++;
          console.error(`[Reconcile] Failed to update ${contactName}:`, errMsg);
        }
        for (const entry of logEntries) {
          if (entry.ghl_contact_id === ghlContact.id && !entry.applied) {
            entry.error = deleted ? `stale_contact: ${errMsg}` : errMsg;
            if (deleted) entry.detail = { ...(entry.detail || {}), stale_contact: true };
          }
        }
      }
    }
  }

  // 4.5 Referral rewards — process collected candidates.
  if (referral.ENABLED && referredByFieldId && referralCandidates.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    let processedReferrals = 0;

    // Load existing referral_rewards rows for idempotency.
    const newMemberIds = referralCandidates.map((c) => c.abcMember.member_id);
    const { data: existingRows } = await supabase
      .from('referral_rewards')
      .select('new_member_id, dues_status')
      .in('new_member_id', newMemberIds);
    const existingByMember = new Map((existingRows || []).map((r) => [r.new_member_id, r]));

    // tagReferrer writes the friend's name AND the trigger tag in a single GHL
    // PUT, so the SMS-triggering tag can never exist without the credit.
    const tagReferrer = async (contactId, friendName) => {
      const current = await get(`/contacts/${contactId}`, {}, apiKey);
      const existingTags = current?.contact?.tags || [];
      const tags = existingTags.includes(referral.REWARD_TAG)
        ? existingTags
        : [...existingTags, referral.REWARD_TAG];
      const updateBody = { tags };
      if (friendNameFieldId) {
        updateBody.customFields = [{ id: friendNameFieldId, value: friendName }];
      }
      await put(`/contacts/${contactId}`, updateBody, apiKey);
      await sleep(650);
    };

    const recordReward = async (row) => {
      const { error: upErr } = await supabase
        .from('referral_rewards')
        .upsert(row, { onConflict: 'new_member_id' });
      if (upErr) console.error(`[Referral] failed to record reward for ${row.new_member_id}: ${upErr.message}`);
    };

    for (const cand of referralCandidates) {
      const existingRow = existingByMember.get(cand.abcMember.member_id) || null;
      const { eligible } = isEligibleCandidate({
        abcMember: cand.abcMember,
        referredByValue: cand.referredByValue,
        existingRow,
        programStartDate: referral.PROGRAM_START_DATE,
      });
      if (!eligible) continue;
      processedReferrals++;

      const referrerContact = byMemberId.get(cand.referredByValue) || null;
      try {
        await processReferralReward({
          location, runId,
          abcMember: cand.abcMember,
          referrerAbcId: cand.referredByValue,
          referrerContact,
          dryRun: DRY_RUN,
          today,
          fetchMemberInvoices,
          adjustInvoice,
          tagReferrer,
          recordReward,
        });
      } catch (err) {
        console.error(`[Referral] unexpected error for new member ${cand.abcMember.member_id}: ${err.message}`);
        errors++;
      }
      await sleep(650);
    }
    console.log(`[Reconcile] ${locationName}: ${referralCandidates.length} referral candidate(s), ${processedReferrals} eligible + processed`);
  }

  // 4.9 Self-heal: remove contacts GHL reported as deleted from the cache so we
  // stop attempting (and alerting on) them every cycle. Skip in dry-run.
  if (!DRY_RUN && staleContactIds.size > 0) {
    const ids = [...staleContactIds];
    const { error: delErr } = await supabase
      .from('ghl_contacts_v2')
      .delete()
      .eq('location_id', locationId)
      .in('id', ids);
    if (delErr) {
      console.error(`[Reconcile] ${locationName}: failed to prune ${ids.length} stale cached contact(s):`, delErr.message);
    } else {
      console.log(`[Reconcile] ${locationName}: pruned ${ids.length} stale (deleted-in-GHL) contact(s) from cache`);
    }
  }

  // 5. Write log entries to Supabase in batches
  if (logEntries.length > 0) {
    for (let i = 0; i < logEntries.length; i += 500) {
      const batch = logEntries.slice(i, i + 500);
      const { error: logErr } = await supabase
        .from('abc_sync_run_log')
        .insert(batch);
      if (logErr) {
        console.error(`[Reconcile] Failed to write log batch:`, logErr.message);
      }
    }
  }

  const summary = { matched, unmatched, skipped, tagChanges, fieldUpdates, errors, staleContacts, total: abcMembers.length };
  console.log(`[Reconcile] ${locationName}: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { reconcileLocation };
