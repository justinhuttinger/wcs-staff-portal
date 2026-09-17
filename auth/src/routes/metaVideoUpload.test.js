const test = require('node:test')
const assert = require('node:assert')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { uploadVideoChunked } = require('./metaVideoUpload')

async function tempFile(bytes, fill = 3) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'meta-video-test-'))
  const p = path.join(dir, 'clip.mp4')
  await fsp.writeFile(p, Buffer.alloc(bytes, fill))
  return { dir, path: p, size: bytes }
}

// Stands in for Meta: runs the real start/transfer/finish protocol over a
// buffer, so the test proves we speak it correctly rather than that we call it.
function fakeMeta({ chunkSize = 1000, total, failTransferOnce = false } = {}) {
  const received = []
  let failed = false
  const calls = []
  const fetchImpl = async (url, opts) => {
    const form = opts.body
    const phase = form.get('upload_phase')
    calls.push(phase)
    if (phase === 'start') {
      const size = Number(form.get('file_size'))
      assert.equal(size, total, 'start declares the real file size')
      return json({
        video_id: 'vid-1',
        upload_session_id: 'sess-1',
        start_offset: '0',
        end_offset: String(Math.min(chunkSize, total)),
      })
    }
    if (phase === 'transfer') {
      assert.equal(form.get('upload_session_id'), 'sess-1')
      if (failTransferOnce && !failed) {
        failed = true
        return { ok: false, status: 400, text: async () => '' }
      }
      const start = Number(form.get('start_offset'))
      const chunk = form.get('video_file_chunk')
      const bytes = Buffer.from(await chunk.arrayBuffer())
      received.push({ start, bytes })
      const end = Math.min(start + bytes.length + chunkSize, total)
      return json({ start_offset: String(start + bytes.length), end_offset: String(end) })
    }
    if (phase === 'finish') {
      assert.equal(form.get('upload_session_id'), 'sess-1')
      return json({ success: true })
    }
    throw new Error('unexpected phase ' + phase)
  }
  return { fetchImpl, received, calls }
}

const json = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) })

test('uploads the whole file in order across chunks and finishes', async () => {
  const file = await tempFile(3500)
  const meta = fakeMeta({ chunkSize: 1000, total: 3500 })
  try {
    const out = await uploadVideoChunked({
      filePath: file.path,
      fileSize: file.size,
      name: 'clip.mp4',
      accountId: 'act_1',
      token: 't',
      fetchImpl: meta.fetchImpl,
    })

    assert.equal(out.id, 'vid-1')
    assert.deepEqual(meta.calls, ['start', 'transfer', 'transfer', 'transfer', 'transfer', 'finish'])
    const reassembled = Buffer.concat(meta.received.map(r => r.bytes))
    assert.equal(reassembled.length, 3500, 'every byte was sent exactly once')
    assert.ok(reassembled.every(b => b === 3), 'bytes arrived intact')
    assert.deepEqual(meta.received.map(r => r.start), [0, 1000, 2000, 3000], 'offsets advance')
  } finally {
    await fsp.rm(file.dir, { recursive: true, force: true })
  }
})

test('an empty non-JSON reply from Meta becomes a readable error, not "Unexpected end of JSON input"', async () => {
  const file = await tempFile(1500)
  const meta = fakeMeta({ chunkSize: 1000, total: 1500, failTransferOnce: true })
  try {
    await assert.rejects(
      () => uploadVideoChunked({
        filePath: file.path,
        fileSize: file.size,
        name: 'clip.mp4',
        accountId: 'act_1',
        token: 't',
        fetchImpl: meta.fetchImpl,
      }),
      (err) => {
        assert.match(err.message, /Meta/)
        assert.match(err.message, /400/)
        assert.doesNotMatch(err.message, /JSON input/)
        return true
      },
    )
  } finally {
    await fsp.rm(file.dir, { recursive: true, force: true })
  }
})

test('a single-chunk file still runs the full protocol', async () => {
  const file = await tempFile(500)
  const meta = fakeMeta({ chunkSize: 1000, total: 500 })
  try {
    const out = await uploadVideoChunked({
      filePath: file.path,
      fileSize: file.size,
      name: 'clip.mp4',
      accountId: 'act_1',
      token: 't',
      fetchImpl: meta.fetchImpl,
    })
    assert.equal(out.id, 'vid-1')
    assert.deepEqual(meta.calls, ['start', 'transfer', 'finish'])
  } finally {
    await fsp.rm(file.dir, { recursive: true, force: true })
  }
})
