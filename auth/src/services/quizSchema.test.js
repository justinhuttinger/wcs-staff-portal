const test = require('node:test')
const assert = require('node:assert/strict')
const q = require('./quizSchema')

const FORM = {
  title: 'Find Your Fit', slug: 'find-your-fit-k3x9', description: 'Intro',
  schema: [
    { id: 'f_goal', type: 'radio', label: "What's your main goal?", options: ['Lose weight', 'Build muscle'], required: true },
    { id: 'f_days', type: 'checkbox', label: 'Which days work?', options: ['Mon', 'Wed', 'Fri'] },
    { id: 'f_note', type: 'short_text', label: 'Anything else?' },
  ],
  settings: { tracking: { meta_pixel_id: '820682157231470', gtm_id: 'GTM-N4BRPV65' } },
}

test('snippet: parses the GHL script tag, even across lines with extra attrs', () => {
  const r = q.parseGhlTrackingSnippet(`<script
    src="https://link.westcoaststrength.com/js/external-tracking.js"
    data-tracking-id="tk_0123456789abcdef0123456789abcdef" async></script>`)
  assert.equal(r.ok, true)
  assert.equal(r.src, 'https://link.westcoaststrength.com/js/external-tracking.js')
  assert.equal(r.trackingId, 'tk_0123456789abcdef0123456789abcdef')
})

test('snippet: blank clears', () => {
  assert.deepEqual(q.parseGhlTrackingSnippet('  '), { ok: true, src: null, trackingId: null })
})

test('snippet: rejects http, foreign host, wrong path, bad id, missing parts', () => {
  const id = 'data-tracking-id="tk_0123456789abcdef"'
  assert.equal(q.parseGhlTrackingSnippet(`<script src="http://link.msgsndr.com/js/external-tracking.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://evil.com/js/external-tracking.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://msgsndr.com.evil.com/js/external-tracking.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://link.msgsndr.com/js/other.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://link.msgsndr.com/js/external-tracking.js" data-tracking-id="nope">`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet('tk_0123456789abcdef').ok, false)
})

test('webhook url: https only, blank allowed', () => {
  assert.deepEqual(q.validateWebhookUrl(''), { ok: true, url: null })
  assert.equal(q.validateWebhookUrl('http://x.com/h').ok, false)
  assert.equal(q.validateWebhookUrl('not a url').ok, false)
  assert.equal(q.validateWebhookUrl('https://services.leadconnectorhq.com/hooks/a/b').ok, true)
})

test('settings: defaults fill gaps; tracking ids validated; redirect https only', () => {
  const d = q.quizSettingsWithDefaults(null)
  assert.equal(d.contact_step.require_phone, true)
  assert.equal(q.normalizeQuizSettings({ tracking: { meta_pixel_id: 'abc' } }, {}).ok, false)
  assert.equal(q.normalizeQuizSettings({ tracking: { gtm_id: 'gtm-12' } }, {}).ok, false)
  const ok = q.normalizeQuizSettings({ tracking: { meta_pixel_id: ' 123456 ', gtm_id: 'gtm-abc123' } }, {})
  assert.deepEqual(ok.settings.tracking, { meta_pixel_id: '123456', gtm_id: 'GTM-ABC123' })
  assert.equal(q.normalizeQuizSettings({ thank_you: { redirect_url: 'http://x.com' } }, {}).ok, false)
  // untouched sections keep existing values
  const kept = q.normalizeQuizSettings({ thank_you: { heading: 'Hi' } }, { tracking: { gtm_id: 'GTM-KEEP1' } })
  assert.equal(kept.settings.tracking.gtm_id, 'GTM-KEEP1')
})

test('contact: email always required; phone normalized; required flags honored', () => {
  const step = { require_first_name: true, require_last_name: false, require_phone: true }
  const bad = q.validateContact({ email: 'x', phone: '123' }, step)
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.first_name && bad.errors.email && bad.errors.phone)
  const good = q.validateContact({ first_name: ' Jane ', email: 'Jane@X.com', phone: '1-503-555-0101' }, step)
  assert.equal(good.ok, true)
  assert.deepEqual(good.cleaned, { first_name: 'Jane', email: 'jane@x.com', phone: '(503) 555-0101' })
  assert.equal(q.validateContact({ first_name: 'J', email: 'j@x.co' }, { ...step, require_phone: false }).ok, true)
})

test('payload: answers keyed by question, checkbox joined, blanks empty, duplicate labels suffixed', () => {
  const form = { ...FORM, schema: [...FORM.schema, { id: 'f_dup', type: 'short_text', label: 'Anything else?' }] }
  const p = q.buildWebhookPayload({
    form, clubName: 'Salem',
    submission: { id: 's1', submitted_at: '2026-09-25T18:00:00.000Z', utm: { utm_source: 'meta' },
      data: { f_goal: 'Lose weight', f_days: ['Mon', 'Fri'], f_dup: 'x', club: 'Salem', first_name: 'Jane', email: 'j@x.com' } },
  })
  assert.equal(p.event, 'quiz_submission')
  assert.equal(p.club_slug, 'salem')
  assert.equal(p.page_url, 'https://forms.westcoaststrength.com/q/salem/find-your-fit-k3x9')
  assert.deepEqual(p.answers, {
    "What's your main goal?": 'Lose weight', 'Which days work?': 'Mon, Fri',
    'Anything else?': '', 'Anything else? (2)': 'x',
  })
  assert.equal(p.questions.length, 4)
  assert.equal(p.last_name, '')
  assert.equal(p.utm_source, 'meta')
  assert.equal(p.test, false)
})

