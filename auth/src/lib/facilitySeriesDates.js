'use strict'

// Which board dates does a series-forward edit touch?
//
// A weekday change (the headline reason this feature exists -- Tuesday series
// moved to Wednesday) means the old occurrence dates and the new occurrence
// dates can be disjoint sets. Both sides need invalidating: the old dates
// still have a deleted row cached on the board, the new dates have a row that
// wasn't there before. De-duped and sorted for a stable invalidateBoard call.
function affectedDates(oldDates, newDates) {
  return [...new Set([...(oldDates || []), ...(newDates || [])])].sort()
}

module.exports = { affectedDates }
