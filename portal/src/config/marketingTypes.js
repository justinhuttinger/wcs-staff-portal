// Marketing Tracker — effort types + per-type custom fields.
// Keep `slug` values in sync with the TYPES set in
// auth/src/routes/marketingTracker.js.
//
// Common fields (title, locations, status, start/end dates, notes) live on
// every effort and are handled by the form directly. The `fields` array here
// is the EXTRA, type-specific set stored in the `custom` JSONB blob.
//
// Field shapes:
//   { key, label, type: 'text' | 'url' | 'textarea' | 'select', options?: [] }

export const MARKETING_TYPES = [
  {
    slug: 'meta_ad',
    label: 'Meta Ad',
    fields: [
      { key: 'objective', label: 'Objective', type: 'text' },
      { key: 'creative_link', label: 'Creative Link', type: 'url' },
      { key: 'copy', label: 'Copy', type: 'textarea' },
    ],
  },
  {
    slug: 'social_post',
    label: 'Social Post',
    fields: [
      { key: 'platform', label: 'Platform', type: 'select', options: ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn'] },
      { key: 'creative_link', label: 'Creative Link', type: 'url' },
      { key: 'copy', label: 'Copy', type: 'textarea' },
    ],
  },
  {
    slug: 'flyer',
    label: 'Flyer',
    fields: [
      { key: 'creative_link', label: 'Creative Link', type: 'url' },
      { key: 'headline', label: 'Headline / Purpose', type: 'text' },
    ],
  },
  {
    slug: 'facebook_event',
    label: 'Facebook Event',
    fields: [
      { key: 'copy', label: 'Copy', type: 'textarea' },
      { key: 'creative_link', label: 'Creative Link', type: 'url' },
    ],
  },
  {
    slug: 'email',
    label: 'Email',
    fields: [
      { key: 'audience', label: 'Segment / Audience', type: 'text' },
      { key: 'creative_link', label: 'Creative Link', type: 'url' },
    ],
  },
  {
    slug: 'sms',
    label: 'SMS',
    fields: [
      { key: 'audience', label: 'Segment / Audience', type: 'text' },
      { key: 'message', label: 'Message Text', type: 'textarea' },
    ],
  },
  {
    slug: 'app_blast',
    label: 'App Blast',
    fields: [
      { key: 'message', label: 'Message Text', type: 'textarea' },
    ],
  },
  {
    slug: 'ad_tvs',
    label: 'Ad TVs',
    fields: [
      { key: 'asset_link', label: 'Asset Link', type: 'url' },
    ],
  },
  {
    slug: 'website',
    label: 'Website',
    fields: [
      { key: 'page', label: 'Page', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
]

export const TYPE_BY_SLUG = Object.fromEntries(MARKETING_TYPES.map(t => [t.slug, t]))

export function typeLabel(slug) {
  return TYPE_BY_SLUG[slug]?.label || slug
}

// Static Tailwind class strings per type (full strings so the JIT keeps them).
export const TYPE_STYLES = {
  meta_ad:        { badge: 'bg-blue-50 text-blue-700 border-blue-200',     dot: 'bg-blue-500',    chip: 'bg-blue-50 border-blue-200 hover:border-blue-300' },
  social_post:    { badge: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500',  chip: 'bg-purple-50 border-purple-200 hover:border-purple-300' },
  flyer:          { badge: 'bg-amber-50 text-amber-700 border-amber-200',   dot: 'bg-amber-500',   chip: 'bg-amber-50 border-amber-200 hover:border-amber-300' },
  facebook_event: { badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500', chip: 'bg-indigo-50 border-indigo-200 hover:border-indigo-300' },
  email:          { badge: 'bg-teal-50 text-teal-700 border-teal-200',     dot: 'bg-teal-500',    chip: 'bg-teal-50 border-teal-200 hover:border-teal-300' },
  sms:            { badge: 'bg-green-50 text-green-700 border-green-200',   dot: 'bg-green-500',   chip: 'bg-green-50 border-green-200 hover:border-green-300' },
  app_blast:      { badge: 'bg-pink-50 text-pink-700 border-pink-200',     dot: 'bg-pink-500',    chip: 'bg-pink-50 border-pink-200 hover:border-pink-300' },
  ad_tvs:         { badge: 'bg-cyan-50 text-cyan-700 border-cyan-200',     dot: 'bg-cyan-500',    chip: 'bg-cyan-50 border-cyan-200 hover:border-cyan-300' },
  website:        { badge: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-500',   chip: 'bg-slate-50 border-slate-200 hover:border-slate-300' },
}

export const DEFAULT_TYPE_STYLE = { badge: 'bg-gray-50 text-gray-700 border-gray-200', dot: 'bg-gray-500', chip: 'bg-gray-50 border-gray-200 hover:border-gray-300' }

export function typeStyle(slug) {
  return TYPE_STYLES[slug] || DEFAULT_TYPE_STYLE
}

export const STATUSES = [
  { key: 'planned', label: 'Planned', badge: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { key: 'approved', label: 'Approved', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'complete', label: 'Complete', badge: 'bg-green-50 text-green-700 border-green-200' },
]

export const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]))
