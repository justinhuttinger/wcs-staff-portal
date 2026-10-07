#!/usr/bin/env node
// Push the workflow email series into each club's GHL as custom values:
// "<Name> Subject" and "<Name> HTML" (e.g. "New Lead Email 1 Subject"), which
// the workflows' Send Email actions reference. Edited afterwards in the portal
// (Marketing -> Workflows & Scripts -> Emails / Links).
//
//   node scripts/push-workflow-emails.js --dir <series dir> [options]
//
//   --dir <path>        the series, e.g. ~/wcs-creative/emails/2026-10-07-workflows
//   --values <file>     per-club placeholder values (default: scripts/workflow-email-values.json)
//   --clubs a,b         clubs to push (default: every club in ghlLocations)
//   --only s1,s2        only these email slugs
//   --media-club <slug> sub-account whose Media Library hosts the images (default: salem);
//                       GHL media URLs are public, so one copy serves every club
//   --apply             actually upload images and write custom values (default: dry run)
//
// Dry run renders everything and reports missing club values, image counts,
// HTML sizes and what would be created vs updated. Nothing is written to GHL.
// A club with any missing value is skipped on --apply.
//
// Uploaded image URLs are cached in <dir>/_ghl-media.json by content hash, so
// re-running after a copy change only uploads images that changed.

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { LOCATIONS } = require('../src/config/ghlLocations')
const { ghlFetch } = require('../src/services/ghlClient')
const {
  emailName, pickSubject, renderEmailHtml, renderSubject, clubValues, imageFiles,
} = require('../src/lib/workflowEmails')

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const APPLY = process.argv.includes('--apply')
const DIR = arg('dir')
if (!DIR) { console.error('Usage: node scripts/push-workflow-emails.js --dir <series dir> [--apply]'); process.exit(1) }
const VALUES_FILE = arg('values', path.join(__dirname, 'workflow-email-values.json'))
const ONLY = arg('only') ? new Set(arg('only').split(',')) : null
const MEDIA_CLUB = arg('media-club', 'salem')
const CLUBS = arg('clubs') ? arg('clubs').split(',') : LOCATIONS.map(l => l.slug)
const CACHE_FILE = path.join(DIR, '_ghl-media.json')

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

// GHL media upload (multipart). Response shape has varied; resolve the URL
// from the file id if it isn't returned directly.
async function uploadImage(loc, filePath, name) {
  const form = new FormData()
  const buf = fs.readFileSync(filePath)
  form.append('file', new Blob([buf], { type: MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' }), name)
  form.append('name', name)
  form.append('hosted', 'false')
  const res = await fetch(`${BASE_URL}/medias/upload-file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loc.apiKey}`, Version: '2021-07-28' },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`GHL media upload ${res.status}: ${text.slice(0, 300)}`)
  const json = JSON.parse(text)
  if (json.url) return json.url
  const id = json.fileId || json._id || json.id
  if (!id) throw new Error('GHL media upload returned no url or id: ' + text.slice(0, 200))
  const list = await ghlFetch('/medias/files', loc.apiKey, { params: { altId: loc.id, altType: 'location', type: 'file', limit: '50', sortBy: 'createdAt', sortOrder: 'desc' } })
  const hit = (list.files || []).find(f => f._id === id || f.id === id)
  if (!hit?.url) throw new Error('Uploaded but could not find the media URL for ' + name)
  return hit.url
}

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'placeholders.json'), 'utf8'))
  const config = JSON.parse(fs.readFileSync(VALUES_FILE, 'utf8'))
  const emails = meta.emails
    .filter(e => !ONLY || ONLY.has(e.slug))
    .map(e => {
      const html = fs.readFileSync(path.join(DIR, e.slug, 'email.html'), 'utf8')
      const { subject } = pickSubject(fs.readFileSync(path.join(DIR, e.slug, 'subject.txt'), 'utf8'))
      return { ...e, name: emailName(e), html, subject }
    })
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${emails.length} emails x ${CLUBS.length} clubs (${CLUBS.join(', ')})`)

  // ── Images: one upload per distinct file content ─────────────────────────
  const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}
  const mediaLoc = LOCATIONS.find(l => l.slug === MEDIA_CLUB)
  if (!mediaLoc) throw new Error('Unknown --media-club ' + MEDIA_CLUB)
  const urlsBySlug = {}
  let uploads = 0
  for (const e of emails) {
    urlsBySlug[e.slug] = {}
    for (const file of imageFiles(e.html)) {
      const p = path.join(DIR, e.slug, 'images', file)
      if (!fs.existsSync(p)) throw new Error(`Missing image ${e.slug}/images/${file}`)
      const hash = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12)
      if (!cache[hash]) {
        if (APPLY) {
          const name = `wcs-email-${e.slug}-${hash}${path.extname(file)}`
          cache[hash] = await uploadImage(mediaLoc, p, name)
          fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
          console.log(`  uploaded ${e.slug}/${file}`)
        }
        uploads++
      }
      urlsBySlug[e.slug][file] = cache[hash] || `https://pending-upload/${hash}${path.extname(file)}`
    }
  }
  console.log(`Images: ${uploads} ${APPLY ? 'uploaded' : 'to upload'} to ${mediaLoc.name}'s Media Library (rest cached)`)

  // ── Per club ────────────────────────────────────────────────────────────
  for (const slug of CLUBS) {
    const loc = LOCATIONS.find(l => l.slug === slug)
    if (!loc) { console.log(`\n${slug}: no GHL credentials, skipped`); continue }
    const values = clubValues(config, slug)
    const rendered = emails.map(e => {
      const html = renderEmailHtml(e.html, values, urlsBySlug[e.slug])
      const subject = renderSubject(e.subject, values)
      return { e, html: html.html, subject: subject.text, missing: [...new Set([...html.missing, ...subject.missing])] }
    })
    const missing = [...new Set(rendered.flatMap(r => r.missing))]
    const maxKb = Math.max(...rendered.map(r => Buffer.byteLength(r.html) / 1024)).toFixed(1)
    console.log(`\n${loc.name}: largest HTML ${maxKb} KB${missing.length ? `, MISSING values: ${missing.join(', ')}` : ''}`)
    if (missing.length && APPLY) { console.log('  skipped: fill the missing values first'); continue }

    const existing = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
    const byName = new Map((existing.customValues || []).map(cv => [cv.name.trim().toLowerCase(), cv]))
    let created = 0, updated = 0, same = 0
    for (const r of rendered) {
      for (const [suffix, value] of [['Subject', r.subject], ['HTML', r.html]]) {
        const name = `${r.e.name} ${suffix}`
        const cv = byName.get(name.toLowerCase())
        if (cv && String(cv.value) === value) { same++; continue }
        if (APPLY) {
          if (cv) await ghlFetch(`/locations/${loc.id}/customValues/${cv.id}`, loc.apiKey, { method: 'PUT', body: { name: cv.name, value } })
          else await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey, { method: 'POST', body: { name, value } })
        }
        if (cv) updated++
        else created++
      }
    }
    console.log(`  ${APPLY ? '' : 'would '}create ${created}, update ${updated}, unchanged ${same}`)
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
