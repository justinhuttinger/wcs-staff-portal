// Guards on the reconcile create branch (ABC member -> new GHL contact).
//
// 1. Small-cache override. reconcile.js refuses to create contacts when the
//    cached GHL contact list for a location is under ABC_RECONCILE_MIN_CONTACTS
//    (default 500), because a stale/empty cache once caused a duplicate storm.
//    A brand-new club's GHL sub-account is genuinely small, though, so it could
//    never bootstrap. ABC_RECONCILE_ALLOW_SMALL_CACHE lists the clubs (slug or
//    GHL location id, comma separated) allowed to create anyway. It is meant to
//    be set temporarily while a new club fills, then removed.
//
// 2. Per-run create cap. Each create is a GHL duplicate check + POST + 650 ms
//    pause, and the ABC sync runs every club in series under one run lock, so a
//    bootstrap of thousands of members would stall every other club for an
//    hour+. ABC_RECONCILE_MAX_CREATES_PER_RUN (default 400) spreads it over
//    several runs; the remaining members are created on the next cycles.

const DEFAULT_MAX_CREATES_PER_RUN = 400;

function allowSmallCache(location, env = process.env) {
  const raw = env.ABC_RECONCILE_ALLOW_SMALL_CACHE || '';
  const allowed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || !location) return false;
  const keys = [location.slug, location.id].filter(Boolean).map(s => String(s).toLowerCase());
  return keys.some(k => allowed.includes(k));
}

function maxCreatesPerRun(env = process.env) {
  const n = parseInt(env.ABC_RECONCILE_MAX_CREATES_PER_RUN, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CREATES_PER_RUN;
}

module.exports = { allowSmallCache, maxCreatesPerRun, DEFAULT_MAX_CREATES_PER_RUN };
