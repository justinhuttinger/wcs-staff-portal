// Keeps each club's iPad lock screens matching its live memo. Runs on a timer so
// scheduled start and end dates work with nobody around, and straight after a
// publish or edit. Dark until MEMO_IPAD_SYNC_ENABLED=true, and a club is only
// touched once its ipad_target is set.
//
// A failed run does not retry on its own: repeated bad logins could lock the
// account. It waits for a new image or the Retry button.
const { createHash } = require('node:crypto')
const cron = require('node-cron')
const { pickLiveMemo } = require('../../lib/memoRules')
const { createClient, isConfigured } = require('./client')

const md5 = bytes => createHash('md5').update(bytes).digest('hex')
const CLEARED = 'cleared'

// The service answers 200 even when an upload didn't take, so the only proof is
// it naming the exact image that was sent.
function confirmLockImage(result, bytes) {
  if (result?.lock !== md5(bytes)) throw new Error('The upload did not take')
}

// What to do for one club. live = its live memo or null; image = { md5 } or null.
function planClub({ club, live, image }) {
  if (!club.ipad_target) return { action: 'none' }

  let action
  let desired
  if (live) {
    if (!image) return { action: 'wait' }
    action = 'push'
    desired = image.md5
  } else {
    // Nothing of ours is on the iPads, so leave them alone.
    if (!club.ipad_pushed_md5) return { action: 'none' }
    if (!club.normal_saved_at) return { action: 'no_normal' }
    // The club had no lock image of its own, so going back to normal means none.
    action = club.normal_image_md5 ? 'restore' : 'clear'
    desired = club.normal_image_md5 || CLEARED
  }
  if (club.ipad_pushed_md5 === desired) return { action: 'none' }
  if (club.ipad_status === 'failed' && club.ipad_failed_md5 === desired) return { action: 'none' }
  return { action, desired }
}

function isEnabled(env = process.env) {
  return env.MEMO_IPAD_SYNC_ENABLED === 'true' && isConfigured(env)
}

let running = false

async function loadWork(supabaseAdmin) {
  const { data: clubs, error } = await supabaseAdmin
    .from('memo_clubs')
    .select('club_slug, ipad_target, ipad_status, ipad_failed_md5, ipad_pushed_md5, normal_saved_at, normal_image_md5')
    .eq('enabled', true)
    .not('ipad_target', 'is', null)
  if (error) throw error
  if (!clubs?.length) return []

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('club_memos')
    .select('id, club_slug, status, starts_at, ends_at, club_memo_images(md5)')
    .in('club_slug', clubs.map(c => c.club_slug))
    .eq('status', 'published')
  if (rowsErr) throw rowsErr

  return clubs.map((club) => {
    const live = pickLiveMemo((rows || []).filter(r => r.club_slug === club.club_slug))
    const embedded = live?.club_memo_images
    const image = Array.isArray(embedded) ? embedded[0] || null : embedded || null
    return { club, live, plan: planClub({ club, live, image }) }
  })
}

// Saved once, before the first memo overwrites it.
async function saveNormalImage(supabaseAdmin, client, club) {
  if (club.normal_saved_at) return
  const { lock } = await client.readWallpaper(club.ipad_target)
  const update = { normal_saved_at: new Date().toISOString() }
  if (lock) {
    const { bytes, type } = await client.readImage(lock)
    update.normal_image_base64 = `${type};${bytes.toString('base64')}`
    update.normal_image_md5 = lock
  }
  const { error } = await supabaseAdmin.from('memo_clubs').update(update).eq('club_slug', club.club_slug)
  if (error) throw error
}

async function loadBytes(supabaseAdmin, { club, live, plan }) {
  if (plan.action === 'push') {
    const { data, error } = await supabaseAdmin
      .from('club_memo_images').select('image_base64').eq('club_memo_id', live.id).single()
    if (error) throw error
    return { bytes: Buffer.from(data.image_base64, 'base64'), type: 'image/png' }
  }
  const { data, error } = await supabaseAdmin
    .from('memo_clubs').select('normal_image_base64').eq('club_slug', club.club_slug).single()
  if (error) throw error
  const at = data.normal_image_base64.indexOf(';')
  return { bytes: Buffer.from(data.normal_image_base64.slice(at + 1), 'base64'), type: data.normal_image_base64.slice(0, at) }
}

async function record(supabaseAdmin, slug, fields) {
  const { error } = await supabaseAdmin.from('memo_clubs').update({ updated_at: new Date().toISOString(), ...fields }).eq('club_slug', slug)
  if (error) console.error('[MemoIpad] could not record status:', error.message)
}

const failed = (message, desired) => ({ ipad_status: 'failed', ipad_error: message, ipad_failed_md5: desired || null })

async function runSync({ supabaseAdmin = require('../supabase').supabaseAdmin, client = null } = {}) {
  if (!isEnabled()) return { skipped: 'disabled' }
  if (running) return { skipped: 'already running' }
  running = true
  try {
    const work = await loadWork(supabaseAdmin)
    for (const { club, plan } of work) {
      if (plan.action === 'wait' && club.ipad_status !== 'waiting') {
        await record(supabaseAdmin, club.club_slug, { ipad_status: 'waiting', ipad_error: 'No image yet. Open the memo and save it.' })
      }
      if (plan.action === 'no_normal' && club.ipad_status !== 'no_normal') {
        await record(supabaseAdmin, club.club_slug, { ipad_status: 'no_normal', ipad_error: 'The memo ended, but this club had no normal image to put back.' })
      }
    }
    const todo = work.filter(w => ['push', 'restore', 'clear'].includes(w.plan.action))
    if (todo.length === 0) return { sent: 0 }

    const api = client || createClient()
    try {
      await api.signIn()
    } catch (err) {
      console.error('[MemoIpad]', err.message)
      for (const { club, plan } of todo) await record(supabaseAdmin, club.club_slug, failed(err.message, plan.desired))
      return { sent: 0, failed: todo.length }
    }

    let sent = 0
    let errors = 0
    for (const item of todo) {
      const { club, plan } = item
      try {
        await saveNormalImage(supabaseAdmin, api, club)
        if (plan.action === 'clear') {
          await api.clearLockImage(club.ipad_target)
        } else {
          const { bytes, type } = await loadBytes(supabaseAdmin, item)
          confirmLockImage(await api.setLockImage(club.ipad_target, bytes, type), bytes)
        }
        await record(supabaseAdmin, club.club_slug, {
          ipad_status: plan.action === 'push' ? 'sent' : 'restored',
          ipad_error: null,
          ipad_failed_md5: null,
          ipad_pushed_md5: plan.desired,
          ipad_pushed_at: new Date().toISOString(),
        })
        sent++
      } catch (err) {
        console.error(`[MemoIpad] ${club.club_slug}:`, err.message)
        await record(supabaseAdmin, club.club_slug, failed(err.message, plan.desired))
        errors++
      }
    }
    return { sent, failed: errors }
  } finally {
    running = false
  }
}

function logResult(promise) {
  promise.then(
    r => { if (r.sent || r.failed) console.log('[MemoIpad] run:', JSON.stringify(r)) },
    e => console.error('[MemoIpad] run failed:', e.message),
  )
}

// Fire and forget, so a publish never waits on the iPads.
function kick() {
  setImmediate(() => logResult(runSync()))
}

function start() {
  if (!isEnabled()) {
    console.log('[MemoIpad] disabled')
    return
  }
  cron.schedule('*/5 * * * *', () => logResult(runSync()))
  console.log('[MemoIpad] scheduled every 5m')
}

module.exports = { planClub, confirmLockImage, runSync, kick, start, isEnabled, md5 }
