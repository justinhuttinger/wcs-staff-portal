/**
 * "One ad, many versions": a single Meta ad that carries several images or
 * videos and several primary texts / headlines / descriptions, and lets Meta
 * mix them and lean into the combinations that perform.
 *
 * Built on Meta's Dynamic Creative, which is the documented way to do this for
 * the Leads and Traffic objectives on Graph v21:
 *   - the creative carries an `asset_feed_spec` and a bare object_story_spec
 *     ({page_id, instagram_user_id}); everything else lives in the feed
 *   - the ad set must have been CREATED with is_dynamic_creative=true, and it
 *     holds exactly one ad
 * Meta's newer "flexible ad format" (creative_asset_groups_spec) is limited to
 * the Sales and App Promotion objectives, which is why it is not used here.
 *
 * Docs: marketing-api/ad-creative/asset-feed-spec (+ /options for the limits,
 * + /dynamic-creative for the ad set rules).
 */

// Meta's own caps, from the asset feed restrictions. `total` counts every
// asset in the feed, including the one ad format, link and call to action.
const FLEX_LIMITS = {
  images: 10,
  videos: 10,
  bodies: 5,
  titles: 5,
  descriptions: 5,
  total: 30,
  bodyChars: 1024,
  titleChars: 255,
  descriptionChars: 255,
}

// The ad format, the link and the call to action each count as one asset.
const FIXED_ASSETS = 3

const FACEBOOK_URL = /^https?:\/\/([^/]*\.)?(facebook|fb)\.(com|me)(\/|$)/i

