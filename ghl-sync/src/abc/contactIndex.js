/**
 * Shared ABC member → GHL contact matching/indexing.
 *
 * Extracted from reconcile.js (member→contact indexing) so the lapsed-tagging
 * job can reuse the exact same match chain (member_id → email → phone →
 * name) without duplicating it. reconcile.js imports this too.
 */

/**
 * Build lookup indexes over a location's cached GHL contacts.
 * @param {Array} contacts - rows from ghl_contacts_v2 (id, email, phone,
 *   first_name, last_name, tags, custom_fields)
 * @param {Array} fieldDefs - ghl_custom_field_defs rows scoped to
 *   field_key === 'contact.abc_member_id' (id, field_key)
 */
function buildContactIndex(contacts, fieldDefs = []) {
  const byMemberId = new Map();  // abc_member_id custom field → contact
  const byEmail = new Map();     // lowercase email → contact
  const byPhone = new Map();     // last-10-digit phone → contact
  const byName = new Map();      // "first last" lowercase → contact[]

  for (const c of contacts) {
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

  const memberIdFieldDef = (fieldDefs || []).find(fd => fd.field_key === 'contact.abc_member_id');
  const abcMemberIdFieldId = memberIdFieldDef?.id || null;

  if (abcMemberIdFieldId) {
    for (const c of contacts) {
      const cf = c.custom_fields || {};
      const memberId = cf[abcMemberIdFieldId];
      if (memberId) {
        byMemberId.set(memberId, c);
      }
    }
  }

  return { byMemberId, byEmail, byPhone, byName, abcMemberIdFieldId };
}

/**
 * A candidate contact is "claimed by another member" when it already carries
 * a different abc_member_id — e.g. family plans sharing a phone/email. In
 * that case the candidate must not be matched to this member.
 */
function isClaimedByOther(index, candidate, memberId) {
  if (!index.abcMemberIdFieldId || !candidate) return false;
  const existingId = (candidate.custom_fields || {})[index.abcMemberIdFieldId];
  return Boolean(existingId) && existingId !== memberId;
}

/**
 * Match an ABC member to a GHL contact via the standard chain:
 * member_id → email → phone → name (name match only when unambiguous).
 * @param {object} index - result of buildContactIndex
 * @param {object} member - { member_id, email, primary_phone, mobile_phone, first_name, last_name }
 * @returns {{ contact: object, matchMethod: string }|null}
 */
function matchContact(index, member) {
  if (member.member_id && index.byMemberId.has(member.member_id)) {
    return { contact: index.byMemberId.get(member.member_id), matchMethod: 'member_id' };
  }

  const email = (member.email || '').toLowerCase().trim();
  if (email && index.byEmail.has(email)) {
    const candidate = index.byEmail.get(email);
    if (!isClaimedByOther(index, candidate, member.member_id)) {
      return { contact: candidate, matchMethod: 'email' };
    }
  }

  const phone = (member.primary_phone || member.mobile_phone || '').replace(/[^\d]/g, '');
  if (phone.length >= 10 && index.byPhone.has(phone.slice(-10))) {
    const candidate = index.byPhone.get(phone.slice(-10));
    if (!isClaimedByOther(index, candidate, member.member_id)) {
      return { contact: candidate, matchMethod: 'phone' };
    }
  }

  const name = `${(member.first_name || '').toLowerCase().trim()} ${(member.last_name || '').toLowerCase().trim()}`.trim();
  if (name && index.byName.has(name)) {
    const nameMatches = index.byName.get(name);
    if (nameMatches.length === 1 && !isClaimedByOther(index, nameMatches[0], member.member_id)) {
      return { contact: nameMatches[0], matchMethod: 'name_review' }; // Flag for review
    }
  }

  return null;
}

module.exports = { buildContactIndex, matchContact, isClaimedByOther };
