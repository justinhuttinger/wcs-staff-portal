'use strict'

// Does a loaded series row actually belong to the club/facility the request
// CLAIMS in its body?
//
// canUseClub (in the route) only proves the caller may act on the club they
// claimed -- it says nothing about whether the series id in the URL actually
// belongs to that club. Without this check, a stale or malicious club_number
// in the body lets a caller delete another club's future series rows and
// have them re-created under their own club, or resurrect a cancelled series
// by editing it. Returns true when the edit must be refused.
function seriesEditRefused(series, claimedClubNumber, claimedFacility) {
  if (!series) return true
  if (series.canceled_at) return true
  if (series.club_number !== String(claimedClubNumber)) return true
  if (series.facility !== String(claimedFacility)) return true
  return false
}

module.exports = { seriesEditRefused }
