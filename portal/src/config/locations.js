// Single source of truth for gym location names
// Used across ToolGrid, Leaderboard, Reports, Communication Notes, etc.
export const LOCATION_NAMES = ['Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']

// With "All" prefix (for filter pills that include an All option)
export const LOCATIONS_WITH_ALL = ['All', ...LOCATION_NAMES]

// Slug-label pairs (for report selectors)
export const LOCATION_OPTIONS = [
  { slug: 'all', label: 'All Locations' },
  ...LOCATION_NAMES.map(name => ({ slug: name.toLowerCase(), label: name })),
]