test('sample submission satisfies every question type', () => {
  const s = q.sampleSubmission(FORM)
  assert.equal(s.data.f_goal, 'Lose weight')
  assert.deepEqual(s.data.f_days, ['Mon', 'Wed'])
  assert.equal(s.data.email, 'test@example.com')
})

test('public view: questions only, tracking shaped, never the webhook url', () => {
  const form = { ...FORM, schema: [{ id: 'f_h', type: 'header', label: 'X' }, ...FORM.schema] }
  const club = { ghl_webhook_url: 'https://secret', ghl_tracking_src: 'https://link.msgsndr.com/js/external-tracking.js', ghl_tracking_id: 'tk_0123456789' }
  const v = q.publicQuizView(form, { id: 'L1', name: 'Salem' }, club)
  assert.equal(JSON.stringify(v).includes('secret'), false)
  assert.equal(v.schema.length, 3)
  assert.equal(v.club_slug, 'salem')
  assert.deepEqual(v.tracking, {
    ghl: { src: club.ghl_tracking_src, tracking_id: 'tk_0123456789' },
    meta_pixel_id: '820682157231470', gtm_id: 'GTM-N4BRPV65',
  })
  assert.equal(q.publicQuizView(form, { id: 'L1', name: 'Salem' }, {}).tracking.ghl, null)
})

test('club slugs are the 7 clubs', () => {
  assert.deepEqual(q.CLUB_SLUGS, ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford'])
})

test('clubRowsView merges locations with saved rows', () => {
  const rows = q.clubRowsView(
    [{ id: 'L1', name: 'Salem' }, { id: 'L2', name: 'Keizer' }],
    [{ location_id: 'L1', active: true, ghl_webhook_url: 'https://h', ghl_tracking_id: 'tk_1', ghl_tracking_src: 's' }],
    FORM)
  assert.equal(rows[0].active, true)
  assert.equal(rows[0].url, 'https://forms.westcoaststrength.com/q/salem/find-your-fit-k3x9')
  assert.equal(rows[1].active, false)
  assert.equal(rows[1].ghl_webhook_url, '')
})

test('planClubUpserts validates and keeps tracking unless a snippet is sent', () => {
  const locs = [{ id: 'L1', name: 'Salem' }]
  const existing = [{ location_id: 'L1', ghl_tracking_src: 'https://old', ghl_tracking_id: 'tk_old' }]
  const keep = q.planClubUpserts('F', [{ location_id: 'L1', active: true, ghl_webhook_url: 'https://h' }], existing, locs)
  assert.equal(keep.ok, true)
  assert.equal(keep.rows[0].ghl_tracking_id, 'tk_old')
  const cleared = q.planClubUpserts('F', [{ location_id: 'L1', active: false, ghl_tracking_snippet: '' }], existing, locs)
  assert.equal(cleared.rows[0].ghl_tracking_id, null)
  assert.match(q.planClubUpserts('F', [{ location_id: 'L1', ghl_webhook_url: 'http://h' }], [], locs).error, /^Salem: /)
  assert.equal(q.planClubUpserts('F', [{ location_id: 'NOPE' }], [], locs).ok, false)
})

test('resolveGhlTracking: quiz override wins, else club default, else null', () => {
  const override = { ghl_tracking_src: 'https://a/js/external-tracking.js', ghl_tracking_id: 'tk_override1' }
  const def = { ghl_tracking_src: 'https://b/js/external-tracking.js', ghl_tracking_id: 'tk_default1' }
  assert.deepEqual(q.resolveGhlTracking(override, def), { src: override.ghl_tracking_src, tracking_id: 'tk_override1' })
  assert.deepEqual(q.resolveGhlTracking({}, def), { src: def.ghl_tracking_src, tracking_id: 'tk_default1' })
  assert.equal(q.resolveGhlTracking({}, null), null)
  assert.equal(q.resolveGhlTracking(null, { ghl_tracking_id: 'tk_x' }), null)
})

test('clubRowsView shows the club default tracking id', () => {
  const rows = q.clubRowsView([{ id: 'L1', name: 'Salem' }], [], { slug: 's' }, { salem: { ghl_tracking_id: 'tk_def' } })
  assert.equal(rows[0].default_tracking_id, 'tk_def')
  assert.equal(q.clubRowsView([{ id: 'L1', name: 'Salem' }], [], { slug: 's' })[0].default_tracking_id, '')
})

test('publicQuizView uses the club default when the quiz has no override', () => {
  const v = q.publicQuizView({ slug: 's', title: 'T', schema: [] }, { id: 'L1', name: 'Salem' }, {},
    { ghl_tracking_src: 'https://link.msgsndr.com/js/external-tracking.js', ghl_tracking_id: 'tk_def12345' })
  assert.deepEqual(v.tracking.ghl, { src: 'https://link.msgsndr.com/js/external-tracking.js', tracking_id: 'tk_def12345' })
})

test('trackingByClub keeps only clubs with a complete snippet', () => {
  const src = 'https://link.msgsndr.com/js/external-tracking.js'
  assert.deepEqual(q.trackingByClub({
    salem: { location_slug: 'salem', ghl_tracking_src: src, ghl_tracking_id: 'tk_salem123' },
    keizer: { location_slug: 'keizer', ghl_tracking_src: null, ghl_tracking_id: null },
    portland: { location_slug: 'portland', ghl_tracking_src: src, ghl_tracking_id: 'tk_nope1234' },
  }), { salem: { src, tracking_id: 'tk_salem123' } })
  assert.deepEqual(q.trackingByClub(null), {})
})
