// WCS University — trainee-facing web app (server-rendered).
//
// Embedded in GHL via a Custom Menu Link that passes the logged-in user's
// context as URL params (?phone=&email=&name=…). The route resolves the
// trainee's data server-side and this module renders a self-contained HTML page
// (no build step, framable). Three tabs: My Progress, My Calls, Training.

const CALL_TYPE_LABELS = {
  cold_lead: 'Cold lead',
  mid_trial: 'Mid-trial check-in',
  expired_trial: 'Expired-trial winback',
  new_member: 'New member onboarding',
}

const SCENARIO_LEAD = {
  price_sensitive_snapchat: 'Marcus',
  tire_kicker: 'Dylan',
  ready_to_buy: 'Sarah',
  hostile: 'Greg',
  confused: 'Priya',
}

// Humanize a milestone key for display (roleplay_cold_lead -> "Cold lead").
function milestoneLabel(key) {
  if (CALL_TYPE_LABELS[key.replace(/^roleplay_/, '')]) {
    return CALL_TYPE_LABELS[key.replace(/^roleplay_/, '')]
  }
  const map = {
    roleplay_winback: 'Expired-trial winback',
    objection_handling: 'Objection handling',
    first_call_made: 'First call made',
    mod1: 'Module 1',
  }
  return map[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function scoreColor(n) {
  if (n == null) return '#9ca3af'
  if (n >= 80) return '#16a34a'
  if (n >= 60) return '#d97706'
  return '#dc2626'
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

function renderProgress({ graduation, milestones, requiredKeys }) {
  const byKey = Object.fromEntries((milestones || []).map(m => [m.milestone_key, m]))
  const pct = graduation?.progress_pct != null ? Math.round(graduation.progress_pct) : 0
  const eligible = !!graduation?.eligible

  const items = (requiredKeys || []).map(key => {
    const m = byKey[key]
    const passed = !!m?.passed
    const best = m?.best_score != null ? Math.round(m.best_score) : null
    const attempts = m?.attempts || 0
    return `
      <li class="ms ${passed ? 'done' : ''}">
        <span class="ms-check">${passed ? '✓' : ''}</span>
        <span class="ms-label">${esc(milestoneLabel(key))}</span>
        <span class="ms-meta">${passed
          ? `passed${best != null ? ` · best ${best}` : ''}`
          : (attempts ? `${attempts} attempt${attempts > 1 ? 's' : ''}${best != null ? ` · best ${best}` : ''}` : 'not started')}</span>
      </li>`
  }).join('')

  return `
    <div class="card">
      <div class="grad-head">
        <div>
          <div class="grad-pct">${pct}%</div>
          <div class="muted">toward graduation</div>
        </div>
        <div class="badge ${eligible ? 'badge-ok' : 'badge-pending'}">
          ${eligible ? 'Eligible to graduate' : 'In progress'}
        </div>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="card">
      <h3>Milestones</h3>
      <ul class="ms-list">${items || '<li class="muted">No milestones configured.</li>'}</ul>
    </div>`
}

function renderCalls({ calls }) {
  if (!calls || !calls.length) {
    return `<div class="card empty">No calls yet. Head to <b>Training</b> to make your first practice call.</div>`
  }
  return calls.map((c, i) => {
    const lead = SCENARIO_LEAD[c.scenario] || 'Lead'
    const ct = CALL_TYPE_LABELS[c.call_type] || c.call_type
    const score = c.overall_score != null ? Math.round(c.overall_score) : null
    const graded = c.status === 'graded' && score != null
    return `
      <div class="card call">
        <div class="call-head" onclick="document.getElementById('d${i}').classList.toggle('open')">
          <div>
            <div class="call-title">${esc(lead)} · <span class="muted">${esc(ct)}</span></div>
            <div class="muted small">${fmtDate(c.created_at)} · ${esc(c.difficulty || '')}</div>
          </div>
          <div class="score" style="background:${scoreColor(graded ? score : null)}">
            ${graded ? score : (c.status === 'failed' ? '—' : '…')}
          </div>
        </div>
        <div id="d${i}" class="call-detail">
          ${c.strengths ? `<div class="coach"><b>Strengths.</b> ${esc(c.strengths)}</div>` : ''}
          ${c.improvements ? `<div class="coach"><b>Work on.</b> ${esc(c.improvements)}</div>` : ''}
          ${c.transcript ? `<div class="transcript">${esc(c.transcript).replace(/\n/g, '<br>')}</div>`
            : `<div class="muted small">${c.status === 'graded' ? 'No transcript captured.' : 'Awaiting transcript / grading…'}</div>`}
        </div>
      </div>`
  }).join('')
}

function renderTraining() {
  return `
    <div class="card">
      <h3>How to run a practice call</h3>
      <ol class="steps">
        <li>Open a <b>practice contact</b> in the menu and hit <b>Dial</b>.</li>
        <li>A prospect answers in character. Treat it like a real call: build rapport, uncover their need, handle the objection, and ask for the next step.</li>
        <li>Hang up when you're done. Your call is scored automatically.</li>
        <li>Come back here — your score, transcript, and coaching show under <b>My Calls</b>, and your milestones update under <b>My Progress</b>.</li>
      </ol>
    </div>
    <div class="card">
      <h3>The WCS sales process</h3>
      <ol class="steps">
        <li><b>Lead</b> — open well, build rapport, identify the prospect and their goal.</li>
        <li><b>Tour / Day One</b> — drive toward booking the in-person experience.</li>
        <li><b>Trial</b> — position the trial as the next step.</li>
        <li><b>Sale</b> — ask for the commitment and handle the objection head-on.</li>
        <li><b>Day One</b> — set up onboarding: InBody, coached workout, custom program.</li>
        <li><b>PT</b> — tee up personal training where it fits.</li>
      </ol>
    </div>
    <div class="card">
      <h3>What you're graded on</h3>
      <p class="muted">Each call type is scored on its own rubric — rapport, discovery, objection handling, asking for the commitment, and how far you moved the lead. A completed call isn't a passed call: you pass a milestone only when you score above the bar.</p>
    </div>`
}

function renderAppPage(model) {
  const { trainee } = model
  const name = trainee?.name || 'Trainee'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WCS University</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f4f4f5; color: #18181b; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 20px 16px 60px; }
  .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .top h1 { font-size: 20px; margin: 0; letter-spacing: .3px; }
  .top h1 b { color: #E31837; }
  .who { font-size: 13px; color: #71717a; }
  .tabs { display: flex; gap: 4px; background: #e4e4e7; padding: 4px; border-radius: 10px; margin-bottom: 16px; }
  .tab { flex: 1; text-align: center; padding: 9px 8px; border-radius: 7px; font-size: 14px; font-weight: 600;
    cursor: pointer; color: #52525b; border: none; background: transparent; }
  .tab.active { background: #fff; color: #18181b; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .panel { display: none; }
  .panel.active { display: block; }
  .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .card h3 { margin: 0 0 10px; font-size: 15px; }
  .muted { color: #71717a; }
  .small { font-size: 12px; }
  .grad-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .grad-pct { font-size: 32px; font-weight: 800; line-height: 1; }
  .badge { font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 999px; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .badge-pending { background: #fef9c3; color: #854d0e; }
  .bar { height: 10px; background: #e4e4e7; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: #E31837; border-radius: 999px; transition: width .4s; }
  .ms-list { list-style: none; margin: 0; padding: 0; }
  .ms { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f4f4f5; }
  .ms:last-child { border-bottom: 0; }
  .ms-check { width: 22px; height: 22px; border-radius: 999px; border: 2px solid #d4d4d8; display: flex;
    align-items: center; justify-content: center; font-size: 13px; color: #fff; flex: 0 0 auto; }
  .ms.done .ms-check { background: #16a34a; border-color: #16a34a; }
  .ms-label { font-weight: 600; flex: 1; }
  .ms-meta { font-size: 12px; color: #71717a; }
  .call-head { display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
  .call-title { font-weight: 700; }
  .score { color: #fff; font-weight: 800; min-width: 40px; height: 40px; border-radius: 10px; display: flex;
    align-items: center; justify-content: center; font-size: 15px; padding: 0 8px; }
  .call-detail { display: none; margin-top: 12px; }
  .call-detail.open { display: block; }
  .coach { font-size: 14px; margin-bottom: 8px; }
  .transcript { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px; font-size: 13px;
    line-height: 1.55; max-height: 320px; overflow-y: auto; white-space: normal; margin-top: 8px; }
  .steps { margin: 0; padding-left: 18px; line-height: 1.7; }
  .empty { text-align: center; color: #71717a; padding: 28px 16px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1><b>WCS</b> University</h1>
    <div class="who">${esc(name)}</div>
  </div>
  <div class="tabs">
    <button class="tab active" data-p="progress">My Progress</button>
    <button class="tab" data-p="calls">My Calls</button>
    <button class="tab" data-p="training">Training</button>
  </div>
  <div class="panel active" id="progress">${renderProgress(model)}</div>
  <div class="panel" id="calls">${renderCalls(model)}</div>
  <div class="panel" id="training">${renderTraining()}</div>
</div>
<script>
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById(t.dataset.p).classList.add('active');
    });
  });
</script>
</body>
</html>`
}

module.exports = { renderAppPage }
