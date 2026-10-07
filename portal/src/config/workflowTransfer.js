// Workflow Transfer (GHL workflow import/export) is the owner's tool only. The
// API enforces the same list (WORKFLOW_TRANSFER_EMAILS, admin role required);
// this copy just decides whether the tile shows.
export const WORKFLOW_TRANSFER_EMAILS = ['justin@wcstrength.com']

export function canUseWorkflowTransfer(staff) {
  return staff?.role === 'admin' && WORKFLOW_TRANSFER_EMAILS.includes(String(staff?.email || '').toLowerCase())
}
