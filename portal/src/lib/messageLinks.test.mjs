import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findLinks, replaceLink, collectClubLinks, emailPairs, labelForUrl } from './messageLinks.js'

const SMS = "Grab a time here:\n\napi.westcoaststrength.com/widget/bookings/salem-gym-tour\n\nOr finish online: https://join.westcoaststrength.com/salem. Thanks!"

test('finds bare and full URLs in SMS copy and labels them', () => {
  const links = findLinks(SMS)
  assert.deepEqual(links.map(l => [l.url, l.label]), [
    ['api.westcoaststrength.com/widget/bookings/salem-gym-tour', 'Tour booking'],
    ['https://join.westcoaststrength.com/salem', 'Online join'],
  ])
})

const HTML = `<html><body><!--[if mso]><v:rect href="https://x.com/tour?a=1&amp;b=2"></v:rect><![endif]-->
<a href="https://x.com/tour?a=1&amp;b=2" data-wcs-link="tour_booking_link" style="x">Book <b>My Tour</b></a>
<a href="https://join.westcoaststrength.com/salem?promo=half">Join</a><a href="mailto:a@b.com">mail</a></body></html>`

test('email links use data-wcs-link names, decode &amp; and skip mailto', () => {
  const links = findLinks(HTML)
  assert.equal(links.length, 2)
  assert.deepEqual(links[0], { url: 'https://x.com/tour?a=1&b=2', key: 'tour_booking_link', label: 'Tour booking', texts: ['Book My Tour'] })
  assert.equal(links[1].label, 'Join (with offer)')
})

test('replacing a URL hits href, VML and encoded forms, but not longer URLs', () => {
  const out = replaceLink(HTML, 'https://x.com/tour?a=1&b=2', 'https://new.com/t?q=1&r=2')
  assert.equal((out.match(/https:\/\/new\.com\/t\?q=1&amp;r=2/g) || []).length, 2)
  assert.ok(!out.includes('x.com/tour'))
  const sms = 'a https://join.westcoaststrength.com/salem b https://join.westcoaststrength.com/salem?promo=1 c https://join.westcoaststrength.com/salem.'
  assert.equal(replaceLink(sms, 'https://join.westcoaststrength.com/salem', 'J'), 'a J b https://join.westcoaststrength.com/salem?promo=1 c J.')
})

test('club links group uses across values', () => {
  const all = collectClubLinks([{ id: '1', name: 'A', value: SMS }, { id: '2', name: 'B', value: 'https://join.westcoaststrength.com/salem' }])
  assert.equal(all[0].url, 'https://join.westcoaststrength.com/salem')
  assert.deepEqual(all[0].uses.map(u => u.id), ['1', '2'])
})

test('email pairs come from "<Name> Email Subject/HTML"', () => {
  const { pairs, ids } = emailPairs([
    { id: 'a', name: 'New Lead Email 10 HTML' }, { id: 'b', name: 'New Lead Email 2 Subject' },
    { id: 'c', name: 'New Lead Email 2 HTML' }, { id: 'd', name: 'New Lead SMS 1' },
  ])
  assert.deepEqual(pairs.map(p => [p.base, p.subject?.id || null, p.html?.id || null]), [['New Lead Email 2', 'b', 'c'], ['New Lead Email 10', null, 'a']])
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c'])
  assert.equal(labelForUrl('https://example.org').label, 'Link')
})

test('the same page with and without https counts as one link, replaced in both forms', () => {
  const all = collectClubLinks([
    { id: '1', name: 'SMS', value: 'here: api.westcoaststrength.com/widget/bookings/salem-gym-tour ok' },
    { id: '2', name: 'Email', value: '<html><a href="https://api.westcoaststrength.com/widget/bookings/salem-gym-tour">Book</a></html>' },
  ])
  assert.equal(all.length, 1)
  assert.equal(all[0].url, 'https://api.westcoaststrength.com/widget/bookings/salem-gym-tour')
  assert.equal(all[0].uses.length, 2)
  const sms = all[0].variants.reduce((v, x) => replaceLink(v, x, 'https://t.co/new'), 'here: api.westcoaststrength.com/widget/bookings/salem-gym-tour ok')
  assert.equal(sms, 'here: https://t.co/new ok')
})

test('a bare URL is not replaced inside its https form', () => {
  const v = '<a href="https://api.westcoaststrength.com/widget/bookings/salem-gym-tour">x</a> api.westcoaststrength.com/widget/bookings/salem-gym-tour'
  const out = ['api.westcoaststrength.com/widget/bookings/salem-gym-tour', 'https://api.westcoaststrength.com/widget/bookings/salem-gym-tour']
    .reduce((acc, x) => replaceLink(acc, x, 'https://t.co/new'), v)
  assert.equal(out, '<a href="https://t.co/new">x</a> https://t.co/new')
})
