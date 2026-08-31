const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { isShareToken, dispositionMode, contentDisposition } = require('../lib/ticketShareLink')

// Public, UNAUTHENTICATED delivery of a single shared ticket attachment.
//
// The 'ticket-attachments' bucket stays private. Nothing here reads a ticket,
// a comment, or a staff record — the token maps to exactly one file and
// nothing else leaks, so a forwarded link can't be walked back into the
// ticketing system. The token IS the credential: 32 random bytes, unguessable,
// and revoked the moment a handler clears it in the portal.
const router = Router()

const BUCKET = 'ticket-attachments'

router.get('/:token', async (req, res) => {
  const token = String(req.params.token || '')
  // Cheap shape check before touching the DB — the tokens we mint are 64 hex
  // chars, so anything else is a scan, not a real link.
  if (!isShareToken(token)) return res.status(404).send('Not found')

  try {
    const { data: att, error } = await supabaseAdmin
      .from('ticket_attachments')
      .select('id, storage_path, file_name, content_type, share_view_count')
      .eq('share_token', token)
      .maybeSingle()
    if (error) throw error
    if (!att) return res.status(404).send('This link is no longer available.')

    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(att.storage_path)
    if (dlErr || !blob) {
      console.error('[PublicTicketFile] download failed:', dlErr?.message)
      return res.status(404).send('This link is no longer available.')
    }
    const buf = Buffer.from(await blob.arrayBuffer())

    const type = att.content_type || 'application/octet-stream'
    const mode = dispositionMode(type)
    res.set({
      'Content-Type': type,
      'Content-Length': String(buf.length),
      'Content-Disposition': contentDisposition(mode, att.file_name),
      // Revocation has to bite immediately, so nothing may cache the bytes.
      'Cache-Control': 'no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    })
    res.send(buf)

    // Fire-and-forget: a view counter must never fail the download.
    supabaseAdmin.from('ticket_attachments')
      .update({ share_view_count: (att.share_view_count || 0) + 1, share_last_viewed_at: new Date().toISOString() })
      .eq('id', att.id)
      .then(() => {}, (e) => console.error('[PublicTicketFile] view count failed:', e?.message))
  } catch (err) {
    console.error('[PublicTicketFile] serve failed:', err.message)
    res.status(500).send('Something went wrong.')
  }
})

module.exports = router
