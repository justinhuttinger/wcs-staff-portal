// Per-club report visibility: the settings key, and the rule for reading it.
//
// Deliberately holds NO list of reports. The admin screen reads the shell's own
// registry (REPORT_META, exported from AnalyticsView) rather than a second copy
// kept here.
//
// The audit toggles kept two lists — one in AuditTogglesAdmin, one in the
// report — each with a comment begging the next person to keep them in step. A
// key typed into one and not the other silently does nothing, which is the
// worst failure a visibility control can have: the switch appears to work.

/** The settings key that hides one report at one club. */
export function reportOffKey(reportKey, slug) {
  return `report_off_${reportKey}_${slug}`
}

/**
 * Is this report visible for the clubs currently selected?
 *
 * VISIBLE IF IT IS ON FOR AT LEAST ONE SELECTED CLUB. With several clubs in
 * view, hiding a report because ONE of them has it off would take it away from
 * the others too — and "All" would then show the smallest possible menu, which
 * is the opposite of what selecting every club should do.
 *
 * ABSENCE OF A SETTING MEANS VISIBLE. A report that ships tomorrow is on
 * everywhere until somebody turns it off, rather than invisible until somebody
 * turns it on seven times. The safe default is the one that cannot hide work
 * nobody knew existed.
 */
export function isReportVisible(settings, reportKey, slugs) {
  if (!settings) return true
  const list = Array.isArray(slugs) ? slugs.filter(Boolean) : []
  if (list.length === 0) return true
  return list.some(slug => settings[reportOffKey(reportKey, slug)] !== '1')
}
