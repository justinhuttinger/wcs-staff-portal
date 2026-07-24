// auth/src/services/meetingNotes/summarize.test.js
const test = require('node:test')
const assert = require('node:assert')
const { buildPrompt } = require('./summarize')

test('condense prompt asks for 5-7 high-level bullets and bans em-dashes', () => {
  const p = buildPrompt({ meeting: 'Corporate Operations', overview: 'ov', takeaways: '- a\n- b' })
  assert.match(p, /5 to 7 short, high-level bullets/)
  assert.match(p, /Do NOT use em-dashes/)
  assert.match(p, /Only condense what is given/)
  assert.match(p, /- a\n- b/) // the takeaways are embedded
})
