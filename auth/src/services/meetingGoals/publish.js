// auth/src/services/meetingGoals/publish.js
// Render one club's goal article from Supabase and update it IN PLACE.
//
// In place matters: each Weekly Meeting job's first step embeds
// `@[MC Goals - Salem](KnowledgeArticle:<id>)`. The KPI digest's
// create-then-delete would change that id every run and silently break the
// link, so this path must never be "unified" with that one.
'use strict'

const op = require('../../lib/operandioApi')
const { supabaseAdmin } = require('../supabase')
const { titleFor } = require('./config')
const { entriesFor } = require('./collect')
const { buildGoalsDoc, hashDoc } = require('./tiptap')

// Resolve the article id by exact title. Titles are the authority; the cached
// id is only a shortcut. Returns null when Operandio has no such article — the
// 14 are hand-curated, and creating a fifteenth would produce a duplicate the
// jobs' embedded links do not point at.
async function resolveArticle(kind, slug, articles) {
  const title = titleFor(kind, slug)
  const hit = (articles || []).find((a) => a.title === title)
  return hit ? { id: hit.id, title } : null
}

// Render + publish one article. Skips the write when nothing changed.
async function publishOne(kind, slug, articles) {
  const title = titleFor(kind, slug)
  const found = await resolveArticle(kind, slug, articles)
  if (!found) {
    const reason = `no Operandio article titled "${title}"`
    await supabaseAdmin.from('operandio_goal_articles').upsert({
      kind, location_slug: slug, article_title: title, last_error: reason,
    }, { onConflict: 'kind,location_slug' })
    return { kind, slug, status: 'skipped', reason }
  }

  const entries = await entriesFor(kind, slug)
  const doc = buildGoalsDoc(entries)
  const hash = hashDoc(doc)

  const { data: state } = await supabaseAdmin
    .from('operandio_goal_articles')
    .select('last_rendered_hash')
    .eq('kind', kind).eq('location_slug', slug)
    .maybeSingle()
  if (state && state.last_rendered_hash === hash) {
    return { kind, slug, status: 'unchanged', id: found.id }
  }

  const updated = await op.updateKnowledgeArticle({
    id: found.id, title, tipTapContent: doc,
  })
  if (!updated || !updated.id) throw new Error(`update returned no article for ${title}`)

  // Verify the round trip before recording success. There is no version to roll
  // back to, so a mismatch is recorded and alerted rather than retried blindly.
  const stored = await op.fetchKnowledgeContent(found.id)
  if (JSON.stringify(stored) !== JSON.stringify(doc)) {
    throw new Error(`content round-trip mismatch for "${title}" (${found.id})`)
  }

  await supabaseAdmin.from('operandio_goal_articles').upsert({
    kind,
    location_slug: slug,
    article_id: found.id,
    article_title: title,
    last_rendered_hash: hash,
    last_published_at: new Date().toISOString(),
    last_error: null,
  }, { onConflict: 'kind,location_slug' })

  return { kind, slug, status: 'published', id: found.id, weeks: entries.length }
}

// Publish many. One failure never blocks the rest.
async function publishAll(targets) {
  const articles = await op.listKnowledgeArticles()
  const results = []
  for (const { kind, location_slug: slug } of targets) {
    try {
      results.push(await publishOne(kind, slug, articles))
    } catch (err) {
      console.error(`[MeetingGoals] ${kind}/${slug} failed:`, err.message)
      await supabaseAdmin.from('operandio_goal_articles').upsert({
        kind,
        location_slug: slug,
        article_title: titleFor(kind, slug),
        last_error: err.message,
      }, { onConflict: 'kind,location_slug' }).then(() => {}, () => {})
      results.push({ kind, slug, status: 'failed', reason: err.message })
    }
  }
  return results
}

module.exports = { publishOne, publishAll, resolveArticle }
