// Helpers for the Meta Ads Manager media uploads.
//
// The uploads used to run through multer.memoryStorage(): the whole file sat in
// a Buffer, `new Blob([buffer])` copied it, and serializing the FormData copied
// it again. A 100MB video cost ~500MB of RSS, which the 512MB auth instance
// cannot survive — the process was SIGKILLed mid-request, so the browser saw a
// 502 with no CORS headers and every in-flight call failed with it.
//
// So the file goes to disk (multer diskStorage) and travels to Meta as a
// file-backed Blob, which undici streams off disk. Memory stays flat no matter
// how big the upload is. Callers MUST cleanup() when the request ends.
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const multer = require('multer')

// Temp dir for in-flight uploads. Render's disk is ephemeral, which is exactly
// what we want: anything we fail to clean up dies with the instance.
const UPLOAD_DIR = path.join(os.tmpdir(), 'wcs-meta-uploads')

function diskUpload(limits) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdir(UPLOAD_DIR, { recursive: true }, (err) => cb(err, UPLOAD_DIR))
      },
    }),
    limits,
  })
}

// A Blob backed by the file on disk. Reading it streams; it is never buffered.
async function formPartFromFile(file) {
  return fs.openAsBlob(file.path, { type: file.mimetype || 'application/octet-stream' })
}

// Delete the temp files for a request. Never throws: a failed unlink must not
// turn a successful upload into an error response.
async function cleanupUploads(files) {
  for (const file of [].concat(files || []).filter(Boolean)) {
    if (!file.path) continue
    try {
      await fsp.unlink(file.path)
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[Meta Ads Manager] temp cleanup:', err.message)
    }
  }
}

module.exports = { diskUpload, formPartFromFile, cleanupUploads, UPLOAD_DIR }
