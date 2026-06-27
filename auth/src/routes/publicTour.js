const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubNumberForLocationName } = require('../config/clubMap')
const { buildTourWebhookPayload } = require('../lib/tourWebhook')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()

// The tour-member list must match what staff see on the Day One booking page:
// the GHL "Day One Booking Team Member" dropdown options. Those are kept in sync
// from the LIVE ABC per-club roster by ghl-sync (employeeSync), so they include
// multi-club people (e.g. owners) that the deduped abc_employees table drops.
// We read the GHL field options directly and fall back to the table on failure.
const DAY_ONE_FIELD_KEY = 'contact.day_one_booking_team_member'
const employeeCache = {} // slug -> { names: string[], at: number }
const EMP_TTL = 30 * 60 * 1000

function optionLabel(o) {
  if (typeof o === 'string') return o
  return (o && (o.label || o.value || o.name || o.option)) || ''
}

// Read the location's GHL "Day One Booking Team Member" options. Returns an array
// of names, or null if this location has no GHL config (caller then falls back).
async function rosterFromGHL(locationName) {
  const slug = (locationName || '').trim().toLowerCase()
  const cached = employeeCache[slug]
  if (cached && (Date.now() - cached.at) < EMP_TTL) return cached.names
  const loc = getLocationBySlug(slug)
  if (!loc) return null
  const data = await ghlFetch(`/locations/${loc.id}/customFields`, loc.apiKey)
  const fields = data.customFields || []
  const field = fields.find(f =>
    f.fieldKey === DAY_ONE_FIELD_KEY ||
    (f.name || '').toLowerCase() === 'day one booking team member')
  const names = (field?.picklistOptions || field?.options || []).map(optionLabel).filter(Boolean)
  employeeCache[slug] = { names, at: Date.now() }
  return names
}

