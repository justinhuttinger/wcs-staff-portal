#!/usr/bin/env node
// Push the workflow email series into each club's GHL as custom values:
// "<Name> Subject", "<Name> Preview" and "<Name> HTML" (e.g. "New Lead Email 1
// Subject"), plus the shared "Email From Name" and "Email From Address", which
// the workflows' Send Email actions reference. The shared sender values are
// only created when missing, never overwritten, so edits made in the portal
// stick. Edited afterwards in the portal
// (Marketing -> Workflows & Scripts -> Emails / Links).
//
//   node scripts/push-workflow-emails.js --dir <series dir> [options]
//
//   --dir <path>        the series root, e.g. ~/wcs-creative/emails/2026-10-07-workflows.
//                       Emails are built per club: <dir>/<club>/<slug>/ with each
//                       club's own placeholders.json. A club with no folder yet is skipped.
//   --values <file>     per-club placeholder values (default: scripts/workflow-email-values.json)
//   --clubs a,b         clubs to push (default: every club in ghlLocations)
//   --only s1,s2        only these email slugs
//   --apply             actually upload images and write custom values (default: dry run)
//
// Each club's images upload to that club's own GHL Media Library (the photos
// are club-specific). Dry run renders everything and reports missing club
// values, image counts, HTML sizes and what would be created vs updated.
// Nothing is written to GHL. A club with any missing value is skipped on --apply.
//
// Uploaded image URLs are cached in <dir>/_ghl-media.json by club and content
// hash, so re-running after a copy change only uploads images that changed.

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

function loadClubEmails(clubDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(clubDir, 'placeholders.json'), 'utf8'))
  return meta.emails
    .filter(e => !ONLY || ONLY.has(e.slug))
    .map(e => {
      const html = fs.readFileSync(path.join(clubDir, e.slug, 'email.html'), 'utf8')
      const { subject, preview } = pickSubject(fs.readFileSync(path.join(clubDir, e.slug, 'subject.txt'), 'utf8'))
      return { ...e, name: emailName(e), html, subject, preview }
    })
}

// Upload (or reuse from the cache) every image the club's emails use, into
// that club's Media Library. Returns { [slug]: { [file]: url } } and a count.
async function hostImages(loc, clubDir, emails, cache) {
  const urlsBySlug = {}
  let uploads = 0
  for (const e of emails) {
    urlsBySlug[e.slug] = {}
    for (const file of imageFiles(e.html)) {
      const p = path.join(clubDir, e.slug, 'images', file)
      if (!fs.existsSync(p)) throw new Error(`Missing image ${loc.slug}/${e.slug}/images/${file}`)
      const hash = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12)
      const key = `${loc.slug}:${hash}`
      if (!cache[key]) {
        if (APPLY) {
          cache[key] = await uploadImage(loc, p, `wcs-email-${e.slug}-${hash}${path.extname(file)}`)
          fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
          console.log(`  uploaded ${e.slug}/${file}`)
        }
        uploads++
      }
      urlsBySlug[e.slug][file] = cache[key] || `https://pending-upload/${hash}${path.extname(file)}`
    }
  }
  return { urlsBySlug, uploads }
}

async function main() {
  const config = JSON.parse(fs.readFileSync(VALUES_FILE, 'utf8'))
  const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: clubs ${CLUBS.join(', ')}`)

  for (const slug of CLUBS) {
    const loc = LOCATIONS.find(l => l.slug === slug)
    if (!loc) { console.log(`
${slug}: no GHL credentials, skipped`); continue }
    const clubDir = path.join(DIR, slug)
    if (!fs.existsSync(path.join(clubDir, 'placeholders.json'))) { console.log(`
${loc.name}: no emails built yet, skipped`); continue }
    const emails = loadClubEmails(clubDir)
    const values = clubValues(config, slug)

    // Check values before uploading anything, so a club that can't be pushed
    // doesn't leave images behind in its Media Library.
    const precheck = [...new Set(emails.flatMap(e => [
      ...renderEmailHtml(e.html, values).missing, ...renderSubject(e.subject, values).missing,
      ...renderSubject(e.preview, values).missing,
    ]))]
    if (precheck.length && APPLY) {
      console.log(`
${loc.name}: MISSING values: ${precheck.join(', ')}
  skipped: fill the missing values first`)
      continue
    }

    const { urlsBySlug, uploads } = await hostImages(loc, clubDir, emails, cache)
    const rendered = emails.map(e => ({
      e,
      html: renderEmailHtml(e.html, values, urlsBySlug[e.slug]).html,
      subject: renderSubject(e.subject, values).text,
      preview: renderSubject(e.preview, values).text,
    }))
    const maxKb = Math.max(...rendered.map(r => Buffer.byteLength(r.html) / 1024)).toFixed(1)
    console.log(`
${loc.name}: ${emails.length} emails, largest HTML ${maxKb} KB, images ${uploads} ${APPLY ? 'uploaded' : 'to upload'}${precheck.length ? `, MISSING values: ${precheck.join(', ')}` : ''}`)

    const existing = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
    const byName = new Map((existing.customValues || []).map(cv => [cv.name.trim().toLowerCase(), cv]))
    let created = 0, updated = 0, same = 0
    for (const r of rendered) {
      for (const [suffix, value] of [['Subject', r.subject], ['Preview', r.preview], ['HTML', r.html]]) {
        const name = `${r.e.name} ${suffix}`
        const cv = byName.get(name.toLowerCase())
        // GHL trims saved values, so compare trimmed.
        if (cv && String(cv.value).trim() === value.trim()) { same++; continue }
        if (APPLY) {
          if (cv) await ghlFetch(`/locations/${loc.id}/customValues/${cv.id}`, loc.apiKey, { method: 'PUT', body: { name: cv.name, value } })
          else await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey, { method: 'POST', body: { name, value } })
        }
        if (cv) updated++
        else created++
      }
    }
    // Shared sender values: create once, never overwrite.
    for (const [name, key] of [['Email From Name', 'from_name'], ['Email From Address', 'from_email']]) {
      if (byName.has(name.toLowerCase())) continue
      if (!values[key]) { console.log(`  ${name}: no ${key} value, not created`); continue }
      if (APPLY) await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey, { method: 'POST', body: { name, value: values[key] } })
      created++
      console.log(`  ${APPLY ? 'created' : 'would create'} ${name}: ${values[key]}`)
    }
    console.log(`  ${APPLY ? '' : 'would '}create ${created}, update ${updated}, unchanged ${same}`)
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
