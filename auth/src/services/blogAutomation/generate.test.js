const test = require('node:test')
const assert = require('node:assert')
const g = require('./generate')

test('slugify lowercases, strips punctuation, hyphenates', () => {
  assert.equal(g.slugify('Best Compound Exercises (2026)!'), 'best-compound-exercises-2026')
})

test('buildFaqBlock emits Yoast FAQ block markup with each Q and A', () => {
  const html = g.buildFaqBlock([{ q: 'How often?', a: 'Three times a week.' }])
  assert.match(html, /wp:yoast\/faq-block/)
  assert.match(html, /How often\?/)
  assert.match(html, /Three times a week\./)
})

test('parseJsonLoose handles fenced JSON', () => {
  assert.deepEqual(g.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
})

test('clampMetaDescription leaves an in-range description untouched', () => {
  const md = 'Build real strength at West Coast Strength in Salem, Oregon. Simple, practical tips for beginners and beyond to help you train smarter every week.'
  assert.ok(md.length <= 160)
  assert.equal(g.clampMetaDescription(md), md)
})

test('clampMetaDescription trims an over-long description to <=160 at a word boundary', () => {
  // The real Springfield skip: 163 chars, 3 over the limit.
  const md = 'Discover the best compound exercises for building real strength. Tips from West Coast Strength, your local gym in Springfield, Oregon. Start lifting smarter today.'
  assert.equal(md.length, 163)
  const out = g.clampMetaDescription(md)
  assert.ok(out.length <= 160, `expected <=160, got ${out.length}`)
  assert.ok(out.length >= 150, `expected >=150, got ${out.length}`)
  assert.ok(!/\s$/.test(out), 'must not end in whitespace')
  assert.match(out, /\.$/, 'should end with a period')
  // No mid-word cut: everything before the appended period is a prefix of the original.
  assert.ok(md.startsWith(out.replace(/\.$/, '')))
})

test('generatePost clamps an over-long meta description so it passes validation', async () => {
  const fakeText = async ({ prompt }) => {
    if (/outline/i.test(prompt)) return JSON.stringify({
      title: 'Strength Basics in Salem',
      metaDescription: 'Discover the best compound exercises for building real strength. Tips from West Coast Strength, your local gym in Springfield, Oregon. Start lifting smarter today.',
      focusKeyword: 'strength training Salem', excerpt: 'Build strength in Salem.',
      headings: ['Start With Compounds'], faq: [{ q: 'Q', a: 'A' }], takeaways: ['Lift'],
    })
    return JSON.stringify({ sections: [{ heading: 'Start With Compounds', html: '<p>Squat.</p>' }],
      intro: '<p>Strength.</p>', ctaHtml: '<p>Visit.</p>' })
  }
  const loc = require('./config').getLocation('Salem')
  const post = await g.generatePost({ location: loc, category: 'fitness-tips', topic: 'Strength' },
    { generateText: fakeText })
  assert.ok(post.metaDescription.length <= 160, `expected <=160, got ${post.metaDescription.length}`)
})

test('assembleContentHtml includes sections, takeaways, faq, cta in order', () => {
  const html = g.assembleContentHtml({
    intro: '<p>Intro</p>',
    sections: [{ heading: 'Warm Up', html: '<p>warm</p>' }],
    takeaways: ['Rest enough'],
    faq: [{ q: 'Q1', a: 'A1' }],
    ctaHtml: '<p>Come in</p>',
  })
  assert.match(html, /<h2>Warm Up<\/h2>/)
  assert.match(html, /Rest enough/)
  assert.match(html, /wp:yoast\/faq-block/)
  assert.ok(html.indexOf('Warm Up') < html.indexOf('Rest enough'))
})

test('generatePost assembles a post from injected fake model output', async () => {
  const fakeText = async ({ prompt }) => {
    if (/outline/i.test(prompt)) return JSON.stringify({
      title: 'Strength Basics in Salem', metaDescription: 'A practical guide to building strength in Salem for beginners and beyond today.',
      focusKeyword: 'strength training Salem', excerpt: 'Build strength in Salem.',
      headings: ['Start With Compounds', 'Progress Slowly'],
      faq: [{ q: 'How often should I lift?', a: 'About three times a week works for most beginners.' }],
      takeaways: ['Lift compound movements', 'Add weight gradually'],
    })
    return JSON.stringify({ sections: [
      { heading: 'Start With Compounds', html: '<p>Squat, hinge, push, pull.</p>' },
      { heading: 'Progress Slowly', html: '<p>Add a little each week.</p>' },
    ], intro: '<p>Strength is built over time.</p>', ctaHtml: '<p>Visit West Coast Strength Salem.</p>' })
  }
  const loc = require('./config').getLocation('Salem')
  const post = await g.generatePost({ location: loc, category: 'fitness-tips', topic: 'Strength basics' },
    { generateText: fakeText })
  assert.equal(post.title, 'Strength Basics in Salem')
  assert.equal(post.slug, 'strength-basics-in-salem')
  assert.match(post.contentHtml, /<h2>Start With Compounds<\/h2>/)
  assert.match(post.contentHtml, /wp:yoast\/faq-block/)
  assert.equal(post.faq.length, 1)
})
