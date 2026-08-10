'use strict'
const { generateText: realGenerateText, MODEL_FAST } = require('../dayOneProgram/anthropic')
const { parseJsonLoose } = require('./generate')

const MIN_WORDS = 400
const CRITIQUE_PASS = 7

function wordCount(html) {
  return String(html).replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length
}

function validateProgrammatic(post, location) {
  const failures = []
  const html = post.contentHtml || ''
  if (!post.title || post.title.length < 20) failures.push('title missing or too short')
  const md = post.metaDescription || ''
  if (md.length < 150 || md.length > 160) failures.push(`meta description length ${md.length} not in 150-160`)
  if (!post.focusKeyword) failures.push('focus keyword missing')
  if (wordCount(html) < MIN_WORDS) failures.push(`word count ${wordCount(html)} below ${MIN_WORDS}`)
  if (!/class="schema-faq"/.test(html) || !(post.faq && post.faq.length)) failures.push('faq block missing')
  if (!new RegExp(location.city, 'i').test(html) && !new RegExp(location.key, 'i').test(html)) {
    failures.push(`location ${location.key} not named in content`)
  }
  if (/—/.test(html) || /—/.test(md) || /—/.test(post.title || '')) failures.push('em-dash present (brand rule)')
  if (!/<h2>/i.test(html)) failures.push('no H2 headings')
  return { ok: failures.length === 0, failures }
}

async function critique(post, location, deps = {}) {
  const generateText = deps.generateText || realGenerateText
  const prompt = `You are a strict editor for ${location.name}. Score this blog post 0-10 for: on-brand voice (friendly, not salesy), factual safety (no invented specific claims about this gym, no medical overreach), correct location (${location.city}, Oregon), readability, and genuine helpfulness.
Return ONLY JSON: {"score": number 0-10, "issues": string[]}.

TITLE: ${post.title}
META: ${post.metaDescription}

CONTENT:
${String(post.contentHtml).slice(0, 8000)}`
  const out = parseJsonLoose(await generateText({ prompt, maxTokens: 600, model: MODEL_FAST }))
  const score = Number(out.score) || 0
  return { ok: score >= CRITIQUE_PASS, score, issues: out.issues || [] }
}

async function validatePost(post, location, deps = {}) {
  const programmatic = validateProgrammatic(post, location)
  if (!programmatic.ok) return { ok: false, report: { programmatic, critique: null } }
  const crit = await critique(post, location, deps)
  return { ok: crit.ok, report: { programmatic, critique: crit } }
}

module.exports = { validateProgrammatic, critique, validatePost, MIN_WORDS, CRITIQUE_PASS }
