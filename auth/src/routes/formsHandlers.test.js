const test = require('node:test')
const assert = require('node:assert/strict')

// formsHandlers requires services/supabase at import; give it dummy env so the
// client constructs without network (it's never called by these pure tests).
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'
const { kindMatches, normalizeSettings } = require('./formsHandlers')

test('kindMatches isolates forms from quizzes; legacy rows count as forms', () => {
  assert.equal(kindMatches({ kind: 'quiz' }, 'quiz'), true)
  assert.equal(kindMatches({ kind: 'quiz' }, 'form'), false)
  assert.equal(kindMatches({ kind: 'form' }, 'quiz'), false)
  assert.equal(kindMatches({}, 'form'), true)
  assert.equal(kindMatches(null, 'form'), false)
})

test('normalizeSettings keeps the form-only keys', () => {
  assert.deepEqual(normalizeSettings({ success_message: ' hi ', allow_resubmit: 1, x: 2 }).settings,
    { success_message: 'hi', allow_resubmit: true })
})

test('auditKindScope: forms exclude quiz ids (deleted forms stay visible); quizzes include them', () => {
  const { auditKindScope } = require('./formsHandlers')
  assert.deepEqual(auditKindScope('form', ['q1', 'q2']), { mode: 'exclude', ids: ['q1', 'q2'] })
  assert.deepEqual(auditKindScope('form', []), { mode: 'all', ids: [] })
  assert.deepEqual(auditKindScope('quiz', ['q1']), { mode: 'include', ids: ['q1'] })
  assert.deepEqual(auditKindScope('quiz', []), { mode: 'none', ids: [] })
})
