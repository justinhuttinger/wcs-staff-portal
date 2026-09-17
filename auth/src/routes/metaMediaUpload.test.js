const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { formPartFromFile, cleanupUploads } = require('./metaMediaUpload')

const MB = 1024 * 1024

async function tempFile(bytes) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'meta-upload-test-'))
  const p = path.join(dir, 'clip.mp4')
  await fsp.writeFile(p, Buffer.alloc(bytes, 7))
  return { path: p, mimetype: 'video/mp4', originalname: 'clip.mp4', dir }
}

test('formPartFromFile hands back the whole file without buffering it', async () => {
  const file = await tempFile(64 * MB)
  try {
    global.gc && global.gc()
    const before = process.memoryUsage().rss
    const blob = await formPartFromFile(file)
    const form = new FormData()
    form.set('source', blob, 'clip.mp4')
    // Serializing the multipart body is where the old Buffer/Blob path blew up.
    const body = new Response(form).body
    let streamed = 0
    for await (const chunk of body) streamed += chunk.length
    const grew = process.memoryUsage().rss - before

    assert.equal(blob.size, 64 * MB, 'blob exposes the full file')
    assert.equal(blob.type, 'video/mp4')
    assert.ok(streamed > 64 * MB, `body carried the file (${streamed} bytes)`)
    // The old path grew by 3x the file. Streaming should stay in the noise;
    // 16MB leaves room for chunk churn without admitting a whole copy.
    assert.ok(grew < 16 * MB, `RSS grew ${Math.round(grew / MB)}MB streaming a 64MB file`)
  } finally {
    await fsp.rm(file.dir, { recursive: true, force: true })
  }
})

test('cleanupUploads removes temp files and tolerates missing ones', async () => {
  const a = await tempFile(1024)
  const b = await tempFile(1024)
  await fsp.unlink(b.path) // already gone — must not throw

  await cleanupUploads([a, b, null])

  assert.equal(fs.existsSync(a.path), false)
  await fsp.rm(a.dir, { recursive: true, force: true })
  await fsp.rm(b.dir, { recursive: true, force: true })
})
