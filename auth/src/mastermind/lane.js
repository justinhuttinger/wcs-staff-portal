// Infer the lane (functional area in the WCS Marketing space) from a ClickUp task.
// Lane names map to the spec's five lanes and channel sub-lists.
function inferLane(task) {
  const listName = task?.list?.name || ''
  const folderName = task?.folder?.name || ''
  const combined = `${folderName} ${listName}`.toLowerCase()

  if (/campaign lab/.test(combined)) return 'campaign_lab'
  if (/post lab/.test(combined)) return 'post_lab'
  if (/content lab/.test(combined)) return 'content_lab'
  if (/campaign/.test(combined)) return 'campaign'
  if (/content calendar|published archive/.test(combined)) return 'social_calendar'
  if (/social media/.test(combined)) return 'social_calendar'
  if (/email|sms/.test(combined)) return 'channel.email'
  if (/instagram|tiktok|facebook(?! ad)/.test(combined)) return 'channel.social'
  if (/blog|seo/.test(combined)) return 'channel.seo'
  if (/meta|fb ad|fb-ad|facebook ad/.test(combined)) return 'channel.meta'
  if (/flyer|print/.test(combined)) return 'channel.flyers'
  if (/app blast|push/.test(combined)) return 'channel.appblast'
  if (/promotion|in-gym|promo/.test(combined)) return 'channel.promo'
  if (/inbox/.test(combined)) return 'inbox'
  if (/strategy|planning/.test(combined)) return 'strategy'
  if (/performance/.test(combined)) return 'performance'
  return 'unknown'
}

function inferChannel(task) {
  const lane = inferLane(task)
  if (lane.startsWith('channel.')) return lane.split('.')[1]
  return null
}

module.exports = { inferLane, inferChannel }
