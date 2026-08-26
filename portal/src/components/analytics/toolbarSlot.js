// Id of the slot in the Analytics shell header where a report portals its own
// toolbar controls, so they render inline with the shared date range.
//
// This lives in its own module rather than on AnalyticsView because the shell
// imports each report and each report needs this id — importing it from the
// shell would make that cycle, and the constant would be undefined at module
// evaluation time in whichever half loaded first.
export const TOOLBAR_SLOT_ID = 'analytics-toolbar-slot'
