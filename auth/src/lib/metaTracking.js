/**
 * Offline-event tracking on a Meta ad.
 *
 * ghl-sync sends every new membership to Meta as a server-side Purchase
 * (physical_store). Meta only credits those sales to an ad whose tracking
 * includes the dataset's offline events, and Meta never adds that on its own:
 * every ad is created without it. So the ads builder appends it right after
 * creating an ad, the same spec that was added by hand to the live ads on
 * 2026-09-30.
 *
 * Pure: takes the ad's current tracking_specs and returns them with the
 * offline spec appended, or null when nothing needs to change.
 */

function hasOfflineTracking(specs, datasetId) {
  return (specs || []).some(s =>
    (s['action.type'] || []).includes('offline_conversion') &&
    ((s.dataset || []).map(String).includes(String(datasetId)) || (s.offline_conversion_data_set || []).length > 0))
}

/**
 * @param {Array} specs the ad's current tracking_specs
 * @param {string} datasetId the WCS pixel / dataset id
 * @returns {Array|null} specs to write, or null when already tracking / no dataset
 */
function withOfflineTracking(specs, datasetId) {
  if (!datasetId) return null
  if (hasOfflineTracking(specs, datasetId)) return null
  return [...(specs || []), { 'action.type': ['offline_conversion'], dataset: [String(datasetId)] }]
}

module.exports = { withOfflineTracking, hasOfflineTracking }
