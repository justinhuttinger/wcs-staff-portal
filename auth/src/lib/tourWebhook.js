// Shape of the outbound webhook fired when a tour outcome is saved.
function buildTourWebhookPayload(location, intake) {
  return {
    location_id: location.id,
    location_name: location.name,
    intake_id: intake.id,
    contact_name: intake.contact_name || null,
    contact_email: intake.contact_email || null,
    contact_phone: intake.contact_phone || null,
    tour_member: intake.tour_member || null,
    outcome: intake.outcome || null,
    notes: intake.notes || null,
    completed_at: intake.completed_at || null,
  }
}

module.exports = { buildTourWebhookPayload }
