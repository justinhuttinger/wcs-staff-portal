const test = require('node:test')
const assert = require('node:assert')
const { emailName, pickSubject, renderEmailHtml, renderSubject, clubValues, imageFiles } = require('./workflowEmails')

test('custom value names per group', () => {
  assert.equal(emailName({ group: 'New leads', order: 3 }), 'New Lead Email 3')
  assert.equal(emailName({ group: 'Free pass', order: 5 }), 'Free Pass Email 5')
  assert.equal(emailName({ group: 'New member', order: 1 }), 'New Member Email 1')
  assert.equal(emailName({ group: 'Check-in milestones', order: 3, slug: 'milestone-050' }), 'Check In 50 Email')
})

test('picks the starred subject line', () => {
  assert.deepEqual(pickSubject('A | a\n*B | b preview\nC | c'), { subject: 'B', preview: 'b preview' })
  assert.deepEqual(pickSubject('Only | one'), { subject: 'Only', preview: 'one' })
})

const HTML = `<!--[if mso]><v:rect href="[[tour_booking_link]]"></v:rect><![endif]-->
<a href="[[tour_booking_link]]" style="x">Book</a> at [[club_name]] <img src="images/hero.jpg" alt="x"><img src="images/badge-white.png" alt="y">`

test('fills links (tagged), text and image URLs', () => {
  const r = renderEmailHtml(HTML, { tour_booking_link: 'https://t.com/a?x=1&y=2', club_name: 'WCS <Salem>' }, { 'hero.jpg': 'https://cdn/h.jpg' })
  assert.ok(r.html.includes('<v:rect href="https://t.com/a?x=1&amp;y=2">'))
  assert.ok(r.html.includes('<a href="https://t.com/a?x=1&amp;y=2" data-wcs-link="tour_booking_link" style="x">'))
  assert.ok(r.html.includes('at WCS &lt;Salem&gt;'))
  assert.ok(r.html.includes('src="https://cdn/h.jpg"'))
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.unhosted, ['badge-white.png'])
})

test('reports missing values and leaves their placeholders', () => {
  const r = renderEmailHtml(HTML, { club_name: 'WCS Salem' })
  assert.deepEqual(r.missing, ['tour_booking_link'])
  assert.ok(r.html.includes('[[tour_booking_link]]'))
  assert.deepEqual(renderSubject('Welcome to [[club_name]]', {}).missing, ['club_name'])
})

test('club values merge defaults and expand {club}', () => {
  const v = clubValues({ defaults: { tour_booking_link: 'https://x/{club}-tour', vip_reward: 'a' }, clubs: { milwaukie: { vip_reward: 'b' } } }, 'milwaukie')
  assert.deepEqual(v, { tour_booking_link: 'https://x/milwaukie-tour', vip_reward: 'b' })
  assert.deepEqual(imageFiles(HTML), ['hero.jpg', 'badge-white.png'])
})
