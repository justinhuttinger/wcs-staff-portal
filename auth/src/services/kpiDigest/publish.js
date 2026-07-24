// auth/src/services/kpiDigest/publish.js
// Republish the digest article: create the new one, verify its content round-
// tripped, THEN delete every prior article with the same title. Create-before-
// delete so a failed create never leaves the knowledge base with no digest.
// (There is no updateKnowledgeV2, so in-place update is impossible.)
'use strict'

const op = require('../../lib/operandioApi')
const { CATEGORY_ID, GROUP_ID, ARTICLE_TITLE } = require('./config')

async function publishDigest(tipTapDoc) {
  // Snapshot the existing digest article(s) to supersede after a good create.
  const before = await op.listKnowledgeArticles()
  const stale = before.filter((k) => k.title === ARTICLE_TITLE)

  const created = await op.createKnowledgeArticle({
    title: ARTICLE_TITLE,
    category: CATEGORY_ID,
    groups: [GROUP_ID],
    tipTapContent: tipTapDoc,
  })
  if (!created || !created.id) throw new Error('createKnowledgeV2 returned no article')

  // Verify the stored content matches what we sent before removing the old one.
  const stored = await op.fetchKnowledgeContent(created.id)
  if (JSON.stringify(stored) !== JSON.stringify(tipTapDoc)) {
    throw new Error(`content round-trip mismatch for new article ${created.id}; leaving prior article in place`)
  }

  const deleted = []
  for (const s of stale) {
    if (s.id === created.id) continue // paranoia: never delete what we just made
    try {
      if (await op.deleteKnowledge(s.id)) deleted.push(s.id)
    } catch (e) {
      // Non-fatal: a leftover duplicate is better than losing the fresh article.
      console.warn(`[KpiDigest] failed to delete prior article ${s.id}: ${e.message}`)
    }
  }

  return { id: created.id, supersededIds: deleted }
}

module.exports = { publishDigest }
