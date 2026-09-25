import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quizSettingsFrom, webhookBadge, PIXEL_RE, GTM_RE } from './quizDefaults.js'

test('quizSettingsFrom fills every section', () => {
  const s = quizSettingsFrom({ tracking: { gtm_id: 'GTM-AAAA' } })
  assert.equal(s.tracking.gtm_id, 'GTM-AAAA')
  assert.equal(s.tracking.meta_pixel_id, '')
  assert.equal(s.contact_step.require_phone, true)
  assert.equal(typeof s.thank_you.heading, 'string')
})

test('webhookBadge', () => {
  assert.deepEqual(webhookBadge({ webhook_status: 'sent' }), { label: 'Sent to GHL', tone: 'green' })
  assert.deepEqual(webhookBadge({ webhook_status: 'failed', webhook_attempts: 2 }), { label: 'Retrying (2/5)', tone: 'amber' })
  assert.deepEqual(webhookBadge({ webhook_status: 'failed', webhook_attempts: 5 }), { label: 'Failed', tone: 'red' })
  assert.deepEqual(webhookBadge({ webhook_status: 'pending' }), { label: 'Sending', tone: 'gray' })
  assert.deepEqual(webhookBadge({ webhook_status: 'none' }), { label: 'No webhook', tone: 'gray' })
})

test('id regexes match backend', () => {
  assert.ok(PIXEL_RE.test('820682157231470'))
  assert.ok(GTM_RE.test('GTM-N4BRPV65'))
  assert.ok(!GTM_RE.test('gtm-n4'))
})
