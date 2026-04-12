/**
 * Bulk import markdown help docs — downloads images to Supabase Storage.
 * Run: cd auth && node seed/bulk-import-help.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DOCS_DIR = 'C:/Users/justi/Downloads/Docs MD'

// Map filenames to categories and optional min_role
const FILE_CONFIG = {
  'ABC How to checkin a member.md':    { category: 'ABC Financial', min_role: null },
  'abc calendar.md':                   { category: 'ABC Financial', min_role: null },
  'abc process late payments.md':      { category: 'ABC Financial', min_role: 'manager' },
  'How to cancel Member.md':           { category: 'ABC Financial', min_role: null },
  'cancel and attrition.md':           { category: 'ABC Financial', min_role: 'manager' },
  'how to POS.md':                     { category: 'ABC Financial', min_role: null },
  'how to audits.md':                  { category: 'ABC Financial', min_role: 'manager' },
  'sell PT ABC.md':                     { category: 'ABC Financial', min_role: null },
  'Add Note to CRM.md':               { category: 'CRM & Sales', min_role: null },
  'Send SMS in CRM.MD':               { category: 'CRM & Sales', min_role: null },
  'how to book appt in CRM.md':       { category: 'CRM & Sales', min_role: null },
  'calling and dialing.md':           { category: 'CRM & Sales', min_role: null },
  'mark not interested.md':           { category: 'CRM & Sales', min_role: null },
  'bulk complete events.md':          { category: 'CRM & Sales', min_role: null },
  'operandio basics.md':              { category: 'Operandio', min_role: null },
  'operandio actions.md':             { category: 'Operandio', min_role: null },
  'mobile manager operandio.md':      { category: 'Operandio', min_role: 'manager' },
  'operandio mamabger.md':            { category: 'Operandio', min_role: 'manager' },
  'Revenue Report.MD':                { category: 'Reporting', min_role: 'manager' },
  'Ordering Core Power.MD':           { category: 'ABC Financial', min_role: 'manager' },
}

async function downloadAndUploadImage(imageUrl) {
  try {
    const resp = await fetch(imageUrl)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await resp.arrayBuffer())
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const fileName = `articles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error } = await supabase.storage
      .from('help-center')
      .upload(fileName, buffer, { contentType, upsert: false })
    if (error) throw error

    const { data } = supabase.storage.from('help-center').getPublicUrl(fileName)
    return data.publicUrl
  } catch (err) {
    console.error(`    Failed to download image: ${err.message}`)
    return imageUrl // keep original if failed
  }
}

async function processMarkdownFile(filePath, categoryId, minRole) {
  let content = fs.readFileSync(filePath, 'utf-8')

  // Extract title from first # heading
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, path.extname(filePath))

  // Clean up
  content = content
    .replace(/^#\s+.+[\r\n]+/m, '') // remove first h1
    .replace(/####\s*\[Made.*?Scribe\]\(.*?\)\s*/g, '')
    .replace(/####\s*\[Made with Scribe\]\(.*?\)\s*/g, '')
    .trim()

  // Find and re-host all images
  const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
  const matches = [...content.matchAll(imgRegex)]
  let imageCount = 0

  for (const match of matches) {
    const newUrl = await downloadAndUploadImage(match[2])
    if (newUrl !== match[2]) {
      content = content.replace(match[2], newUrl)
      imageCount++
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200))
  }

  // Insert article
  const { error } = await supabase
    .from('help_articles')
    .insert({
      title,
      body: content,
      category_id: categoryId,
      min_role: minRole || null,
      sort_order: 0,
    })

  if (error) throw error

  return { title, images: matches.length, uploaded: imageCount }
}

async function main() {
  // Get category IDs
  const { data: cats } = await supabase.from('help_categories').select('id, name')
  const catMap = Object.fromEntries((cats || []).map(c => [c.name, c.id]))

  const files = fs.readdirSync(DOCS_DIR).filter(f => f.toLowerCase().endsWith('.md'))
  console.log(`Found ${files.length} markdown files\n`)

  let success = 0
  let failed = 0

  for (const file of files) {
    const config = FILE_CONFIG[file]
    if (!config) {
      console.log(`  SKIP: ${file} (no config mapping)`)
      continue
    }

    const categoryId = catMap[config.category]
    if (!categoryId) {
      console.log(`  SKIP: ${file} (category "${config.category}" not found)`)
      failed++
      continue
    }

    console.log(`  Processing: ${file}`)
    try {
      const result = await processMarkdownFile(
        path.join(DOCS_DIR, file),
        categoryId,
        config.min_role
      )
      console.log(`    -> "${result.title}" | ${result.uploaded}/${result.images} images saved`)
      success++
    } catch (err) {
      console.error(`    FAILED: ${err.message}`)
      failed++
    }
  }

  console.log(`\nDone! ${success} imported, ${failed} failed`)
}

main().catch(err => { console.error(err); process.exit(1) })
