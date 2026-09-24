const { test } = require('node:test')
const assert = require('node:assert')
const {
  FLEX_LIMITS, cleanTexts, flexibleAdProblems, buildFlexibleCreative, adsetProblem,
} = require('./metaFlexibleAd')

const base = (overrides = {}) => ({
  page_id: '111',
  link: 'https://westcoaststrength.com/trial',
  media: [{ image_hash: 'h1' }],
  bodies: ['Train with us'],
  ...overrides,
})

test('cleanTexts trims, drops blanks and collapses repeats', () => {
  assert.deepStrictEqual(cleanTexts(['  a ', '', null, 'a', 'b', '   ']), ['a', 'b'])
  assert.deepStrictEqual(cleanTexts(undefined), [])
})

test('an image-only website ad builds a SINGLE_IMAGE feed on a bare story spec', () => {
  const out = buildFlexibleCreative(base({
    instagram_user_id: '222',
    media: [{ image_hash: 'h1' }, { image_hash: 'h2' }],
    bodies: ['One', 'Two'],
    titles: ['Head A', ''],
    descriptions: [],
  }))
  assert.deepStrictEqual(out.object_story_spec, { page_id: '111', instagram_user_id: '222' })
  assert.deepStrictEqual(out.asset_feed_spec, {
    bodies: [{ text: 'One' }, { text: 'Two' }],
    link_urls: [{ website_url: 'https://westcoaststrength.com/trial' }],
    call_to_action_types: ['LEARN_MORE'],
    ad_formats: ['SINGLE_IMAGE'],
    images: [{ hash: 'h1' }, { hash: 'h2' }],
    titles: [{ text: 'Head A' }],
  })
  assert.deepStrictEqual(out.call_to_action, {
    type: 'LEARN_MORE', value: { link: 'https://westcoaststrength.com/trial' },
  })
})

test('videos carry their poster frame; video-only is SINGLE_VIDEO', () => {
  const out = buildFlexibleCreative(base({
    media: [{ video_id: 9, thumbnail_url: 'https://t/1.jpg' }, { video_id: '10', thumbnail_hash: 'th' }],
  }))
  assert.deepStrictEqual(out.asset_feed_spec.videos, [
    { video_id: '9', thumbnail_url: 'https://t/1.jpg' },
    { video_id: '10', thumbnail_hash: 'th' },
  ])
  assert.deepStrictEqual(out.asset_feed_spec.ad_formats, ['SINGLE_VIDEO'])
  assert.strictEqual(out.asset_feed_spec.images, undefined)
})

test('images and videos together use AUTOMATIC_FORMAT', () => {
  const out = buildFlexibleCreative(base({ media: [{ image_hash: 'h1' }, { video_id: '5', thumbnail_url: 'u' }] }))
  assert.deepStrictEqual(out.asset_feed_spec.ad_formats, ['AUTOMATIC_FORMAT'])
})

test('duplicate media is sent once', () => {
  const out = buildFlexibleCreative(base({ media: [{ image_hash: 'h1' }, { image_hash: 'h1' }, null] }))
  assert.deepStrictEqual(out.asset_feed_spec.images, [{ hash: 'h1' }])
})

test('an Instant Form ad puts the form id in call_to_actions and defaults to SIGN_UP', () => {
  const out = buildFlexibleCreative(base({ lead_gen_form_id: ' 1234567890 ' }))
  const cta = { type: 'SIGN_UP', value: { link: 'https://westcoaststrength.com/trial', lead_gen_form_id: '1234567890' } }
  assert.deepStrictEqual(out.call_to_action, cta)
  assert.deepStrictEqual(out.asset_feed_spec.call_to_actions, [cta])
  assert.deepStrictEqual(out.asset_feed_spec.call_to_action_types, ['SIGN_UP'])
})

test('website ads never carry call_to_actions', () => {
  const out = buildFlexibleCreative(base({ call_to_action: 'BOOK_NOW' }))
  assert.strictEqual(out.asset_feed_spec.call_to_actions, undefined)
  assert.deepStrictEqual(out.asset_feed_spec.call_to_action_types, ['BOOK_NOW'])
})

