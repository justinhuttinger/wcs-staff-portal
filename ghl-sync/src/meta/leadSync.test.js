const test = require('node:test')
const assert = require('node:assert/strict')
const { syncMetaLeads, discoverForms, parseLead } = require('./leadSync')

const NOW = Date.parse('2026-09-30T20:00:00Z')

test('parseLead reads either phone field name and normalizes', () => {
  const row = parseLead({
    id: 111, created_time: '2026-09-29T18:00:00+0000', ad_id: '52580905991305', campaign_id: '9',
    field_data: [
      { name: 'EMAIL', values: ['Jess@Example.com '] },
      { name: 'phone', values: ['+1 (541) 840-4182'] },
      { name: 'first_name', values: ['Jess'] },
      { name: 'last_name', values: ['Cruz'] },
    ],
  }, '855532877051264', '714192551786317')
  assert.deepEqual(row, {
    lead_id: '111', form_id: '855532877051264', page_id: '714192551786317',
    ad_id: '52580905991305', campaign_id: '9', created_time: '2026-09-29T18:00:00.000Z',
    email: 'jess@example.com', phone: '5418404182', first_name: 'Jess', last_name: 'Cruz',
  })
  const other = parseLead({ id: 2, created_time: '2026-09-29T18:00:00+0000', field_data: [
    { name: 'phone_number', values: ['5035551234'] }, { name: 'full_name', values: ['Sam Lee Jones'] },
    { name: 'email', values: ['not-an-email'] },
  ] }, 'f', null)
  assert.equal(other.phone, '5035551234')
  assert.equal(other.email, null)
  assert.equal(other.first_name, 'Sam')
  assert.equal(other.last_name, 'Lee Jones')
})

// Graph stand-in: ads list + per-form leads, with paging on the ads list.
function fakeGraph({ ads, leadsByForm, denied = [] }) {
  const calls = []
  const graph = async (path, params) => {
    calls.push({ path, params })
    if (path === 'NEXT_ADS') return { data: ads.slice(1) }
    if (path.endsWith('/ads')) return { data: ads.slice(0, 1), paging: { next: ads.length > 1 ? 'NEXT_ADS' : undefined } }
    const form = path.split('/')[0]
    if (denied.includes(form)) { const e = new Error('Object does not exist'); e.code = 100; throw e }
    return { data: leadsByForm[form] || [] }
  }
  graph.calls = calls
  return graph
}

const adWithForm = (form, page) => ({ creative: { object_story_spec: { page_id: page, link_data: { call_to_action: { value: { lead_gen_form_id: form } } } } } })

test('forms are discovered from ad creatives, across pages of ads', async () => {
  const graph = fakeGraph({ ads: [adWithForm('1001', '2001'), adWithForm('1002', '2002'), { creative: {} }, adWithForm('1001', '2001')], leadsByForm: {} })
  const forms = await discoverForms(graph, 'act_1')
  assert.deepEqual([...forms.entries()], [['1001', '2001'], ['1002', '2002']])
})

function fakeDb(existing = {}) {
  const upserts = []
  return {
    upserts,
    from: () => {
      let form = null
      const b = {
        select: () => b,
        eq: (_c, v) => { form = v; return b },
        order: () => b,
        limit: () => Promise.resolve({ data: existing[form] ? [{ created_time: existing[form] }] : [], error: null }),
        upsert: rows => { upserts.push(...rows); return Promise.resolve({ error: null }) },
      }
      return b
    },
  }
}

test('sync reads each form from its newest stored lead, skips unreadable forms', async () => {
  const lead = { id: 'L1', created_time: '2026-09-30T10:00:00+0000', field_data: [{ name: 'email', values: ['a@b.co'] }] }
  const graph = fakeGraph({
    ads: [adWithForm('1001', '2001'), adWithForm('1002', '2002'), adWithForm('1009', '107206126273')],
    leadsByForm: { 1001: [lead], 1002: [] },
    denied: ['1009'],
  })
  const db = fakeDb({ 1002: '2026-09-29T00:00:00.000Z' })
  const s = await syncMetaLeads({ db, graph, nowMs: NOW, accountId: 'act_1' })
  assert.equal(s.forms, 3)
  assert.equal(s.readable, 2)
  assert.equal(s.leads, 1)
  assert.equal(s.skipped.length, 1)
  assert.equal(s.skipped[0].pageId, '107206126273')
  assert.equal(db.upserts[0].lead_id, 'L1')

  const since = f => graph.calls.find(c => c.path === `${f}/leads`).params.filtering[0].value
  // 1001 has nothing stored: the default lookback.
  assert.equal(since('1001'), Math.floor(NOW / 1000) - 120 * 86400)
  // 1002 resumes from its newest stored lead, less an hour of overlap.
  assert.equal(since('1002'), Math.floor(Date.parse('2026-09-29T00:00:00Z') / 1000) - 3600)
})
