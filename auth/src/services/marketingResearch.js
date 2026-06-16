// Marketing "Research" — uses Claude with the web-search tool to find upcoming
// local events/opportunities a gym could participate in near a given club.
//
// Reuses the same Anthropic key as the Mastermind feature. Returns a clean array
// of opportunities; the route persists them to marketing_research.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')

const apiKey = process.env.MASTERMIND_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const client = apiKey ? new Anthropic({ apiKey }) : null
const MODEL = process.env.MARKETING_RESEARCH_MODEL || 'claude-sonnet-4-6'

// All WCS clubs are in Oregon — give the model the city + state for grounding.
const CITY_STATE = {
  salem: 'Salem, Oregon',
  keizer: 'Keizer, Oregon',
  eugene: 'Eugene, Oregon',
  springfield: 'Springfield, Oregon',
  clackamas: 'Clackamas, Oregon',
  milwaukie: 'Milwaukie, Oregon',
  medford: 'Medford, Oregon',
}

function pullJsonArray(text) {
  if (!text) return null
  // Strip code fences, then grab the outermost [ ... ].
  const cleaned = text.replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : null)
// Accept only a clean ISO date; the column is a real `date`.
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)

/**
 * Find local marketing opportunities near a club. `locationSlug` is one of the
 * 7 club slugs (or 'all' → broadened to the Willamette Valley / Oregon).
 * Returns { items: [...] }.
 */
async function researchLocalEvents(locationSlug) {
  if (!client) {
    const err = new Error('AI research is not configured (ANTHROPIC_API_KEY missing).')
    err.status = 503
    throw err
  }
  const area = CITY_STATE[locationSlug] || 'Oregon (Willamette Valley and southern Oregon)'

  const prompt = `You are a local marketing researcher for West Coast Strength, a gym with locations across Oregon. ` +
    `Using web search, find UPCOMING events and opportunities over roughly the next 3 months near ${area} that this gym should consider participating in, sponsoring, hosting a booth at, or otherwise marketing around. ` +
    `Think: community festivals, farmers/holiday markets, fun runs and races, sports tournaments, school/college events, charity drives, health & wellness fairs, expos, and local sponsorship openings. ` +
    `Prefer real, dated, verifiable events with a source URL. Aim for 6-10 of the best fits.\n\n` +
    `Respond with ONLY a JSON array (no prose, no code fences). Each element:\n` +
    `{"title": string, "event_date": string (human label, e.g. "Aug 12, 2026" or "Aug 12-14, 2026" or "Recurring Sat"), ` +
    `"event_start": string|null (ISO "YYYY-MM-DD" of the first day if known, else null), ` +
    `"event_end": string|null (ISO "YYYY-MM-DD" of the LAST day — set this ONLY for multi-day events, otherwise null), ` +
    `"category": one of "festival"|"race"|"market"|"sponsorship"|"community"|"fair"|"sports"|"other", "description": string (1 sentence), "relevance": string (1 sentence on why it fits a gym), "url": string (source link)}`

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
  })

  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  const parsed = pullJsonArray(text)
  if (!Array.isArray(parsed)) {
    const err = new Error('Research came back in an unexpected format — try again.')
    err.status = 502
    throw err
  }

  const items = parsed
    .map(o => ({
      title: str(o.title, 300),
      event_date: str(o.event_date, 120),
      event_start: isoDate(o.event_start),
      event_end: isoDate(o.event_end),
      category: str(o.category, 40) || 'other',
      description: str(o.description, 1000),
      relevance: str(o.relevance, 1000),
      url: str(o.url, 1000),
    }))
    .filter(o => o.title)
    .slice(0, 15)

  return { items }
}

module.exports = { researchLocalEvents }
