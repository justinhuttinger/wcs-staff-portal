// auth/src/services/blogAutomation/generate.js
'use strict'
const { generateText: realGenerateText, MODEL_FAST } = require('../dayOneProgram/anthropic')

const BRAND = `Brand voice: friendly, encouraging, knowledgeable, community-focused, practical. Avoid hype and salesy language. Never use em-dashes (use commas or short sentences). Write for humans first.`

function slugify(title) {
  return String(title).toLowerCase().replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseJsonLoose(text) {
  let s = String(text || '').trim()
  const fence = s.match(/```json\s*\n?([\s\S]*?)\n?```/) || s.match(/```\s*\n?([\s\S]*?)\n?```/)
  if (fence) s = fence[1]
  return JSON.parse(s.trim())
}

// Yoast FAQ Gutenberg block - Yoast emits FAQPage schema from this markup.
function buildFaqBlock(faq) {
  const items = (faq || []).map((f, i) => {
    const id = `faq-${i + 1}`
    return `<div class="schema-faq-section" id="${id}">` +
      `<strong class="schema-faq-question">${f.q}</strong> ` +
      `<p class="schema-faq-answer">${f.a}</p></div>`
  }).join('\n')
  return `<!-- wp:yoast/faq-block -->\n<div class="schema-faq wp-block-yoast-faq-block">\n${items}\n</div>\n<!-- /wp:yoast/faq-block -->`
}

function assembleContentHtml({ intro, sections, takeaways, faq, ctaHtml }) {
  const body = (sections || []).map(s => `<h2>${s.heading}</h2>\n${s.html}`).join('\n')
  const takeawaysHtml = (takeaways && takeaways.length)
    ? `<h2>Key Takeaways</h2>\n<ul>\n${takeaways.map(t => `<li>${t}</li>`).join('\n')}\n</ul>`
    : ''
  const faqHtml = (faq && faq.length) ? `<h2>Frequently Asked Questions</h2>\n${buildFaqBlock(faq)}` : ''
  return [intro || '', body, takeawaysHtml, faqHtml, ctaHtml || '']
    .filter(Boolean).join('\n\n')
}

function buildOutlinePrompt(location, category, topic) {
  return `${BRAND}\n\nYou are an expert local SEO content strategist for ${location.name} (a gym in ${location.city}, Oregon).\n` +
    `Outline a blog post on: "${topic}" (category: ${category}).\n` +
    `Local SEO context: keywords ${location.keywords.slice(0,5).join('; ')}. Landmarks: ${location.landmarks.join(', ')}. Neighborhoods: ${location.neighborhoods.join(', ')}. ${location.localContext}\n\n` +
    `Optimize for SEO, AEO (answer engines / featured snippets) and GEO (AI answer engines): use a question-style angle, factual quotable statements, and clear structure.\n\n` +
    `Return ONLY JSON: {"title": string (50-60 chars, includes the city), "metaDescription": string (150-160 chars), "focusKeyword": string, "excerpt": string (2 sentences), "headings": string[4-6] (each a clear H2, several phrased as questions), "faq": [{"q","a"}] (3-5, concise direct answers), "takeaways": string[3-5]}`
}

function buildSectionPrompt(location, topic, headings) {
  return `${BRAND}\n\nWrite the body for a blog post titled around "${topic}" for ${location.name} in ${location.city}, Oregon.\n` +
    `For EACH heading, write 1-2 short scannable paragraphs of genuinely helpful, specific, factual content. Where a heading is a question, answer it directly in the first sentence (AEO). Weave in local references naturally. No em-dashes.\n` +
    `Headings: ${JSON.stringify(headings)}\n\n` +
    `Return ONLY JSON: {"intro": string (HTML, one <p>, opens with a direct value statement), "sections": [{"heading": string (must match an input heading), "html": string (HTML paragraphs)}], "ctaHtml": string (one <p> CTA inviting readers to West Coast Strength ${location.city})}`
}

async function generatePost({ location, category, topic }, deps = {}) {
  const generateText = deps.generateText || realGenerateText
  const outline = parseJsonLoose(await generateText({
    prompt: buildOutlinePrompt(location, category, topic), maxTokens: 1500,
  }))
  const bodyRaw = parseJsonLoose(await generateText({
    prompt: buildSectionPrompt(location, topic, outline.headings || []), maxTokens: 3000,
  }))
  const contentHtml = assembleContentHtml({
    intro: bodyRaw.intro, sections: bodyRaw.sections || [],
    takeaways: outline.takeaways || [], faq: outline.faq || [], ctaHtml: bodyRaw.ctaHtml,
  })
  return {
    title: outline.title, slug: slugify(outline.title || topic),
    metaDescription: outline.metaDescription, focusKeyword: outline.focusKeyword,
    excerpt: outline.excerpt, contentHtml, faq: outline.faq || [],
  }
}

module.exports = {
  slugify, parseJsonLoose, buildFaqBlock, assembleContentHtml,
  buildOutlinePrompt, buildSectionPrompt, generatePost, MODEL_FAST,
}
