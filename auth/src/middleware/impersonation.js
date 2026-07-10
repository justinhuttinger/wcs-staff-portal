// Pure impersonation-decision helpers. No Supabase here so they stay unit-
// testable; auth.js wires them to the real staff loader.

// POST endpoints that are actually reads (not mutations) — allowed while
// impersonating. Paths are FULL paths (baseUrl + path), matched by prefix.
const READONLY_POST_PATHS = ['/media/search']

async function applyImpersonation({ realStaff, targetStaffId, loadStaffContext }) {
  const passthrough = { staff: realStaff, realStaff: null, impersonating: false }
  if (!targetStaffId) return passthrough
  if (!realStaff || realStaff.role !== 'admin') return passthrough
  const target = await loadStaffContext(targetStaffId)
  if (!target || target.is_active === false) return passthrough
  return { staff: target, realStaff, impersonating: true }
}

function isImpersonatedWrite(method, impersonating, path, allowlist = READONLY_POST_PATHS) {
  if (!impersonating) return false
  const m = String(method || 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  if (allowlist.some(p => path.startsWith(p))) return false
  return true
}

module.exports = { applyImpersonation, isImpersonatedWrite, READONLY_POST_PATHS }
