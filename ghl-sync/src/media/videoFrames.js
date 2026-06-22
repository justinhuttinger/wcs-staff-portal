// ghl-sync/src/media/videoFrames.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const ffmpegPath = require('ffmpeg-static')

// Extract 1 frame per intervalSec seconds into a temp dir. Returns the temp dir
// plus frame file PATHS (not buffers) so the caller can read + embed them one
// batch at a time, keeping memory bounded. The caller must remove `dir` when done.
async function sampleFrames(videoPath, intervalSec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'))
  const pattern = path.join(dir, 'f-%05d.jpg')
  const fps = `1/${intervalSec}`
  await new Promise((resolve, reject) => {
    const args = ['-i', videoPath, '-vf', `fps=${fps},scale='min(1280,iw)':-2`, '-q:v', '4', pattern]
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code + ': ' + stderr.slice(-500)))))
  })
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.jpg')).sort()
  const frames = files.map((name, i) => ({
    path: path.join(dir, name),
    timeSeconds: i * intervalSec, // frame i ~ i*interval seconds in
  }))
  return { dir, frames }
}

module.exports = { sampleFrames }
