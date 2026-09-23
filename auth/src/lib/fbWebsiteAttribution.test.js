const { test } = require('node:test')
const assert = require('node:assert')
const { resolveWebsiteAdId } = require('./fbWebsiteAttribution')

const spend = new Map([
  ['111', { adName: 'Culture', campaignId: 'c1' }],
  ['222', { adName: 'Culture', campaignId: 'c2' }],
  ['333', { adName: 'Lead Ad (April 2026)', campaignId: 'c1' }],
])

test("Meta's automatic parameters carry the ad id in utm_content", () => {
  // Dakoda Bedortha's contact, 2026-09-23.
  const attr = { utmSource: 'fb', utmMedium: 'paid', utmContent: '52587147187305', utmTerm: '52587144668705' }
  assert.strictEqual(resolveWebsiteAdId(attr, spend), '52587147187305')
})

test("HighLevel's template is matched by ad name within the campaign", () => {
  assert.strictEqual(resolveWebsiteAdId({ utmSource: 'fb_ad', utmContent: 'Culture', campaignId: 'c2' }, spend), '222')
  assert.strictEqual(resolveWebsiteAdId({ utmSource: 'fb_ad', utmContent: 'Lead Ad (April 2026)' }, spend), '333')
})

test('an ad name used in two campaigns, with no campaign id, is not guessed', () => {
  assert.strictEqual(resolveWebsiteAdId({ utmSource: 'fb_ad', utmContent: 'Culture' }, spend), null)
})

test('non-Facebook traffic and empty content are ignored', () => {
  assert.strictEqual(resolveWebsiteAdId({ utmSource: 'google', utmContent: '52587147187305' }, spend), null)
  assert.strictEqual(resolveWebsiteAdId({ utmSource: 'fb' }, spend), null)
  assert.strictEqual(resolveWebsiteAdId(null, spend), null)
})
