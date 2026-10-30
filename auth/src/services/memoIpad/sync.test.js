process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const test = require('node:test')
const assert = require('node:assert')
const { planClub, confirmLockImage, md5, isEnabled } = require('./sync')

const club = (over = {}) => ({ ipad_target: 'b1', ipad_pushed_md5: null, ipad_status: null, ipad_failed_md5: null, normal_saved_at: '2026-10-30', normal_image_md5: 'normal', ...over })
const live = { id: 'memo1' }

test('a club with no target is never touched', () => {
  assert.strictEqual(planClub({ club: club({ ipad_target: null }), live, image: { md5: 'a' } }).action, 'none')
})

test('a live memo with a new image gets pushed', () => {
  assert.deepStrictEqual(planClub({ club: club(), live, image: { md5: 'a' } }), { action: 'push', desired: 'a' })
})

test('an image already on the iPads is not sent again', () => {
  assert.strictEqual(planClub({ club: club({ ipad_pushed_md5: 'a' }), live, image: { md5: 'a' } }).action, 'none')
})

test('a live memo with no image waits and reports it', () => {
  assert.strictEqual(planClub({ club: club(), live, image: null }).action, 'wait')
})

test('when the memo ends the normal image goes back', () => {
  assert.deepStrictEqual(planClub({ club: club({ ipad_pushed_md5: 'a' }), live: null, image: null }), { action: 'restore', desired: 'normal' })
})

test('a club that never had a memo pushed is left alone', () => {
  assert.strictEqual(planClub({ club: club(), live: null, image: null }).action, 'none')
})

test('after restoring, nothing more happens', () => {
  assert.strictEqual(planClub({ club: club({ ipad_pushed_md5: 'normal' }), live: null, image: null }).action, 'none')
})

test('a club with no lock image of its own goes back to none', () => {
  assert.deepStrictEqual(planClub({ club: club({ ipad_pushed_md5: 'a', normal_image_md5: null }), live: null, image: null }), { action: 'clear', desired: 'cleared' })
})

test('once cleared, nothing more happens', () => {
  assert.strictEqual(planClub({ club: club({ ipad_pushed_md5: 'cleared', normal_image_md5: null }), live: null, image: null }).action, 'none')
})

test('a memo that ends before the normal image was ever saved is reported, not cleared', () => {
  assert.strictEqual(planClub({ club: club({ ipad_pushed_md5: 'a', normal_saved_at: null }), live: null, image: null }).action, 'no_normal')
})

test('an upload only counts when the service names the exact image sent', () => {
  const bytes = Buffer.from('image')
  assert.doesNotThrow(() => confirmLockImage({ lock: md5(bytes) }, bytes))
  assert.throws(() => confirmLockImage({ lock: null }, bytes), /did not take/)
  assert.throws(() => confirmLockImage({ lock: 'other' }, bytes), /did not take/)
  assert.throws(() => confirmLockImage(undefined, bytes), /did not take/)
})

test('a failure does not retry on its own, so bad logins cannot lock the account', () => {
  const stuck = club({ ipad_status: 'failed', ipad_failed_md5: 'a' })
  assert.strictEqual(planClub({ club: stuck, live, image: { md5: 'a' } }).action, 'none')
})

test('a new image after a failure does try again', () => {
  const stuck = club({ ipad_status: 'failed', ipad_failed_md5: 'a' })
  assert.strictEqual(planClub({ club: stuck, live, image: { md5: 'b' } }).action, 'push')
})

test('it stays dark unless switched on and fully configured', () => {
  const all = { MEMO_IPAD_LOGIN_URL: 'x', MEMO_IPAD_WALLPAPER_URL: 'x', MEMO_IPAD_USER: 'x', MEMO_IPAD_PASSWORD: 'x' }
  assert.strictEqual(isEnabled(all), false)
  assert.strictEqual(isEnabled({ ...all, MEMO_IPAD_SYNC_ENABLED: 'true' }), true)
  assert.strictEqual(isEnabled({ MEMO_IPAD_SYNC_ENABLED: 'true' }), false)
})