test('the basics are required', () => {
  const problems = flexibleAdProblems({})
  assert.ok(problems.includes('A Facebook Page is required'))
  assert.ok(problems.includes('A destination link is required'))
  assert.ok(problems.includes('Add at least one image or video'))
  assert.ok(problems.includes('Add at least one primary text'))
})

test('link rules match the single-ad builder', () => {
  assert.ok(flexibleAdProblems(base({ link: 'westcoaststrength.com' })).some(p => /http/.test(p)))
  assert.ok(flexibleAdProblems(base({ link: 'https://facebook.com/wcs', lead_gen_form_id: '1234567' }))
    .some(p => /Facebook Page/.test(p)))
  // A website ad may point anywhere, Facebook included.
  assert.deepStrictEqual(flexibleAdProblems(base({ link: 'https://facebook.com/wcs' })), [])
  assert.ok(flexibleAdProblems(base({ lead_gen_form_id: 'abc' })).some(p => /all digits/.test(p)))
})

test('per-field counts are capped at Meta limits', () => {
  const many = n => Array.from({ length: n }, (_, i) => `t${i}`)
  const tooMany = flexibleAdProblems(base({
    media: many(FLEX_LIMITS.images + 1).map(h => ({ image_hash: h })),
    bodies: many(6), titles: many(6), descriptions: many(6),
  }))
  assert.ok(tooMany.some(p => /at most 10 images/.test(p)))
  assert.ok(tooMany.some(p => /at most 5 primary texts/.test(p)))
  assert.ok(tooMany.some(p => /at most 5 headlines/.test(p)))
  assert.ok(tooMany.some(p => /at most 5 descriptions/.test(p)))

  const videos = many(11).map(v => ({ video_id: v }))
  assert.ok(flexibleAdProblems(base({ media: videos })).some(p => /at most 10 videos/.test(p)))
})

test('the 30-asset ceiling counts format, link and button', () => {
  const many = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i}`)
  // 10 + 2 + 5 + 5 + 5 + 3 fixed = 30: allowed.
  const atCap = base({
    media: [...many(10, 'i').map(h => ({ image_hash: h })), ...many(2, 'v').map(v => ({ video_id: v }))],
    bodies: many(5, 'b'), titles: many(5, 't'), descriptions: many(5, 'd'),
  })
  assert.deepStrictEqual(flexibleAdProblems(atCap), [])
  // One more video tips it over.
  const over = { ...atCap, media: [...atCap.media, { video_id: 'v9' }] }
  assert.ok(flexibleAdProblems(over).some(p => /caps one ad at 30/.test(p)))
})

test('text length hard limits', () => {
  const long = n => 'x'.repeat(n)
  assert.deepStrictEqual(flexibleAdProblems(base({ bodies: [long(1024)], titles: [long(255)], descriptions: [long(255)] })), [])
  const over = flexibleAdProblems(base({ bodies: [long(1025)], titles: [long(256)], descriptions: [long(256)] }))
  assert.strictEqual(over.length, 3)
})

test('buildFlexibleCreative throws every problem at once', () => {
  assert.throws(() => buildFlexibleCreative({}), err => {
    assert.ok(Array.isArray(err.problems) && err.problems.length >= 4)
    return true
  })
})

test('adsetProblem only allows an empty Dynamic Creative ad set', () => {
  assert.match(adsetProblem({ is_dynamic_creative: false }, 0, false), /not created for/)
  assert.match(adsetProblem({}, 0, false), /not created for/)
  assert.match(adsetProblem({ is_dynamic_creative: true }, 1, false), /already has its ad/)
  assert.strictEqual(adsetProblem({ is_dynamic_creative: true }, 0, false), null)
})

test('adsetProblem needs ON_AD for form ads only', () => {
  assert.match(adsetProblem({ is_dynamic_creative: true, destination_type: 'WEBSITE' }, 0, true), /Instant Form/)
  assert.strictEqual(adsetProblem({ is_dynamic_creative: true, destination_type: 'ON_AD' }, 0, true), null)
  assert.strictEqual(adsetProblem({ is_dynamic_creative: true, destination_type: 'WEBSITE' }, 0, false), null)
})
