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
