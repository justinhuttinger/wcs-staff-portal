const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isFileUrl, voicemailKeys, keepClubRecordings, makeIsAlive } = require('./ghlWorkflowVoicemail')

const U = (loc, f) => `https://storage.googleapis.com/highlevel-backend.appspot.com/location/${loc}/workflow/w/${f}.mp3?alt=media&token=t`

// Shape of the real "Voicemail Drop/SMS Automation" chain:
// <branch> if_else > yes > NO ANSWER if_else > yes > voicemail
function chain(prefix, branches) {
  const t = []
  branches.forEach(([branch, file], i) => {
    const b = `${prefix}b${i}`
    t.push({ id: b, type: 'if_else', name: branch, parentKey: null, order: i * 10 })
    t.push({ id: `${b}y`, type: 'if_else', name: 'yes', parentKey: b, order: i * 10 + 1 })
    t.push({ id: `${b}n`, type: 'if_else', name: 'NO ANSWER', parentKey: `${b}y`, order: i * 10 + 2 })
    t.push({ id: `${b}ny`, type: 'if_else', name: 'yes', parentKey: `${b}n`, order: i * 10 + 3 })
    if (file) t.push({ id: `${b}v`, type: 'voicemail', name: 'Voicemail', parentKey: `${b}ny`, order: i * 10 + 4, attributes: { attachment: { url: file.url, name: file.name, size: 1 } } })
  })
  return { workflowData: { templates: t } }
}

test('isFileUrl', () => {
  assert.equal(isFileUrl(U('L', 'a')), true)
  assert.equal(isFileUrl('https://firebasestorage.googleapis.com/v0/b/x'), true)
  assert.equal(isFileUrl('https://example.com/a.mp3'), false)
  assert.equal(isFileUrl(null), false)
})

test('voicemailKeys names steps by their branch, skipping generic if/else names', () => {
  const wf = chain('s', [['New Lead 1', { url: U('S', '1'), name: 'a' }], ['Trial Expired 2', { url: U('S', '2'), name: 'b' }]])
  assert.deepEqual([...voicemailKeys(wf.workflowData.templates).values()], ['new lead 1', 'trial expired 2'])
})

test('overwrite keeps the club recording, restores dead ones from a backup, else keeps the source', async () => {
  const pushed = chain('s', [
    ['New Lead 1', { url: U('SALEM', 'lead1'), name: 'New Lead VM.mp3' }],
    ['New Lead 2', { url: U('SALEM', 'lead2'), name: 'Lead 2.mp3' }],
    ['Missed Tour', { url: U('SALEM', 'tour'), name: 'Missed Tour Call 1.mp3' }],
  ])
  // Live now: lead 1 is the club's own (works); lead 2 was broken by an old push.
  const current = chain('e', [
    ['New Lead 1', { url: U('EUGENE', 'mine1'), name: 'V_m to lead #1.mp3' }],
    ['New Lead 2', { url: U('EUGENE', 'broken'), name: 'Lead 2.mp3' }],
  ])
  const backup = chain('e', [['New Lead 2', { url: U('EUGENE', 'mine2'), name: 'V_m to lead #2.mp3' }]])
  const alive = async (u) => !u.includes('broken')
  const report = await keepClubRecordings(pushed, [{ label: 'current', workflow: current }, { label: 'backup 2026-10-07', workflow: backup }], alive)
  const vm = pushed.workflowData.templates.filter(t => t.type === 'voicemail').map(t => t.attributes.attachment.name)
  assert.deepEqual(vm, ['V_m to lead #1.mp3', 'V_m to lead #2.mp3', 'Missed Tour Call 1.mp3'])
  assert.deepEqual(report.map(r => r.from), ['current', 'backup 2026-10-07', 'source'])
})

test('makeIsAlive: 2xx only, non-file URLs never fetched, cached', async () => {
  let calls = 0
  const fake = async (url) => { calls++; return { status: url.includes('dead') ? 404 : 206 } }
  const alive = makeIsAlive(fake)
  assert.equal(await alive(U('L', 'ok')), true)
  assert.equal(await alive(U('L', 'ok')), true)
  assert.equal(await alive(U('L', 'dead')), false)
  assert.equal(await alive('https://example.com/x.mp3'), false)
  assert.equal(calls, 2)
})
