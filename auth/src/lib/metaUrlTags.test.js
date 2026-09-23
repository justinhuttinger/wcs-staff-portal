const { test } = require('node:test')
const assert = require('node:assert')
const { GHL_URL_TAGS, urlTagsFor } = require('./metaUrlTags')

const cta = (value) => ({ type: 'LEARN_MORE', value })

test('image and video website ads get the HighLevel template', () => {
  assert.strictEqual(urlTagsFor({ link_data: { link: 'https://x.com', call_to_action: cta({ link: 'https://x.com' }) } }), GHL_URL_TAGS)
  assert.strictEqual(urlTagsFor({ video_data: { call_to_action: cta({ link: 'https://x.com' }) } }), GHL_URL_TAGS)
})

test('Instant Form ads get no URL parameters', () => {
  const spec = { link_data: { call_to_action: cta({ link: 'https://x.com', lead_gen_form_id: '123' }) } }
  assert.strictEqual(urlTagsFor(spec), undefined)
})

test('the template is exactly what GHL documents', () => {
  const p = new URLSearchParams(GHL_URL_TAGS)
  assert.deepStrictEqual(Object.fromEntries(p), {
    utm_source: 'fb_ad',
    utm_medium: '{{adset.name}}',
    utm_campaign: '{{campaign.name}}',
    utm_content: '{{ad.name}}',
    campaign_id: '{{campaign.id}}',
  })
})
