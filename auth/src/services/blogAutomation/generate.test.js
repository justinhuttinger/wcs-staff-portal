const test = require('node:test')
const assert = require('node:assert')
const g = require('./generate')

test('slugify lowercases, strips punctuation, hyphenates', () => {
  assert.equal(g.slugify('Best Compound Exercises (2026)!'), 'best-compound-exercises-2026')
})

test('buildFaqBlock emits the schema-faq markup the theme parses, with each Q and A', () => {
  const html = g.buildFaqBlock([{ q: 'How often?', a: 'Three times a week.' }])
  assert.match(html, /class="schema-faq"/)
  assert.match(html, /<h3 class="schema-faq-question">How often\?<\/h3>/)
  assert.match(html, /<p class="schema-faq-answer">Three times a week\.<\/p>/)
  // Yoast is gone from the site; its block wrapper would just be dead markup now.
  assert.doesNotMatch(html, /yoast/i)
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

test('buildLinkCandidates includes location page, site links, and related posts (deduped)', () => {
  const loc = require('./config').getLocation('Salem')
  const related = [
    { title: 'Post A', wp_url: 'https://westcoaststrength.com/post-a/' },
    { title: 'No URL', wp_url: null },                                  // dropped
    { title: 'The Gym dup', wp_url: 'https://westcoaststrength.com/the-gym/' }, // dedup vs SITE_LINKS
  ]
  const urls = g.buildLinkCandidates(loc, related).map(c => c.url)
  assert.ok(urls.includes('https://westcoaststrength.com/salem/'), 'has location page')
  assert.ok(urls.includes('https://westcoaststrength.com/training/'), 'has training page')
  assert.ok(urls.includes('https://westcoaststrength.com/post-a/'), 'has related post')
  assert.ok(!urls.includes(null), 'drops posts with no url')
  assert.equal(new Set(urls.map(u => u.replace(/\/+$/, ''))).size, urls.length, 'no duplicate urls')
})

test('sanitizeInternalLinks keeps allow-listed links and strips the rest to text', () => {
  const allowed = ['https://westcoaststrength.com/training/']
  const html = '<p>Try <a href="https://westcoaststrength.com/training/">our coaching</a> ' +
    'and <a href="https://evil.example.com/spam">this</a> and ' +
    '<a href="https://westcoaststrength.com/made-up-page">made up</a>.</p>'
  const out = g.sanitizeInternalLinks(html, allowed)
  assert.match(out, /<a href="https:\/\/westcoaststrength\.com\/training\/">our coaching<\/a>/)
  assert.doesNotMatch(out, /evil\.example\.com/)
  assert.doesNotMatch(out, /made-up-page/)
  assert.match(out, /and this and/)   // disallowed anchors unwrapped to their text
  assert.match(out, /made up\./)
})

test('sanitizeInternalLinks matches regardless of trailing slash', () => {
  const out = g.sanitizeInternalLinks(
    '<a href="https://westcoaststrength.com/salem">Salem</a>',
    ['https://westcoaststrength.com/salem/'])
  assert.match(out, /<a href=/, 'trailing-slash mismatch should still be allowed')
})

test('generatePost strips links the model invents but keeps allow-listed ones', async () => {
  const fakeText = async ({ prompt }) => {
    if (/outline/i.test(prompt)) return JSON.stringify({
      title: 'Strength Basics in Salem', metaDescription: 'A practical strength guide for Salem lifters who want real, lasting results from smart training and steady, simple habits that work.',
      focusKeyword: 'strength Salem', excerpt: 'Build strength.', headings: ['Compounds'],
      faq: [{ q: 'Q', a: 'A' }], takeaways: ['Lift'],
    })
    return JSON.stringify({
      intro: '<p>Train at <a href="https://westcoaststrength.com/salem/">WCS Salem</a>.</p>',
      sections: [{ heading: 'Compounds', html: '<p>See <a href="https://random-site.com/x">this guide</a>.</p>' }],
      ctaHtml: '<p>Book a <a href="https://westcoaststrength.com/contact/">free trial</a>.</p>',
    })
  }
  const loc = require('./config').getLocation('Salem')
  const post = await g.generatePost({ location: loc, category: 'fitness-tips', topic: 'Strength' },
    { generateText: fakeText })
  assert.match(post.contentHtml, /href="https:\/\/westcoaststrength\.com\/salem\/"/)
  assert.match(post.contentHtml, /href="https:\/\/westcoaststrength\.com\/contact\/"/)
  assert.doesNotMatch(post.contentHtml, /random-site\.com/)
  assert.match(post.contentHtml, /See this guide\./)  // invented link unwrapped
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
  assert.match(html, /class="schema-faq"/)
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
  assert.match(post.contentHtml, /class="schema-faq"/)
  assert.equal(post.faq.length, 1)
})

test('filterLivePosts drops related posts whose URL is gone', async () => {
  const fakeFetch = async (url) => ({ status: url.includes('gone') ? 404 : 200 })
  const out = await g.filterLivePosts([
    { title: 'Live', wp_url: 'https://westcoaststrength.com/live-post/' },
    { title: 'Wiped by the launch', wp_url: 'https://westcoaststrength.com/gone-post/' },
    { title: 'No URL', wp_url: null },
  ], { fetch: fakeFetch })
  assert.deepEqual(out.map(p => p.title), ['Live'])
})

test('filterLivePosts keeps a post it cannot check (network failure is not proof)', async () => {
  const fakeFetch = async () => { throw new Error('ETIMEDOUT') }
  const out = await g.filterLivePosts([{ title: 'Live', wp_url: 'https://westcoaststrength.com/live-post/' }],
    { fetch: fakeFetch })
  assert.equal(out.length, 1)
})
