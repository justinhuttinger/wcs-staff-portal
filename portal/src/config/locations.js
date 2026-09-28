// Single source of truth for gym locations in the portal.
// Used across ToolGrid, Leaderboard, Reports, Communication Notes, etc.
//
// The list is clubs.json, a copy of config/clubs.json at the repo root. To add
// or change a club, edit the root file and run `node scripts/sync-clubs.js`.
import registry from './clubs.json' with { type: 'json' }

// Active clubs as { slug, name, clubNumber, envKey, timezone, active, tradingName? },
// in house order (Salem first, Medford last).
export const CLUBS = registry.clubs.filter(c => c.active)

export const LOCATION_NAMES = CLUBS.map(c => c.name)

// With "All" prefix (for filter pills that include an All option)
export const LOCATIONS_WITH_ALL = ['All', ...LOCATION_NAMES]

// Slug-label pairs (for report selectors)
export const LOCATION_OPTIONS = [
  { slug: 'all', label: 'All Locations' },
  ...CLUBS.map(c => ({ slug: c.slug, label: c.name })),
]

// ABC club number -> club name (NPS, Save offers, Day One programs, ...)
export const CLUB_NAME_BY_NUMBER = Object.fromEntries(CLUBS.map(c => [c.clubNumber, c.name]))

// Lowercased club name -> per-club photo in public/. A club without a photo
// is simply absent, so callers fall back to their default background.
export const LOCATION_BACKGROUNDS = Object.fromEntries(
  CLUBS.filter(c => c.background).map(c => [c.name.toLowerCase(), c.background]),
)
