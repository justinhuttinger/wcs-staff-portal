/**
 * URL parameters stamped on every website (link) ad the portal creates.
 *
 * This is HighLevel's Facebook-reporting template. Without it, a lead who
 * clicks an ad through to the website form gets Meta's automatic parameters
 * (utm_source=fb, ids only), which GHL's native Facebook ad report can't tie
 * back to an ad. The FB ROAS report reads both shapes (fbWebsiteAttribution.js).
 *
 * Instant Form (lead) ads never send anyone to the website, and GHL already
 * gets their adId from its Lead Form integration, so they're left alone.
 */

const GHL_URL_TAGS =
  'utm_source=fb_ad&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}' +
  '&utm_content={{ad.name}}&campaign_id={{campaign.id}}'

// spec: the object_story_spec from buildObjectStorySpec.
function urlTagsFor(spec) {
  const body = (spec && (spec.link_data || spec.video_data)) || {}
  const value = (body.call_to_action && body.call_to_action.value) || {}
  return value.lead_gen_form_id ? undefined : GHL_URL_TAGS
}

module.exports = { GHL_URL_TAGS, urlTagsFor }
