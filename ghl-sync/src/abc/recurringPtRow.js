// Pure helpers for the recurring PT sync (no I/O, no deps) so they can be
// unit-tested without ABC/Supabase. Used by recurringPtServices.js.

function isPT(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CONSULT')) return false;
  return n.includes('PT') || n.includes('TRAIN') || n.includes('PARTNER') ||
    n.includes('SMALL GROUP') || n.includes('ONLINE') || n.includes('CHALLENGE');
}

// Active, non-PIF, PT recurring service?
function isActivePT(s) {
  return s.recurringServiceStatus === 'active' &&
    !((s.recurringTypeDesc || '').includes('Paid in Full')) &&
    isPT(s.serviceItem);
}

// Build a DB row for abc_recurring_pt_services from one raw ABC service.
function toRow(svc, club) {
  const memberName = `${(svc.memberFirstName || '').trim()} ${(svc.memberLastName || '').trim()}`.trim() || null;
  const trainerName = `${(svc.serviceEmployeeFirstName || '').trim()} ${(svc.serviceEmployeeLastName || '').trim()}`.trim() || null;
  // ABC returns recurringServiceDates.* as timestamps; store the date part only.
  const nbd = String(svc.recurringServiceDates?.nextBillingDate || '').slice(0, 10) || null;
  return {
    club_number: club.clubNumber,
    recurring_service_id: String(svc.recurringServiceId),
    location_slug: club.slug,
    member_id: svc.memberId ? String(svc.memberId) : null,
    member_name: memberName,
    service_employee_id: svc.serviceEmployeeId ? String(svc.serviceEmployeeId) : null,
    trainer_name: trainerName,
    service_item: svc.serviceItem || null,
    next_billing_date: nbd,
    invoice_total: parseFloat(svc.invoiceTotal || '0') || 0,
    recurring_type_desc: svc.recurringTypeDesc || null,
    status: svc.recurringServiceStatus || null,
  };
}

module.exports = { isPT, isActivePT, toRow };
