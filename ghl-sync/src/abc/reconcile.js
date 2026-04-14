const supabase = require('../db/supabase');
const { put, sleep } = require('../ghl/client');
const { ABC_GHL_FIELD_MAP, ABC_TAGS, ABC_SKIP_MEMBERSHIP_TYPES } = require('../config/abc-field-map');

const DRY_RUN = (process.env.DRY_RUN || 'true') === 'true';

/**
 * Reconcile ABC members against GHL contacts for one location.
 * Matches by: abc_member_id → email → phone → name (flagged for review).
 * Applies tags + custom field updates to matched GHL contacts.
 */
async function reconcileLocation(location, runId) {
  const { id: locationId, name: locationName, clubNumber, apiKey } = location;
  console.log(`[Reconcile] ${locationName}: starting (dry_run=${DRY_RUN})`);

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

  // 4. Match and reconcile
  const logEntries = [];
  const processedGhlIds = new Set(); // Deduplicate — skip if already processed this contact
  let matched = 0;
  let unmatched = 0;
  let tagChanges = 0;
  let fieldUpdates = 0;
  let errors = 0;

  let skipped = 0;

  for (const abc of abcMembers) {
    // Skip non-member membership types
    if (abc.membership_type && ABC_SKIP_MEMBERSHIP_TYPES.includes(abc.membership_type)) {
      skipped++;
      continue;
    }

    let ghlContact = null;
    let matchMethod = null;

    // Match chain: member_id → email → phone → name
    if (abc.member_id && byMemberId.has(abc.member_id)) {
      ghlContact = byMemberId.get(abc.member_id);
      matchMethod = 'member_id';
    } else if (abc.email && byEmail.has(abc.email.toLowerCase().trim())) {
      ghlContact = byEmail.get(abc.email.toLowerCase().trim());
      matchMethod = 'email';
    } else {
      // Try phone match
      const abcPhone = (abc.primary_phone || abc.mobile_phone || '').replace(/[^\d]/g, '');
      if (abcPhone.length >= 10 && byPhone.has(abcPhone.slice(-10))) {
        ghlContact = byPhone.get(abcPhone.slice(-10));
        matchMethod = 'phone';
      } else {
        // Try name match
        const abcName = `${(abc.first_name || '').toLowerCase().trim()} ${(abc.last_name || '').toLowerCase().trim()}`.trim();
        if (abcName && byName.has(abcName)) {
          const nameMatches = byName.get(abcName);
          if (nameMatches.length === 1) {
            ghlContact = nameMatches[0];
            matchMethod = 'name_review'; // Flag for review
          }
          // If multiple name matches, skip — too ambiguous
        }
      }
    }

    if (!ghlContact) {
      unmatched++;
      logEntries.push({
        run_id: runId,
        club_number: clubNumber,
        club_name: locationName,
        dry_run: DRY_RUN,
        ghl_contact_id: null,
        ghl_contact_name: null,
        ghl_contact_email: null,
        abc_member_id: abc.member_id,
        action: 'no_match',
        detail: { abc_name: `${abc.first_name} ${abc.last_name}`, abc_email: abc.email },
        applied: false,
        error: null,
      });
      continue;
    }

    // Skip if we already processed this GHL contact (e.g. same person has multiple ABC memberships)
    if (processedGhlIds.has(ghlContact.id)) continue;
    processedGhlIds.add(ghlContact.id);

    matched++;
    const contactName = `${ghlContact.first_name || ''} ${ghlContact.last_name || ''}`.trim();
    const isActive = abc.is_active === true;

    // --- Tag logic ---
    const currentTags = ghlContact.tags || [];
    const addTag = isActive ? ABC_TAGS.active : ABC_TAGS.inactive;
    const removeTag = isActive ? ABC_TAGS.inactive : ABC_TAGS.active;
    const needsAddTag = !currentTags.includes(addTag);
    const needsRemoveTag = currentTags.includes(removeTag);

    // --- Custom field logic ---
    const customFieldUpdates = {};
    const cf = ghlContact.custom_fields || {};

    // abc_member_id — always write to ensure it's set
    const memberIdFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.abc_member_id];
    if (memberIdFieldId && cf[memberIdFieldId] !== abc.member_id) {
      customFieldUpdates[memberIdFieldId] = abc.member_id;
    }

    // membership_type
    const membershipTypeFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.membership_type];
    if (membershipTypeFieldId && cf[membershipTypeFieldId] !== abc.membership_type) {
      customFieldUpdates[membershipTypeFieldId] = abc.membership_type || '';
    }

    // member_status
    const memberStatusFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.member_status];
    if (memberStatusFieldId && cf[memberStatusFieldId] !== abc.member_status) {
      customFieldUpdates[memberStatusFieldId] = abc.member_status || '';
    }

    // member_sign_date ← agreement.signDate (actual contract sign date, not begin date)
    const actualSignDate = abc.sign_date || abc.since_date;
    const signDateFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.member_sign_date];
    if (signDateFieldId && actualSignDate && cf[signDateFieldId] !== actualSignDate) {
      customFieldUpdates[signDateFieldId] = actualSignDate;
    }

    // cancel_date ← memberStatusDate (only when inactive)
    const cancelDateFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.cancel_date];
    if (cancelDateFieldId) {
      if (!isActive && abc.member_status_date && cf[cancelDateFieldId] !== abc.member_status_date) {
        customFieldUpdates[cancelDateFieldId] = abc.member_status_date;
      } else if (isActive && cf[cancelDateFieldId]) {
        // Clear cancel date if member is now active
        customFieldUpdates[cancelDateFieldId] = '';
      }
    }

    // salesperson
    const salespersonFieldId = fieldKeyToId[ABC_GHL_FIELD_MAP.salesperson];
    if (salespersonFieldId && abc.sales_person_name && cf[salespersonFieldId] !== abc.sales_person_name) {
      customFieldUpdates[salespersonFieldId] = abc.sales_person_name;
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
      updateBody.customField = customFieldUpdates;
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
        errors++;
        console.error(`[Reconcile] Failed to update ${contactName}:`, err.message);
        for (const entry of logEntries) {
          if (entry.ghl_contact_id === ghlContact.id && !entry.applied) {
            entry.error = err.message;
          }
        }
      }
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

  const summary = { matched, unmatched, skipped, tagChanges, fieldUpdates, errors, total: abcMembers.length };
  console.log(`[Reconcile] ${locationName}: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { reconcileLocation };