// Trimmed, blank rows dropped, exact repeats collapsed. Meta would count a
// duplicate as a second version of the same line, which only wastes a slot.
function cleanTexts(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const text = String(raw == null ? '' : raw).trim()
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

function splitMedia(media) {
  const images = []
  const videos = []
  for (const m of Array.isArray(media) ? media : []) {
    if (!m) continue
    if (m.video_id) {
      if (!videos.some(v => v.video_id === String(m.video_id))) {
        const video = { video_id: String(m.video_id) }
        // Every video in a feed needs a poster frame, same as a single video ad.
        if (m.thumbnail_url) video.thumbnail_url = m.thumbnail_url
        else if (m.thumbnail_hash) video.thumbnail_hash = m.thumbnail_hash
        videos.push(video)
      }
    } else if (m.image_hash) {
      if (!images.some(i => i.hash === m.image_hash)) images.push({ hash: m.image_hash })
    }
  }
  return { images, videos }
}

// Everything wrong with a request, as sentences a person can act on. Empty
// means it is safe to send to Meta.
function flexibleAdProblems(input) {
  const problems = []
  const src = input || {}
  const { images, videos } = splitMedia(src.media)
  const bodies = cleanTexts(src.bodies)
  const titles = cleanTexts(src.titles)
  const descriptions = cleanTexts(src.descriptions)
  const leadFormId = src.lead_gen_form_id ? String(src.lead_gen_form_id).trim() : ''
  const link = String(src.link || '').trim()

  if (!src.page_id) problems.push('A Facebook Page is required')

  if (!link) {
    problems.push(leadFormId
      ? 'Lead ads still need your website link. Nobody lands on it (the form opens in Facebook), but Meta requires one that points off Facebook.'
      : 'A destination link is required')
  } else if (!/^https?:\/\//i.test(link)) {
    problems.push('The link needs to start with http:// or https://')
  } else if (leadFormId && FACEBOOK_URL.test(link)) {
    problems.push('A lead ad cannot link to a Facebook Page. Use your website: Meta requires an external URL on the creative.')
  }
  if (leadFormId && !/^\d{6,}$/.test(leadFormId)) problems.push('The Instant form ID should be all digits')

  if (!images.length && !videos.length) problems.push('Add at least one image or video')
  if (images.length > FLEX_LIMITS.images) problems.push(`Meta allows at most ${FLEX_LIMITS.images} images in one ad`)
  if (videos.length > FLEX_LIMITS.videos) problems.push(`Meta allows at most ${FLEX_LIMITS.videos} videos in one ad`)
  if (!bodies.length) problems.push('Add at least one primary text')
  if (bodies.length > FLEX_LIMITS.bodies) problems.push(`Meta allows at most ${FLEX_LIMITS.bodies} primary texts`)
  if (titles.length > FLEX_LIMITS.titles) problems.push(`Meta allows at most ${FLEX_LIMITS.titles} headlines`)
  if (descriptions.length > FLEX_LIMITS.descriptions) problems.push(`Meta allows at most ${FLEX_LIMITS.descriptions} descriptions`)

  if (bodies.some(t => t.length > FLEX_LIMITS.bodyChars)) problems.push(`Primary text is capped at ${FLEX_LIMITS.bodyChars} characters`)
  if (titles.some(t => t.length > FLEX_LIMITS.titleChars)) problems.push(`Headlines are capped at ${FLEX_LIMITS.titleChars} characters`)
  if (descriptions.some(t => t.length > FLEX_LIMITS.descriptionChars)) problems.push(`Descriptions are capped at ${FLEX_LIMITS.descriptionChars} characters`)

  const total = images.length + videos.length + bodies.length + titles.length + descriptions.length + FIXED_ASSETS
  if (total > FLEX_LIMITS.total) {
    problems.push(`That is ${total} assets and Meta caps one ad at ${FLEX_LIMITS.total} (the format, link and button count as 3). Drop some media or text.`)
  }
  return problems
}

// Turns the builder's flat request into the creative Meta expects. Throws with
// every problem at once rather than one per round-trip.
//
// Returns the call_to_action separately so the caller can hand it to
// urlTagsFor, which decides website-vs-form the same way for every ad type.
function buildFlexibleCreative(input) {
  const problems = flexibleAdProblems(input)
  if (problems.length) {
    const err = new Error(problems.join('. '))
    err.problems = problems
    throw err
  }

  const { images, videos } = splitMedia(input.media)
  const bodies = cleanTexts(input.bodies)
  const titles = cleanTexts(input.titles)
  const descriptions = cleanTexts(input.descriptions)
  const leadFormId = input.lead_gen_form_id ? String(input.lead_gen_form_id).trim() : ''
  const link = String(input.link).trim()
  const ctaType = input.call_to_action || (leadFormId ? 'SIGN_UP' : 'LEARN_MORE')

  const call_to_action = { type: ctaType, value: { link } }
  if (leadFormId) call_to_action.value.lead_gen_form_id = leadFormId

  // One format per feed. AUTOMATIC_FORMAT is the documented way to mix images
  // and videos in a Dynamic Creative feed; Meta picks per placement.
  let adFormat = 'SINGLE_IMAGE'
  if (images.length && videos.length) adFormat = 'AUTOMATIC_FORMAT'
  else if (videos.length) adFormat = 'SINGLE_VIDEO'

  const asset_feed_spec = {
    bodies: bodies.map(text => ({ text })),
    link_urls: [{ website_url: link }],
    call_to_action_types: [ctaType],
    ad_formats: [adFormat],
  }
  if (images.length) asset_feed_spec.images = images
  if (videos.length) asset_feed_spec.videos = videos
  if (titles.length) asset_feed_spec.titles = titles.map(text => ({ text }))
  // Left out when empty, same as the single ads: Meta then fills the
  // description from the link, exactly as it does for them.
  if (descriptions.length) asset_feed_spec.descriptions = descriptions.map(text => ({ text }))
  // The form id has nowhere to live in call_to_action_types, which is a bare
  // list of button names. call_to_actions carries the full button, value and all.
  if (leadFormId) asset_feed_spec.call_to_actions = [call_to_action]

  const object_story_spec = { page_id: String(input.page_id) }
  if (input.instagram_user_id) object_story_spec.instagram_user_id = String(input.instagram_user_id)

  return { object_story_spec, asset_feed_spec, call_to_action }
}

// Why an ad set cannot take one of these ads, or null when it can. Checked
// before any write so a wrong pick costs one read instead of a failed creative
// left behind in the account.
function adsetProblem(adset, existingAds, isLeadAd) {
  if (!adset) return 'Ad set not found'
  if (adset.is_dynamic_creative !== true) {
    return 'This ad set was not created for "one ad, many versions". Meta only allows it in an ad set ' +
      'that had Dynamic Creative switched on when it was created, and that setting cannot be changed ' +
      'afterwards. Create a new ad set with "One ad, many versions" ticked, then build the ad there.'
  }
  if (existingAds > 0) {
    return 'This ad set already has its ad. Meta allows exactly one ad in a Dynamic Creative ad set. ' +
      'Create another ad set for a second one.'
  }
  if (isLeadAd && adset.destination_type !== 'ON_AD') {
    return 'This ad set does not deliver an Instant Form. Set its destination to the Instant Form ' +
      '(destination_type ON_AD) before adding a form ad. Meta rejects the creative otherwise.'
  }
  return null
}

module.exports = { FLEX_LIMITS, cleanTexts, flexibleAdProblems, buildFlexibleCreative, adsetProblem }
