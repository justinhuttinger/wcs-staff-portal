// WCS University — trainee-facing web app (server-rendered).
//
// Embedded in GHL via a Custom Menu Link (?email=&name=). Two views: the COURSE
// (a guided stepper — the training itself) and MY CALLS (graded call history).
// Visual language mirrors the Online Join / 7-day widgets: dark canvas, red
// (#ff0000) accents, white cards, Bebas Neue display + Inter body, red top rule.

const CALL_TYPE_LABELS = {
  cold_lead: 'Cold lead', mid_trial: 'Mid-trial check-in',
  expired_trial: 'Expired-trial winback', new_member: 'New member onboarding',
}
const SCENARIO_LEAD = {
  price_sensitive_snapchat: 'Marcus', tire_kicker: 'Dylan', ready_to_buy: 'Sarah',
  hostile: 'Greg', confused: 'Priya',
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
// Step body copy is authored HTML (trusted, from our config) — allow basic tags.
function richBody(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?(?:b|i|strong|em|br|ul|ol|li|p))&gt;/g, '<$1>')
}
function scoreColor(n) {
  if (n == null) return '#a0a0a8'
  if (n >= 80) return '#16a34a'
  if (n >= 60) return '#cc7000'
  return '#dc2626'
}
function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

function renderStepAction(step, course) {
  if (step.type === 'graded_call') {
    const g = course.graded || {}
    const best = g.bestRecent
    const thr = g.threshold || 80
    const tried = g.attempts > 0
    return `
      <div class="action">
        ${tried
          ? `<div class="gradeline">Best recent score: <b style="color:${scoreColor(best)}">${best != null ? Math.round(best) : '—'}</b> / need <b>${thr}</b></div>`
          : `<div class="gradeline muted">Dial the practice line to make your call.</div>`}
        <div class="encourage">${tried && (best == null || best < thr)
          ? 'Did not hit ' + thr + ' yet — call again, your best score counts.'
          : 'Score ' + thr + '+ to advance. Call as many times as you like.'}</div>
        <button class="btn btn-ghost" onclick="location.reload()">I just called — check my score</button>
      </div>`
  }
  if (step.type === 'graduation') {
    return `<div class="action"><div class="grad-note">Keep practicing any time — every call is still scored and saved.</div></div>`
  }
  if (step.type === 'action_webhook') {
    // Webhook-gated: no manual bypass. Completes only when the GHL automation
    // fires. The button just re-checks (reloads to re-run reconcile).
    return `
      <div class="action">
        <div class="encourage muted">Do this in GoHighLevel. We detect it automatically and award your points — this step unlocks on its own once it's done.</div>
        <button class="btn btn-ghost" onclick="location.reload()">I did it — check now</button>
      </div>`
  }
  // explore / info -> manual Next
  return `
    <div class="action">
      <button class="btn btn-red" onclick="advance('${esc(step.key)}', this)">Done — Next</button>
    </div>`
}

function renderCourse(model) {
  const c = model.course
  const steps = c.steps || []
  if (!steps.length) return `<div class="card empty">No course configured yet.</div>`

  const total = steps.length
  const done = steps.filter(s => s.status === 'done').length
  // The one slide in view: the current step, or the last step once graduated.
  let idx = steps.findIndex(s => s.status === 'current')
  if (idx < 0) idx = steps.length - 1
  const step = steps[idx]
  const n = idx + 1
  const pad = String(n).padStart(2, '0')

  // Horizontal progress: one segment per step (done filled, current highlighted).
  const segs = steps.map((s, i) =>
    `<span class="seg ${s.status === 'done' || (c.graduated) ? 'fill' : ''} ${i === idx && !c.graduated ? 'cur' : ''}"></span>`
  ).join('')

  return `
    <div class="deck">
      <div class="deck-top">
        <div class="counter">Step <b>${n}</b> of ${total}</div>
        <div class="deck-meta">
          <span class="pts-pill">${c.points || 0} pts</span>
          ${c.graduated ? '<span class="badge badge-grad">★ Graduated</span>' : ''}
        </div>
      </div>
      <div class="segs">${segs}</div>

      <div class="slide">
        <div class="slide-num">${pad}</div>
        <span class="eyebrow">${c.graduated ? 'Complete' : 'Current step'}${step.points ? ` · ${step.points} pts` : ''}</span>
        <h2 class="slide-title">${esc(step.title)}</h2>
        <div class="slide-body">${richBody(step.body)}</div>
        ${renderStepAction(step, c)}
        ${!c.graduated ? '<div class="reminder">↩ Come back to the University after each step to keep going.</div>' : ''}
      </div>
    </div>`
}