// Fallback: active ABC employees for the location's club from our synced table.
async function rosterFromTable(locationName) {
  const club = clubNumberForLocationName(locationName)
  if (!club) return []
  const { data } = await supabaseAdmin
    .from('abc_employees')
    .select('full_name, first_name, last_name')
    .eq('club_number', club)
    .ilike('status', 'active')
  return (data || [])
    .map(e => e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '))
    .filter(Boolean)
}

// NOTE: this router is intentionally NOT behind the authenticate middleware.
// Access is gated entirely by the unguessable per-location public_token.

const SELECT_COLS =
  'id, received_at, ghl_contact_id, contact_name, contact_email, contact_phone, ' +
  'photo_base64, location_id, status, outcome, notes, tour_member, completed_at'

const ALLOWED_OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour']

// Resolve a token -> active config row (+ location). Returns null if not found.
async function resolveToken(token) {
  if (!token) return null
  const { data: cfg } = await supabaseAdmin
    .from('tour_location_config')
    .select('location_id, day_one_base_url, webhook_url, active')
    .eq('public_token', token)
    .maybeSingle()
  if (!cfg || !cfg.active) return null
  const { data: loc } = await supabaseAdmin
    .from('locations')
    .select('id, name')
    .eq('id', cfg.location_id)
    .maybeSingle()
  if (!loc) return null
  return { cfg, location: loc }
}

// GET /public/tour/:token -> location name, day one link, ready + completed queues
router.get('/:token', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    // Only the live queue. Completed tours are deleted on outcome-save (the
    // outbound webhook is the record on the way out), so there is no completed list.
    const { data: ready } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .eq('status', 'ready')
      .order('received_at', { ascending: false })
      .limit(200)

    res.json({
      location_name: ctx.location.name,
      day_one_base_url: ctx.cfg.day_one_base_url || null,
      vapid_public_key: process.env.VAPID_PUBLIC_KEY || null,
      ready: ready || [],
    })
  } catch (err) {
    console.error('[public-tour] list failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/employees -> the location's Day One booking team member
// list (matches the GHL field), A-Z. Falls back to the ABC employees table.
router.get('/:token/employees', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    let names = null
    try {
      names = await rosterFromGHL(ctx.location.name)
    } catch (err) {
      console.error('[public-tour] GHL roster failed, falling back to table:', err.message)
    }
    if (!names || names.length === 0) {
      names = await rosterFromTable(ctx.location.name)
    }

    const employees = [...new Set(names)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((name, i) => ({ id: String(i), name }))
    res.json({ employees })
  } catch (err) {
    console.error('[public-tour] employees failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// PATCH /public/tour/:token/intake/:id -> save outcome, complete, fire webhook
router.patch('/:token/intake/:id', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const { tour_member, outcome, notes, status } = req.body || {}
    const cancelled = status === 'cancelled'
    if (!cancelled && !ALLOWED_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: 'invalid outcome' })
    }

    // Confirm the intake belongs to this token's location before mutating.
    const { data: existing } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('id', req.params.id)
      .maybeSingle()
    if (!existing || existing.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    // Fire the outbound per-location webhook with the final outcome (it carries
    // everything downstream needs), THEN delete the row. The iPad is a transient
    // queue: completed tours are not retained and there is no Completed tab.
    if (ctx.cfg.webhook_url && !cancelled) {
      const payload = buildTourWebhookPayload(ctx.location, {
        ...existing,
        tour_member: tour_member || null,
        outcome,
        notes: notes || null,
        completed_at: new Date().toISOString(),
      })
      fetch(ctx.cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(e => console.error('[public-tour] webhook post failed:', e.message))
    }

    const { error } = await supabaseAdmin
      .from('tour_intakes')
      .delete()
      .eq('id', req.params.id)
    if (error) {
      console.error('[public-tour] delete failed:', error.message)
      return res.status(500).json({ error: 'failed to save' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[public-tour] patch error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// POST /public/tour/:token/subscribe -> register this iPad's Web Push subscription
// for the token's location. Idempotent on endpoint (re-subscribing updates keys
// and can move a device to a new location).
router.post('/:token/subscribe', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const sub = (req.body && req.body.subscription) || req.body || {}
    const endpoint = sub.endpoint
    const p256dh = sub.keys && sub.keys.p256dh
    const auth = sub.keys && sub.keys.auth
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'invalid subscription' })
    }

    const { error } = await supabaseAdmin
      .from('tour_push_subscriptions')
      .upsert({
        location_id: ctx.location.id,
        endpoint,
        p256dh,
        auth,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
    if (error) {
      console.error('[public-tour] subscribe failed:', error.message)
      return res.status(500).json({ error: 'failed to subscribe' })
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[public-tour] subscribe error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// PROTOTYPE: fast ABC member lookup (search the synced abc_members table).
// Token-gated like the rest of /public/tour. NOTE: this is a test/prototype and
// exposes member PII to anyone with the (unguessable) tour token across all
// clubs — fine for staff testing; a production version should tighten scope/auth.
// ---------------------------------------------------------------------------
const ABC_SEARCH_COLS =
  'member_id, club_number, home_club, first_name, last_name, email, primary_phone, ' +
  'mobile_phone, barcode, member_status, is_active, membership_type, since_date, ' +
  'begin_date, expiration_date, last_check_in_timestamp, total_check_in_count, ' +
  'is_past_due, next_due_amount, sales_person_name, agreement_entry_source'

// GET /public/tour/:token/abc-search?q=... -> matching abc_members (max 25).
// Each whitespace token must match (AND); within a token we OR across name/
// email/phone/barcode (ILIKE). So "john smith" finds first~john AND last~smith.
router.get('/:token/abc-search', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const raw = (req.query.q || '').toString()
    const tokens = raw.replace(/[%(),*"']/g, ' ').split(/\s+/).filter(t => t.length >= 2).slice(0, 4)
    if (!tokens.length) return res.json({ members: [] })

    let q = supabaseAdmin.from('abc_members').select(ABC_SEARCH_COLS)
    for (const t of tokens) {
      const pat = '"%' + t + '%"'
      q = q.or(
        'first_name.ilike.' + pat + ',last_name.ilike.' + pat + ',email.ilike.' + pat +
        ',primary_phone.ilike.' + pat + ',mobile_phone.ilike.' + pat + ',barcode.ilike.' + pat
      )
    }
    const { data, error } = await q
      .order('last_check_in_timestamp', { ascending: false, nullsFirst: false })
      .limit(25)
    if (error) {
      console.error('[public-tour] abc-search failed:', error.message)
      return res.status(500).json({ error: 'search failed' })
    }
    res.json({ members: data || [] })
  } catch (err) {
    console.error('[public-tour] abc-search error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/abc-search-test -> a self-contained test page (same
// origin as the search endpoint, so no CORS). Open it in a browser to try it.
router.get('/:token/abc-search-test', async (req, res) => {
  const ctx = await resolveToken(req.params.token)
  if (!ctx) return res.status(404).send('not found')
  const tokenJson = JSON.stringify(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ABC Member Lookup (test)</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; background:#f3f4f6; color:#111827; }
  .wrap { max-width:760px; margin:0 auto; padding:20px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#6b7280; font-size:13px; margin:0 0 16px; }
  input { width:100%; padding:14px 16px; font-size:18px; border:1px solid #d1d5db; border-radius:12px; outline:none; }
  input:focus { border-color:#dc2626; }
  .status { color:#6b7280; font-size:13px; margin:12px 2px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:14px 16px; margin-top:12px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .row1 { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .name { font-size:17px; font-weight:600; }
  .badges { display:flex; gap:6px; flex-wrap:wrap; }
  .b { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; border:1px solid; }
  .b.green { background:#ecfdf5; color:#047857; border-color:#a7f3d0; }
  .b.gray { background:#f3f4f6; color:#374151; border-color:#e5e7eb; }
  .b.red { background:#fef2f2; color:#b91c1c; border-color:#fecaca; }
  .meta { color:#374151; font-size:13px; margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; }
  .meta b { color:#6b7280; font-weight:500; }
</style></head><body>
<div class="wrap">
  <h1>ABC Member Lookup <span style="color:#dc2626">(test)</span></h1>
  <p class="sub">Search the synced ABC database by name, email, phone, or barcode.</p>
  <input id="q" autocomplete="off" autocapitalize="off" placeholder="Type a name, email, phone, or barcode…" />
  <div class="status" id="status">Start typing to search.</div>
  <div id="results"></div>
</div>
<script>
  var TOKEN = ${tokenJson};
  var qEl = document.getElementById('q');
  var statusEl = document.getElementById('status');
  var resultsEl = document.getElementById('results');
  var timer = null, seq = 0;
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function d(s){ return s ? String(s).slice(0,10) : '-'; }
  function badge(m){
    var out = '';
    out += '<span class="b ' + (m.is_active ? 'green' : 'gray') + '">' + esc(m.member_status || (m.is_active ? 'Active' : 'Inactive')) + '</span>';
    if (m.is_past_due) out += '<span class="b red">Past due</span>';
    return out;
  }
  function card(m){
    var name = esc((m.first_name||'') + ' ' + (m.last_name||'')).trim() || 'Unknown';
    var h = '<div class="card"><div class="row1"><div class="name">' + name + '</div><div class="badges">' + badge(m) + '</div></div>';
    h += '<div class="meta">';
    h += '<div><b>Member #</b> ' + esc(m.member_id) + '</div>';
    h += '<div><b>Club</b> ' + esc(m.club_number) + (m.home_club ? ' (home ' + esc(m.home_club) + ')' : '') + '</div>';
    h += '<div><b>Email</b> ' + esc(m.email || '-') + '</div>';
    h += '<div><b>Phone</b> ' + esc(m.primary_phone || m.mobile_phone || '-') + '</div>';
    h += '<div><b>Membership</b> ' + esc(m.membership_type || '-') + '</div>';
    h += '<div><b>Barcode</b> ' + esc(m.barcode || '-') + '</div>';
    h += '<div><b>Since</b> ' + d(m.since_date || m.begin_date) + '</div>';
    h += '<div><b>Expires</b> ' + d(m.expiration_date) + '</div>';
    h += '<div><b>Last check-in</b> ' + d(m.last_check_in_timestamp) + ' (' + esc(m.total_check_in_count||0) + ')</div>';
    h += '<div><b>Sales</b> ' + esc(m.sales_person_name || '-') + '</div>';
    h += '</div></div>';
    return h;
  }
  function run(){
    var val = qEl.value.trim();
    if (val.length < 2){ statusEl.textContent = 'Start typing to search.'; resultsEl.innerHTML=''; return; }
    var mine = ++seq;
    statusEl.textContent = 'Searching…';
    fetch('/public/tour/' + encodeURIComponent(TOKEN) + '/abc-search?q=' + encodeURIComponent(val))
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (mine !== seq) return;
        var ms = (j && j.members) || [];
        statusEl.textContent = ms.length ? (ms.length + ' match' + (ms.length===1?'':'es')) : 'No matches.';
        resultsEl.innerHTML = ms.map(card).join('');
      })
      .catch(function(){ if (mine===seq) statusEl.textContent = 'Search failed.'; });
  }
  qEl.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(run, 250); });
  qEl.focus();
</script>
</body></html>`)
})

module.exports = router
