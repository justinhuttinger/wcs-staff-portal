const test = require('node:test')
const assert = require('node:assert/strict')
const { applyReply, afterSend, taskStatusAfterSend } = require('../src/services/hub/personState')
const { buildPrompt } = require('../src/services/followUps/draft')

test('applyReply only on newer reply', () => {
  assert.equal(applyReply({ last_reply_at: '2026-11-10T00:00:00Z' }, { at: Date.parse('2026-11-09'), snippet: 'x' }), null)
  assert.deepEqual(applyReply({ last_reply_at: null }, { at: 1000, snippet: 'hi' }),
    { state: 'replied', last_reply_at: new Date(1000).toISOString(), last_reply_snippet: 'hi', reply_seen: false })
})

test('applyReply ignores no reply at all', () => {
  assert.equal(applyReply({ last_reply_at: null }, null), null)
})

test('afterSend marks the person waiting with the send time', () => {
  const now = '2026-11-16T18:00:00.000Z'
  assert.deepEqual(afterSend({ state: 'replied' }, now), { state: 'waiting', last_sent_at: now })
})

test('first send moves a to-do task to waiting; other statuses stay', () => {
  assert.equal(taskStatusAfterSend('todo'), 'waiting')
  assert.equal(taskStatusAfterSend('waiting'), 'waiting')
  assert.equal(taskStatusAfterSend('done'), 'done')
})

test('buildPrompt ask kind carries the owner note and open slots', () => {
  const p = buildPrompt({ kind: 'ask', project: { recipient_name: 'Sam', recipient_email: 's@x.co', title: 'T', instructions: 'are you free friday' }, history: [], today: '2026-11-16', openSlots: ['Eugene photo'] })
  assert.match(p, /are you free friday/)
  assert.match(p, /Eugene photo/)
})

test('buildPrompt nudge lists what is still owed', () => {
  const p = buildPrompt({ kind: 'nudge', project: { recipient_name: 'Sam', recipient_email: 's@x.co', title: 'T' },
    history: [{ kind: 'initial', sent_at: '2026-11-10T00:00:00Z', body: 'hi' }], today: '2026-11-16', openSlots: ['Keizer copy', 'Eugene photo'] })
  assert.match(p, /Keizer copy/)
  assert.match(p, /Eugene photo/)
})
