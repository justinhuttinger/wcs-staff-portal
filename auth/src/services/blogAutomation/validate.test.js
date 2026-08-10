const test = require('node:test')
const assert = require('node:assert')
const v = require('./validate')
const loc = require('./config').getLocation('Salem')

const goodPost = {
  title: 'Strength Training Basics in Salem',
  metaDescription: 'A practical guide to building strength in Salem, Oregon, with simple steps for beginners and a proven plan you can start this week now at your local gym here.',
  focusKeyword: 'strength training Salem',
  contentHtml: '<p>Intro about Salem.</p>'.repeat(2) + '<h2>Section</h2>' + '<p>word </p>'.repeat(450) + '<!-- wp:yoast/faq-block --><div class="schema-faq">Salem</div>',
  faq: [{ q: 'How often?', a: 'About three times a week.' }],
}

test('a well-formed post passes programmatic checks', () => {
  const r = v.validateProgrammatic(goodPost, loc)
  assert.equal(r.ok, true, JSON.stringify(r.failures))
})

test('missing FAQ fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, contentHtml: '<p>no faq here, '.repeat(450) + '</p>', faq: [] }, loc)
  assert.equal(r.ok, false)
  assert.ok(r.failures.some(f => /faq/i.test(f)))
})

test('em-dash in content fails (brand rule)', () => {
  const r = v.validateProgrammatic({ ...goodPost, contentHtml: goodPost.contentHtml + '<p>strength — power</p>' }, loc)
  assert.ok(r.failures.some(f => /em-dash/i.test(f)))
})

test('a genuinely thin meta description fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, metaDescription: 'too short' }, loc)
  assert.ok(r.failures.some(f => /meta/i.test(f)))
})

test('a slightly short meta description passes', () => {
  // The real Salem skip: 139 characters, under the old 150 floor, and fine.
  const md = 'Build real strength at West Coast Strength in Salem, Oregon, with simple weekly steps that work for beginners and seasoned lifters.'
  assert.ok(md.length >= 120 && md.length < 150, `fixture is ${md.length} chars`)
  const r = v.validateProgrammatic({ ...goodPost, metaDescription: md }, loc)
  assert.equal(r.ok, true, JSON.stringify(r.failures))
})

test('an over-long meta description still fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, metaDescription: 'x'.repeat(v.MAX_META + 1) }, loc)
  assert.ok(r.failures.some(f => /meta/i.test(f)))
})

test('location not named fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, contentHtml: '<p>generic '.repeat(450) + '</p><!-- wp:yoast/faq-block -->' }, loc)
  assert.ok(r.failures.some(f => /location|Salem/i.test(f)))
})

test('validatePost combines programmatic + injected critique', async () => {
  const fakeCritique = async () => JSON.stringify({ score: 9, issues: [] })
  const r = await v.validatePost(goodPost, loc, { generateText: fakeCritique })
  assert.equal(r.ok, true)
  assert.equal(r.report.critique.score, 9)
})

test('validatePost fails when critique scores low', async () => {
  const fakeCritique = async () => JSON.stringify({ score: 4, issues: ['off-brand', 'thin'] })
  const r = await v.validatePost(goodPost, loc, { generateText: fakeCritique })
  assert.equal(r.ok, false)
})
