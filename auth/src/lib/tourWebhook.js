// Shape of the outbound webhook fired when a tour outcome is saved.
function buildTourWebhookPayload(location, intake) {
  return {
    location_id: location.id,
    location_name: location.name,
    intake_id: intake.id,
    contact_id: intake.ghl_contact_id || null,
    contact_name: intake.contact_name || null,
    contact_email: intake.contact_email || null,
    contact_phone: intake.contact_phone || null,
    tour_member: intake.tour_member || null,
    outcome: intake.outcome || null,

    // How long a pass the outcome handed out. Trial and VIP are fixed lengths
    // and Custom Pass is whatever staff chose, so this cannot be inferred
    // downstream from the outcome alone.
    //
    // Taken from what staff selected, not from ABC. The webhook then reports
    // what the tour decided regardless of whether an ABC profile was linked or
    // the write succeeded.
    //
    // Null on outcomes that grant nothing, rather than 0, so a workflow can
    // tell "no pass" from "a pass of zero days".
    pass_days: intake.pass_days != null ? Number(intake.pass_days) : null,

    // Who sent them, captured on a VIP pass. Carried so a workflow can credit
    // the referrer without re-reading the contact.
    referred_by_full_name: intake.referred_by_full_name || null,
    referred_by_abc_id: intake.referred_by_abc_id || null,
    vip_team_member: intake.vip_team_member || null,

    notes: intake.notes || null,
    referring_member_id: intake.referring_member_id || null,
    referring_member_name: intake.referring_member_name || null,
    completed_at: intake.completed_at || null,
  }
}

module.exports = { buildTourWebhookPayload }
