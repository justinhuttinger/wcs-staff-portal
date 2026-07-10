const test = require('node:test')
const assert = require('node:assert')
const { applyImpersonation, isImpersonatedWrite } = require('./impersonation')

const admin = { id: 'a1', role: 'admin', email: 'a@x.com' }
const target = { id: 't1', role: 'manager', is_active: true }
const loadOK = async (id) => (id === 't1' ? target : null)

test('admin + valid target → impersonating', async () => {
  const r = await applyImpersonation({ realStaff: admin, targetStaffId: 't1', loadStaffContext: loadOK })
  assert.strictEqual(r.impersonating, true)
  assert.strictEqual(r.staff, target)
  assert.strictEqual(r.realStaff, admin)
})

test('no header → passthrough as self', async () => {
  const r = await applyImpersonation({ realStaff: admin, targetStaffId: undefined, loadStaffContext: loadOK })
  assert.strictEqual(r.impersonating, false)
  assert.strictEqual(r.staff, admin)
})

test('non-admin + header → ignored, stays self', async () => {
  const lead = { id: 'l1', role: 'lead' }
  const r = await applyImpersonation({ realStaff: lead, targetStaffId: 't1', loadStaffContext: loadOK })
  assert.strictEqual(r.impersonating, false)
  assert.strictEqual(r.staff, lead)
})

test('admin + missing/inactive target → stays self', async () => {
  const r1 = await applyImpersonation({ realStaff: admin, targetStaffId: 'nope', loadStaffContext: loadOK })
  assert.strictEqual(r1.impersonating, false)
  const loadInactive = async () => ({ id: 't1', role: 'manager', is_active: false })
  const r2 = await applyImpersonation({ realStaff: admin, targetStaffId: 't1', loadStaffContext: loadInactive })
  assert.strictEqual(r2.impersonating, false)
})

test('isImpersonatedWrite: blocks non-GET only while impersonating', () => {
  assert.strictEqual(isImpersonatedWrite('POST', true, '/x'), true)
  assert.strictEqual(isImpersonatedWrite('GET', true, '/x'), false)
  assert.strictEqual(isImpersonatedWrite('POST', false, '/x'), false)
  assert.strictEqual(isImpersonatedWrite('DELETE', true, '/x'), true)
})

test('isImpersonatedWrite: allowlisted POST read passes', () => {
  assert.strictEqual(isImpersonatedWrite('POST', true, '/reports/foo', ['/reports/foo']), false)
})

test('isImpersonatedWrite: default allowlist lets /media/search POST read through', () => {
  assert.strictEqual(isImpersonatedWrite('POST', true, '/media/search'), false)
})
