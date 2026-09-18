// The multi-club launch itself: one ad set template + one set of variants,
// written into every selected club.
//
// Deliberately NOT a copy of one club into the others. Each club is built
// directly from the same definition, so there is no "original" whose quirks
// the rest inherit, and a club that fails leaves nothing half-copied behind.
//
// Meta access is injected (createAdset / createAd / pressure) so the ordering,
// the isolation and the stop rules are testable without touching the network.
// The route wires in the real helpers from metaAdsManager.
const { renderFields } = require('./adsTokens')
const { clubTokenValues } = require('./adsClubLaunch')

// Stop a run while the ad account is still usable. Meta meters three budgets
// and throttles the whole account when any hits 100; a launch that bulldozes
// into that lockout takes every other portal screen down with it.
const STOP_PRESSURE = 90

async function runLaunch(clubs, template, shared = {}, deps) {
  const overrides = shared.campaign_overrides || {}
  const results = []
  let stoppedEarly = false
  const skipped = []

  for (const [i, club] of (clubs || []).entries()) {
    if (stoppedEarly) { skipped.push(club.location_id); continue }

    const values = clubTokenValues(club)
    const campaignId = overrides[club.location_id] || club.campaign_id
    if (!campaignId) {
      results.push({
        location_id: club.location_id, name: club.name, ok: false, ads: [],
        error: 'No campaign chosen for this club',
      })
      continue
    }

    try {
      // Status is forced rather than passed through: a launch builds seven
      // clubs at once, and nothing here should start spending on its own.
      const adsetBody = {
        ...renderFields(template.adset || {}, values),
        campaign_id: campaignId,
        targeting: club.targeting || {},
        status: 'PAUSED',
      }
      const adset = await deps.createAdset(adsetBody)

      const adShared = {
        adset_id: adset.id,
        page_id: club.page_id,
        instagram_user_id: club.instagram_id || undefined,
        link: club.link || undefined,
        lead_gen_form_id: club.lead_form_id || undefined,
        call_to_action: shared.call_to_action,
        advantage_plus: shared.advantage_plus,
        status: 'PAUSED',
      }

      // Variants run sequentially for the same reason the single-ad-set
      // builder does: Meta's per-account write throttle, and one bad variant
      // should report itself rather than take the club down.
      const ads = []
      for (const variant of (template.variants || [])) {
        const rendered = renderFields(variant, values)
        try {
          const created = await deps.createAd(rendered, adShared)
          ads.push({ ok: true, name: rendered.name, ...created })
        } catch (err) {
          ads.push({ ok: false, name: rendered.name, error: err.message })
        }
      }

      results.push({
        location_id: club.location_id, name: club.name, ok: true,
        adset_id: adset.id, adset_name: adsetBody.name, ads,
      })
    } catch (err) {
      // An ad set that never got created has no ads to attach, so the club
      // fails whole. Nothing is left behind for a retry to trip over.
      results.push({
        location_id: club.location_id, name: club.name, ok: false, ads: [],
        error: err.message,
      })
    }

    if (deps.pressure && deps.pressure() >= STOP_PRESSURE && i < clubs.length - 1) {
      stoppedEarly = true
    }
  }

  return {
    results,
    created_clubs: results.filter(r => r.ok).map(r => r.location_id),
    failed_clubs: results.filter(r => !r.ok).map(r => r.location_id),
    skipped_clubs: skipped,
    stopped_early: stoppedEarly,
  }
}

module.exports = { runLaunch, STOP_PRESSURE }