function renderCalls(model) {
  const calls = model.calls || []
  if (!calls.length) return `<div class="card empty">No calls yet. Your graded practice calls show up here.</div>`
  return calls.map((c, i) => {
    const lead = SCENARIO_LEAD[c.scenario] || 'Lead'
    const ct = CALL_TYPE_LABELS[c.call_type] || c.call_type || ''
    const score = c.overall_score != null ? Math.round(c.overall_score) : null
    const graded = c.status === 'graded' && score != null
    return `
      <div class="card call">
        <div class="call-head" onclick="document.getElementById('d${i}').classList.toggle('open')">
          <div>
            <div class="call-title">${esc(lead)} <span class="muted">· ${esc(ct)}</span></div>
            <div class="muted small">${fmtDate(c.created_at)}${c.difficulty ? ' · ' + esc(c.difficulty) : ''}</div>
          </div>
          <div class="score" style="background:${scoreColor(graded ? score : null)}">${graded ? score : (c.status === 'failed' ? '—' : '…')}</div>
        </div>
        <div id="d${i}" class="call-detail">
          ${c.strengths ? `<div class="coach"><span class="eyebrow">What you did well</span><p>${esc(c.strengths)}</p></div>` : ''}
          ${c.improvements ? `<div class="coach"><span class="eyebrow">Work on this</span><p>${esc(c.improvements)}</p></div>` : ''}
          ${c.transcript ? `<div class="transcript">${esc(c.transcript).replace(/\n/g, '<br>')}</div>`
            : `<div class="muted small">${c.status === 'graded' ? 'No transcript captured.' : 'Awaiting transcript / grading…'}</div>`}
        </div>
      </div>`
  }).join('')
}

