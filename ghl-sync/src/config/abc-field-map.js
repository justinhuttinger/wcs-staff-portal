/**
 * ABC ↔ GHL Custom Field Mapping
 *
 * Maps ABC data to GHL custom field keys.
 * These keys are the same across all 7 GHL sub-accounts.
 */

const ABC_GHL_FIELD_MAP = {
  // ABC Field                    → GHL Custom Field Key
  abc_member_id:                  'contact.abc_member_id',
  membership_type:                'contact.membership_type',
  member_status:                  'contact.member_status',
  member_sign_date:               'contact.member_sign_date',
  cancel_date:                    'contact.cancel_date',
  salesperson:                    'contact.salesperson',
};

// Tag names used for active/inactive members
const ABC_TAGS = {
  active: 'sale',
  inactive: 'cancelled / past member',
};

// Membership types to skip during reconciliation — not real members
const ABC_SKIP_MEMBERSHIP_TYPES = [
  'CHILDCARE',
  'Club Access',
  'Event Access',
  'NON-MEMBER',
  'NLPT ONLY',
  'PT ONLY',
  'SWIM ONLY',
];

module.exports = { ABC_GHL_FIELD_MAP, ABC_TAGS, ABC_SKIP_MEMBERSHIP_TYPES };
