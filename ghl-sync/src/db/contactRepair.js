// Given a batch of opportunities that failed a foreign-key insert, null contact_id
// ONLY on the opps whose contact is genuinely absent from ghl_contacts_v2. A single
// orphaned opp (contact deleted/merged in GHL) must never blank the contact link for
// every other opp in the same batch — doing so silently breaks Speed to Lead and any
// other opp→contact report for a whole location.
//
// Pure function (no DB) so it is unit-testable in isolation, mirroring pruneDecision.
function nullMissingContacts(batch, existingContactIds) {
  return batch.map(o =>
    o.contact_id && !existingContactIds.has(o.contact_id)
      ? { ...o, contact_id: null }
      : o
  );
}

module.exports = { nullMissingContacts };
