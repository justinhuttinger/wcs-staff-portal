// Meta Ads Manager vocabulary. These are Meta's own enum values — the labels
// are what Ads Manager shows, so the two screens stay recognisable side by side.

export const OBJECTIVES = [
  { value: 'OUTCOME_LEADS', label: 'Leads', hint: 'Forms, calls and sign-ups' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic', hint: 'Clicks to a landing page' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', hint: 'Post reactions, video views' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness', hint: 'Reach as many people as possible' },
  { value: 'OUTCOME_SALES', label: 'Sales', hint: 'Purchases and conversions' },
]

// Optimization goals are objective-specific — Meta rejects the wrong pairing
// outright, so the ad set form only offers what the parent campaign allows.
export const OPTIMIZATION_GOALS = {
  OUTCOME_LEADS: [
    { value: 'OFFSITE_CONVERSIONS', label: 'Conversions (pixel)' },
    { value: 'LEAD_GENERATION', label: 'Instant form leads' },
    { value: 'LINK_CLICKS', label: 'Link clicks' },
    { value: 'LANDING_PAGE_VIEWS', label: 'Landing page views' },
    { value: 'QUALITY_CALL', label: 'Calls' },
  ],
  OUTCOME_TRAFFIC: [
    { value: 'LANDING_PAGE_VIEWS', label: 'Landing page views' },
    { value: 'LINK_CLICKS', label: 'Link clicks' },
    { value: 'IMPRESSIONS', label: 'Impressions' },
    { value: 'REACH', label: 'Reach' },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: 'POST_ENGAGEMENT', label: 'Post engagement' },
    { value: 'THRUPLAY', label: 'Video ThruPlays' },
    { value: 'LINK_CLICKS', label: 'Link clicks' },
    { value: 'IMPRESSIONS', label: 'Impressions' },
  ],
  OUTCOME_AWARENESS: [
    { value: 'REACH', label: 'Reach' },
    { value: 'IMPRESSIONS', label: 'Impressions' },
    { value: 'AD_RECALL_LIFT', label: 'Ad recall lift' },
    { value: 'THRUPLAY', label: 'Video ThruPlays' },
  ],
  OUTCOME_SALES: [
    { value: 'OFFSITE_CONVERSIONS', label: 'Conversions (pixel)' },
    { value: 'VALUE', label: 'Value' },
    { value: 'LINK_CLICKS', label: 'Link clicks' },
  ],
}

export const BILLING_EVENTS = [
  { value: 'IMPRESSIONS', label: 'Impressions' },
  { value: 'LINK_CLICKS', label: 'Link clicks' },
  { value: 'THRUPLAY', label: 'ThruPlay' },
]

export const BID_STRATEGIES = [
  { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Highest volume (no cap)' },
  { value: 'COST_CAP', label: 'Cost per result goal' },
  { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap' },
]

// Pixel events worth optimising toward for a gym. Only shown when the goal is
// OFFSITE_CONVERSIONS, which is the only case Meta accepts them.
export const CONVERSION_EVENTS = [
  { value: 'LEAD', label: 'Lead' },
  { value: 'COMPLETE_REGISTRATION', label: 'Complete registration' },
  { value: 'SCHEDULE', label: 'Schedule' },
  { value: 'CONTACT', label: 'Contact' },
  { value: 'SUBMIT_APPLICATION', label: 'Submit application' },
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'START_TRIAL', label: 'Start trial' },
]

export const CALL_TO_ACTIONS = [
  { value: 'LEARN_MORE', label: 'Learn More' },
  { value: 'SIGN_UP', label: 'Sign Up' },
  { value: 'GET_OFFER', label: 'Get Offer' },
  { value: 'BOOK_NOW', label: 'Book Now' },
  { value: 'CONTACT_US', label: 'Contact Us' },
  { value: 'APPLY_NOW', label: 'Apply Now' },
  { value: 'GET_QUOTE', label: 'Get Quote' },
  { value: 'SUBSCRIBE', label: 'Subscribe' },
  { value: 'SHOP_NOW', label: 'Shop Now' },
  { value: 'SEND_MESSAGE', label: 'Send Message' },
  { value: 'CALL_NOW', label: 'Call Now' },
  { value: 'GET_DIRECTIONS', label: 'Get Directions' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'NO_BUTTON', label: 'No button' },
]

// Housing / employment / credit / social issues. Gyms almost never need one,
// but picking the wrong answer here gets a campaign rejected, so it is asked
// explicitly rather than silently defaulted.
export const SPECIAL_AD_CATEGORIES = [
  { value: 'NONE', label: 'None' },
  { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'HOUSING', label: 'Housing' },
  { value: 'CREDIT', label: 'Credit' },
  { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Social issues, elections or politics' },
]

export const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'audience_network', label: 'Audience Network' },
  { value: 'messenger', label: 'Messenger' },
]

export const GENDERS = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Men' },
  { value: '2', label: 'Women' },
]

// Meta's own caps. Exceeding them does not error — it truncates with an
// ellipsis in the live ad, which is worse, so the editor warns instead.
export const COPY_LIMITS = {
  message: 125,     // primary text before "See more"
  headline: 40,
  description: 30,
}

export function statusTone(status) {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    case 'PAUSED': return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    case 'WITH_ISSUES':
    case 'DISAPPROVED': return 'bg-red-500/10 text-red-600 border-red-500/20'
    case 'PENDING_REVIEW':
    case 'IN_PROCESS': return 'bg-sky-500/10 text-sky-600 border-sky-500/20'
    default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20'
  }
}

export function prettyStatus(status) {
  if (!status) return '—'
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// Meta stores budgets in minor units; the whole UI works in dollars.
export function budgetToDollars(minorUnits) {
  if (minorUnits === undefined || minorUnits === null || minorUnits === '') return ''
  return String(Number(minorUnits) / 100)
}

export function formatBudget(daily, lifetime) {
  if (daily) return `$${(Number(daily) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}/day`
  if (lifetime) return `$${(Number(lifetime) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} lifetime`
  return '—'
}
