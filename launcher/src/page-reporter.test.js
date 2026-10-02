const test = require('node:test')
const assert = require('node:assert/strict')
const { createReporter } = require('./page-reporter')

function harness(initial = []) {
  let online = true
  const sent = []
  let saved = initial
  const reporter = createReporter({
    load: () => [...initial],
    save: (q) => { saved = [...q] },
    post: async (e) => { if (online) sent.push(e.n); return online },
  })
  return { reporter, sent, saved: () => saved, setOnline: (v) => { online = v } }
}

test('events are sent in order and leave the queue', async () => {
  const h = harness()
  await h.reporter.report({ n: 1 })
  await h.reporter.report({ n: 2 })
  assert.deepEqual(h.sent, [1, 2])
  assert.equal(h.reporter.pending(), 0)
  assert.deepEqual(h.saved(), [])
})

test('events wait on disk while the API is down, then go out', async () => {
  const h = harness()
  h.setOnline(false)
  await h.reporter.report({ n: 1 })
  await h.reporter.report({ n: 2 })
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.saved().map((e) => e.n), [1, 2])
  h.setOnline(true)
  await h.reporter.flush()
  assert.deepEqual(h.sent, [1, 2])
})

test('a queue left from the last run is sent, and the queue is capped', async () => {
  const h = harness([{ n: 0 }])
  await h.reporter.flush()
  assert.deepEqual(h.sent, [0])

  const full = harness()
  full.setOnline(false)
  for (let i = 0; i < 250; i++) await full.reporter.report({ n: i })
  assert.equal(full.reporter.pending(), 200)
  assert.equal(full.saved()[0].n, 50)
})
