// Board areas: one club's Group X schedule split into two boards.
//
// Some clubs run two kinds of class in two different rooms and want a sheet
// and a screen for each. The split follows the ABC "custom category" on the
// class TYPE: a type in the "Ultimate" category goes on the Ultimate board,
// everything else (including a type with no category at all) stays on the
// Group X board. Fixing a misfiled class is then a category change in ABC, not
// a deploy.
//
// Only clubs with the groupx_areas feature switched on are split. Everyone
// else keeps one board with every class on it, and an ?area= on their URL is
// ignored rather than hiding classes.

const AREAS = [
  { key: 'groupx', label: 'Group X' },
  { key: 'ultimate', label: 'Ultimate' },
]
const DEFAULT_AREA = 'groupx'

function areaByKey(key) {
  const k = String(key || '').trim().toLowerCase()
  return AREAS.find(a => a.key === k) || null
}

// ABC category names -> area key. Case-insensitive, because the names are
// typed by hand in ABC.
function areaForCategories(categories) {
  const names = (categories || []).map(c => String(c || '').trim().toLowerCase())
  return names.includes('ultimate') ? 'ultimate' : DEFAULT_AREA
}

// A built board week (lib/groupXPublic buildDays) narrowed to one area. Returns
// a copy: the unfiltered week is what sits in the cache.
function filterWeekByArea(week, areaKey) {
  if (!week || !areaKey) return week
  return {
    ...week,
    days: (week.days || []).map(d => ({
      ...d,
      classes: (d.classes || []).filter(c => (c.area || DEFAULT_AREA) === areaKey),
    })),
  }
}

module.exports = { AREAS, DEFAULT_AREA, areaByKey, areaForCategories, filterWeekByArea }
