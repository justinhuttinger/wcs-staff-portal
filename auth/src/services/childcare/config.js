// auth/src/services/childcare/config.js
// Static config for the childcare headcount report.
'use strict'

module.exports = {
  // Operandio process name -> block. Resolved to process IDS at request time
  // (see processes.js); job rows carry a stale name snapshot after a rename.
  BLOCKS: {
    'morning childcare checklist': 'morning',
    'evening childcare checklist': 'evening',
  },

  // The two number steps, matched on normalized name. Duplicating a step in
  // the Operandio UI appends " (copy)" to its name — that happened on the very
  // first build of these questions, so normalization strips it rather than
  // silently dropping a whole metric.
  METRICS: {
    'total number of children older than 1 year': 'over1',
    'total number of children younger than 1 year': 'under1',
  },

  // Report key, used by the route gate, permission_catalog and the tile.
  REPORT_KEY: 'childcare',
}
