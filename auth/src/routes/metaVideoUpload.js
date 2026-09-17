// Chunked (resumable) video upload to an ad account.
//
// The plain one-shot POST to /act_<id>/advideos works for small clips and then
// quietly stops working: Meta closes the connection on a large simple upload
// and returns an EMPTY body, which surfaced in the portal as a 400 and
// "Unexpected end of JSON input" (the body we tried to parse was '').
//
// So videos go up the way Meta documents for anything sizeable:
//   start    — declare file_size, get back upload_session_id + video_id and the
//              byte range Meta wants first
//   transfer — send exactly that range as video_file_chunk; the reply names the
//              next range. Repeat until start_offset === end_offset.
//   finish   — publish the session; the id from `start` is the video.
//
// Each chunk is a slice of a file-backed Blob, so only the slice is ever read
// into memory — see metaMediaUpload.js for why that matters on this instance.
const fs = require('fs')

// Meta accepts large chunks; this is a compromise between round-trips and how
// much of the file is in flight (and therefore in memory) at once.
const CHUNK_BYTES = 4 * 1024 * 1024

// Meta answers the upload phases with an empty body often enough that a bare
// .json() is a liability: it throws SyntaxError and hides the status. Read the
// text first and report what actually came back.
async function readMetaJson(resp, phase) {
  const text = await resp.text()
  if (!text) {
    throw new Error(`Meta returned an empty response (HTTP ${resp.status}) during video upload (${phase}).`)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Meta returned a non-JSON response (HTTP ${resp.status}) during video upload (${phase}): ${text.slice(0, 200)}`)
  }
  if (data.error) {
    const e = data.error
    const msg = e.error_user_msg || e.message || 'Meta API error'
    const err = new Error(e.error_user_title ? `${e.error_user_title}: ${msg}` : msg)
    err.meta = e
    throw err
  }
  if (!resp.ok) throw new Error(`Meta rejected the video upload (HTTP ${resp.status}) during ${phase}.`)
  return data
}

async function uploadVideoChunked({ filePath, fileSize, name, accountId, token, fetchImpl = fetch, apiBase = 'https://graph.facebook.com/v21.0' }) {
  const endpoint = `${apiBase}/${accountId}/advideos`
  const post = async (fields, phase) => {
    const form = new FormData()
    form.set('access_token', token)
    for (const [k, v] of Object.entries(fields)) form.set(k, v)
    return readMetaJson(await fetchImpl(endpoint, { method: 'POST', body: form }), phase)
  }

  const started = await post({ upload_phase: 'start', file_size: String(fileSize) }, 'start')
  const sessionId = started.upload_session_id
  const videoId = started.video_id
  let start = Number(started.start_offset)
  let end = Number(started.end_offset)

  // The file stays on disk; .slice() on a file-backed Blob reads only the range
  // it covers, so a 200MB video never costs more than one chunk of memory.
  const blob = await fs.openAsBlob(filePath)

  while (start < end) {
    const chunk = blob.slice(start, Math.min(start + CHUNK_BYTES, end))
    const res = await post({
      upload_phase: 'transfer',
      upload_session_id: sessionId,
      start_offset: String(start),
      video_file_chunk: chunk,
    }, 'transfer')
    const nextStart = Number(res.start_offset)
    const nextEnd = Number(res.end_offset)
    // Meta drives the offsets. Trusting its numbers (rather than our own
    // arithmetic) is what makes a retried or short chunk self-correct, but a
    // reply that fails to advance would spin forever.
    if (nextStart === start && nextEnd === end) {
      throw new Error('Meta stopped advancing the video upload; aborting instead of looping.')
    }
    start = nextStart
    end = nextEnd
  }

  await post({ upload_phase: 'finish', upload_session_id: sessionId, title: name || 'video.mp4' }, 'finish')
  return { id: videoId }
}

module.exports = { uploadVideoChunked, readMetaJson, CHUNK_BYTES }
