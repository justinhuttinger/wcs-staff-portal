// Pure shaping for the two breakdowns under Analytics > Lead Sources. No I/O.
//
//   Facebook ads      campaign > ad set > ad, from analytics_lead_facebook_ads
//                     (migration 207). Its rows sum to the main report's
//                     Facebook row: same population, same funnel.
//   Website traffic   GA4 sessions by default channel group, for the clubs on
//                     screen. VISITS, not leads -- see WEB_TRAFFIC_NOTE.

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

const FUNNEL = ['leads', 'tours', 'trials', 'won', 'lost']

function withRates(node) {
  return {
    ...node,
    trialRate: rate(node.trials, node.leads),
    winRate: rate(node.won, node.leads),
  }
}

function blank(extra) {
  const out = { ...extra }
  for (const k of FUNNEL) out[k] = 0
  return out
}

function add(into, row) {
  for (const k of FUNNEL) into[k] += num(row[k])
}

const byLeads = (a, b) => b.leads - a.leads || String(a.name).localeCompare(String(b.name))

/**
 * @param rows from analytics_lead_facebook_ads
 * @returns campaigns[] each with adsets[] each with ads[], funnel counts and
 *          rates at every level, largest first.
 */
function buildFacebookBreakdown(rows) {
  const campaigns = new Map()
  for (const r of rows || []) {
    let c = campaigns.get(r.campaign)
    if (!c) {
      c = blank({ name: r.campaign, adsets: new Map() })
      campaigns.set(r.campaign, c)
    }
    let s = c.adsets.get(r.adset)
    if (!s) {
      s = blank({ name: r.adset, ads: [] })
      c.adsets.set(r.adset, s)
    }
    const ad = blank({ name: r.ad, adId: r.ad_id || null })
    add(ad, r)
    s.ads.push(withRates(ad))
    add(s, r)
    add(c, r)
  }
  return [...campaigns.values()]
    .map(c => withRates({
      ...c,
      adsets: [...c.adsets.values()]
        .map(s => withRates({ ...s, ads: s.ads.sort(byLeads) }))
        .sort(byLeads),
    }))
    .sort(byLeads)
}

// Stated beside the numbers. GA4 counts VISITS to the club's pages; the funnel
// above counts LEADS. They are different populations and must not be divided
// into each other.
const WEB_TRAFFIC_NOTE =
  'Website visits by where they came from, from Google Analytics, for the club ' +
  "pages on screen. These are visits, not leads: most website leads arrive " +
  "through the GHL form embedded on the page, which can't see where the visitor " +
  'came from, so GHL records nearly all of them as Direct.'

// Below this many visits in the window the property is almost certainly not
// receiving data (the tag is missing), rather than the site being that quiet.
// A real club page sees thousands a month.
const LOW_TRAFFIC_THRESHOLD = 100

const LOW_TRAFFIC_NOTE =
  'Google Analytics is receiving almost no visits for this window. Traffic ' +
  'stopped arriving the week the new site launched (August 2026): the Google ' +
  'tag is not on the new site. Add the GA4 tag in Google Tag Manager and these ' +
  'numbers fill in from that day on.'

/**
 * @param rows [{ channel, sessions, keyEvents }] from GA4
 */
function buildWebTraffic(rows) {
  const channels = (rows || [])
    .map(r => ({ channel: r.channel, sessions: num(r.sessions), keyEvents: num(r.keyEvents) }))
    .filter(r => r.sessions > 0 || r.keyEvents > 0)
  const sessions = channels.reduce((a, r) => a + r.sessions, 0)
  const keyEvents = channels.reduce((a, r) => a + r.keyEvents, 0)
  return {
    channels: channels
      .map(r => ({ ...r, share: rate(r.sessions, sessions) }))
      .sort((a, b) => b.sessions - a.sessions || a.channel.localeCompare(b.channel)),
    totals: { sessions, keyEvents },
    note: WEB_TRAFFIC_NOTE,
    warning: sessions < LOW_TRAFFIC_THRESHOLD ? LOW_TRAFFIC_NOTE : null,
  }
}

module.exports = {
  buildFacebookBreakdown, buildWebTraffic,
  WEB_TRAFFIC_NOTE, LOW_TRAFFIC_NOTE, LOW_TRAFFIC_THRESHOLD,
}
