/**
 * Facebook credit for leads who clicked an ad through to the WEBSITE.
 *
 * GHL only fills attributionSource.adId for its own Facebook Lead Form
 * integration. Someone who clicks an ad, lands on westcoaststrength.com, and
 * submits the website form gets UTM tags instead, in one of two shapes:
 *
 *   - Meta's automatic URL parameters: utm_source=fb, utm_content={{ad.id}}
 *     (utm_term = ad set id, utm_campaign = campaign id). The ad id is right there.
 *   - HighLevel's Facebook-reporting template: utm_source=fb_ad,
 *     utm_content={{ad.name}}, campaign_id={{campaign.id}} (GHL stores it as
 *     attributionSource.campaignId). We look the ad up by name in Meta's spend
 *     rows, narrowed to that campaign.
 *
 * Returns the resolved ad id, or null when it can't be pinned to one ad.
 */

const FB_SOURCES = new Set(['fb', 'fb_ad', 'facebook', 'ig', 'instagram'])
const META_ID = /^\d{10,}$/

function isFacebookClick(attr) {
  return !!attr && FB_SOURCES.has(String(attr.utmSource || '').trim().toLowerCase())
}

// spendByAd: Map<adId, { adName, campaignId, ... }> from Meta Insights.
function resolveWebsiteAdId(attr, spendByAd) {
  if (!isFacebookClick(attr)) return null
  const content = String(attr.utmContent || '').trim()
  if (!content) return null
  if (META_ID.test(content)) return content

  const campaignId = String(attr.campaignId || '').trim()
  const matches = []
  for (const [adId, m] of spendByAd || []) {
    if (m.adName !== content) continue
    if (campaignId && String(m.campaignId) !== campaignId) continue
    matches.push(adId)
  }
  // The same ad name reused in several campaigns, with no campaign id to pick
  // between them, can't be credited to one ad.
  return matches.length === 1 ? matches[0] : null
}

module.exports = { isFacebookClick, resolveWebsiteAdId }
