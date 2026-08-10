const test = require('node:test')
const assert = require('node:assert')
const wp = require('./wordpress')

test('buildPostPayload sets publish status, category, tag, media, Yoast meta', () => {
  const post = { title: 'T', contentHtml: '<p>body</p>', excerpt: 'E',
    metaDescription: 'M', focusKeyword: 'K', slug: 't-slug' }
  const payload = wp.buildPostPayload(post, { tagId: 11, categoryId: 22, mediaId: 33 })
  assert.equal(payload.status, 'publish')
  assert.equal(payload.content, '<p>body</p>')
  assert.equal(payload.slug, 't-slug')
  assert.deepEqual(payload.tags, [11])
  assert.deepEqual(payload.categories, [22])
  assert.equal(payload.featured_media, 33)
  assert.equal(payload.meta._yoast_wpseo_metadesc, 'M')
  assert.equal(payload.meta._yoast_wpseo_focuskw, 'K')
})

test('buildPostPayload omits featured_media when no image', () => {
  const payload = wp.buildPostPayload({ title: 'T', contentHtml: '<p>b</p>' }, { tagId: 1, categoryId: 2, mediaId: null })
  assert.ok(!('featured_media' in payload))
})

// Queued fake fetch: returns scripted responses in order, recording each request.
function fakeFetch(responses) {
  const calls = []
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts })
    const r = responses.shift()
    return { ok: r.ok, status: r.status || (r.ok ? 200 : 400), json: async () => r.json, text: async () => JSON.stringify(r.json) }
  }
  return { fetch, calls }
}

test('getOrCreateTag recovers existing id when create returns term_exists', async () => {
  const { fetch, calls } = fakeFetch([
    { ok: true, json: [] },                                          // search: no match surfaced
    { ok: false, status: 400, json: { code: 'term_exists', data: { term_id: 543 } } }, // create: duplicate
  ])
  const id = await wp.getOrCreateTag('Salem', { fetch })
  assert.equal(id, 543)
  assert.equal(calls.length, 2)
})

test('getOrCreateTag falls back to additional_data when term_id absent', async () => {
  const { fetch } = fakeFetch([
    { ok: true, json: [] },
    { ok: false, status: 400, json: { code: 'term_exists', additional_data: [543, 543] } },
  ])
  assert.equal(await wp.getOrCreateTag('Salem', { fetch }), 543)
})

test('uploadMedia sets alt_text via a follow-up media update', async () => {
  const { fetch, calls } = fakeFetch([
    { ok: true, json: { id: 99 } },   // binary upload
    { ok: true, json: {} },           // alt_text update
  ])
  const id = await wp.uploadMedia(Buffer.from('x'), { mimeType: 'image/jpeg' }, 'my-slug', 'My Alt Text', { fetch })
  assert.equal(id, 99)
  assert.equal(calls.length, 2)
  assert.match(calls[1].url, /\/media\/99$/)
  assert.equal(JSON.parse(calls[1].opts.body).alt_text, 'My Alt Text')
})

test('uploadMedia is non-fatal when the alt_text update fails', async () => {
  const { fetch } = fakeFetch([
    { ok: true, json: { id: 99 } },
    { ok: false, status: 500, json: {} }, // alt update errors - must not throw
  ])
  assert.equal(await wp.uploadMedia(Buffer.from('x'), { mimeType: 'image/jpeg' }, 's', 'Alt', { fetch }), 99)
})

test('testConnection reports a redirect as a redirect, not as bad credentials', async () => {
  const fakeFetch = async () => ({
    status: 301, ok: false, headers: { get: () => 'https://westcoaststrength.com/wp-json/wp/v2/users/me' },
  })
  const out = await wp.testConnection({ fetch: fakeFetch })
  assert.equal(out.success, false)
  assert.match(out.error, /301 redirect/)
  assert.match(out.error, /WP_API_URL/)
})

test('testConnection returns the base URL it tried, so a bad env is visible', async () => {
  const fakeFetch = async () => ({ status: 200, ok: true, json: async () => ({ name: 'justin' }) })
  const out = await wp.testConnection({ fetch: fakeFetch })
  assert.equal(out.success, true)
  assert.equal(out.user, 'justin')
  assert.doesNotMatch(out.url, /www\./, 'the default base must not be the redirecting www host')
})