function renderAppPage(model) {
  const name = model.trainee?.name || 'Trainee'
  const email = model.trainee?.email || ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>WCS University</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{
    --canvas:#0a0a0c; --surface:#fff; --surface-soft:#f6f6f4;
    --ink:#0a0a0c; --muted:#6b6b73; --soft:#a0a0a8; --border:#ececea;
    --red:#ff0000; --red-dark:#cc0000; --red-soft:#ffe5e5; --success:#16a34a;
    --display:'Bebas Neue','Anton','Archivo Black',Impact,sans-serif;
    --body:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:var(--body);background:var(--surface-soft);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased;}
  .topbar{background:var(--canvas);border-top:4px solid var(--red);color:#fff;padding:16px 18px;
    display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;}
  .brand{font-family:var(--display);font-size:1.5rem;letter-spacing:.06em;text-transform:uppercase;line-height:.95;}
  .brand b{color:var(--red);}
  .brand small{display:block;font-family:var(--body);font-size:.6rem;font-weight:600;letter-spacing:.24em;color:var(--soft);margin-top:3px;}
  .topbar-right{display:flex;align-items:center;gap:14px;}
  .who{font-size:12px;color:var(--soft);text-align:right;}
  .refresh{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:#fff;
    font-size:12px;font-weight:700;letter-spacing:.04em;padding:8px 12px;border-radius:4px;cursor:pointer;}
  .refresh:hover{background:rgba(255,255,255,.16);}
  .wrap{max-width:680px;margin:0 auto;padding:18px 16px 64px;}
  .tabs{display:flex;gap:4px;background:#e4e4e7;padding:4px;border-radius:6px;margin-bottom:16px;}
  .tab{flex:1;text-align:center;padding:9px;border-radius:4px;font-size:12px;font-weight:800;letter-spacing:.12em;
    text-transform:uppercase;cursor:pointer;border:none;background:transparent;color:#52525b;}
  .tab.active{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08);}
  .panel{display:none;} .panel.active{display:block;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;margin-bottom:12px;
    box-shadow:0 1px 3px rgba(10,10,12,.06);}
  .eyebrow{font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--red);}
  h3{font-family:var(--display);font-size:1.4rem;font-weight:400;letter-spacing:.02em;text-transform:uppercase;line-height:1.05;margin-top:2px;}
  .muted{color:var(--muted);} .small{font-size:12px;}
  .badge{font-size:11px;font-weight:800;letter-spacing:.08em;padding:7px 11px;border-radius:999px;text-transform:uppercase;}
  .badge-grad{background:#dcfce7;color:#166534;}
  /* ---- slide deck (one step in focus, horizontal progress) ---- */
  .deck-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .counter{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
  .counter b{font-family:var(--display);font-size:1.2rem;color:var(--ink);vertical-align:-2px;}
  .deck-meta{display:flex;align-items:center;gap:8px;}
  .pts-pill{background:var(--red-soft);color:var(--red-dark);font-size:11px;font-weight:800;letter-spacing:.06em;
    padding:6px 10px;border-radius:999px;text-transform:uppercase;}
  .segs{display:flex;gap:5px;margin-bottom:16px;}
  .seg{flex:1;height:6px;border-radius:999px;background:#e1e1e4;transition:background .3s;}
  .seg.fill{background:var(--success);}
  .seg.cur{background:var(--red);}
  .slide{background:#fff;border:1px solid var(--border);border-top:4px solid var(--red);border-radius:6px;
    padding:30px 26px 26px;box-shadow:0 18px 40px -20px rgba(10,10,12,.4),0 2px 6px rgba(10,10,12,.08);
    min-height:60vh;display:flex;flex-direction:column;position:relative;}
  .slide-num{position:absolute;top:18px;right:22px;font-family:var(--display);font-size:3.4rem;
    line-height:1;color:#f0f0ee;}
  .slide-title{font-family:var(--display);font-size:clamp(2rem,7vw,3rem);font-weight:400;letter-spacing:.01em;
    text-transform:uppercase;line-height:.98;margin:6px 0 16px;max-width:90%;}
  .slide-body{font-size:16px;line-height:1.65;color:#2a2a30;flex:1;}
  .slide-body b{font-weight:700;}
  .action{margin-top:22px;}
  .gradeline{font-size:14px;margin-bottom:4px;} .encourage{font-size:13px;color:var(--muted);margin-bottom:10px;}
  .grad-note{font-size:14px;color:var(--muted);}
  .reminder{margin-top:12px;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--soft);text-transform:uppercase;}
  .btn{font-family:var(--body);font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
    padding:11px 18px;border-radius:4px;border:none;cursor:pointer;}
  .btn-red{background:var(--red);color:#fff;} .btn-red:hover{background:var(--red-dark);}
  .btn-ghost{background:#fff;color:var(--ink);border:1px solid var(--border);}
  .btn:disabled{opacity:.5;cursor:default;}
  .slide .action .btn{width:100%;padding:15px;font-size:14px;}
  .call-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;}
  .call-title{font-weight:700;}
  .score{color:#fff;font-family:var(--display);font-size:1.2rem;min-width:42px;height:42px;border-radius:4px;
    display:flex;align-items:center;justify-content:center;padding:0 8px;}
  .call-detail{display:none;margin-top:12px;} .call-detail.open{display:block;}
  .coach{margin-bottom:10px;} .coach p{font-size:14px;margin-top:3px;}
  .transcript{background:var(--surface-soft);border:1px solid var(--border);border-radius:4px;padding:12px;
    font-size:13px;line-height:1.55;max-height:300px;overflow-y:auto;margin-top:8px;}
  .empty{text-align:center;color:var(--muted);padding:28px 16px;}
</style>
</head>
<body>
<div class="topbar">
  <div class="brand"><b>WCS</b> University<small>Sales Training</small></div>
  <div class="topbar-right">
    <div class="who">${esc(name)}</div>
    <button class="refresh" onclick="location.reload()">↻ Refresh</button>
  </div>
</div>
<div class="wrap">
  <div class="tabs">
    <button class="tab active" data-p="course">Course</button>
    <button class="tab" data-p="calls">My Calls</button>
  </div>
  <div class="panel active" id="course">${renderCourse(model)}</div>
  <div class="panel" id="calls">${renderCalls(model)}</div>
</div>
<script>
  var TRAINEE_EMAIL = ${JSON.stringify(email)};
  var TRAINEE_NAME = ${JSON.stringify(name)};
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
      t.classList.add('active'); document.getElementById(t.dataset.p).classList.add('active');
    });
  });
  function advance(step, btn){
    if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
    fetch('/university/progress/next', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email: TRAINEE_EMAIL, name: TRAINEE_NAME, step: step })
    }).then(function(){ location.reload(); }).catch(function(){ location.reload(); });
  }
</script>
</body>
</html>`
}

module.exports = { renderAppPage }
