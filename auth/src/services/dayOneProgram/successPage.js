'use strict'

const { getBrand } = require('./brands')

// Branded, animated loading screen for the trainer after they submit the intake.
// Opens an SSE stream to /day-one-program/status/stream, shows a live elapsed
// timer + animated build phases, and on `done` opens the finished PDF.
function renderSuccessPage(contactId, brandKey) {
  const cid = encodeURIComponent(contactId || '')
  const brand = getBrand(brandKey)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Building Program...</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --accent: ${brand.accent}; --accent-soft: ${brand.accentSoft}; --accent-glow: ${brand.accentGlow};
            --ok: ${brand.success}; --ok-glow: ${brand.successGlow};
            --ink: #1a1d23; --muted: #6b7280; }
    html, body { height: 100%; }
    body {
      font-family: 'Inter', Arial, sans-serif;
      background: radial-gradient(1200px 600px at 50% -10%, #ffffff 0%, #f1f3f6 60%);
      color: var(--ink); display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px; overflow: hidden;
    }
    .card {
      width: 100%; max-width: 460px; text-align: center;
      background: #ffffff; border: 1px solid #e7e9ee;
      border-radius: 20px; padding: 40px 32px 34px;
      box-shadow: 0 24px 60px rgba(16,24,40,0.12);
      animation: rise .5s ease both;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    .brand { font-family: 'Bebas Neue', sans-serif; letter-spacing: 3px; color: var(--accent); font-size: 15px; }
    h1 { font-family: 'Bebas Neue', sans-serif; font-size: 34px; letter-spacing: 1px; margin: 2px 0 4px; color: var(--ink); }
    .sub { color: var(--muted); font-size: 14px; min-height: 20px; transition: opacity .2s; }

    /* Animated barbell loader */
    .loader { margin: 26px auto 18px; width: 180px; height: 60px; position: relative; }
    .bar { position: absolute; top: 28px; left: 10px; right: 10px; height: 5px; border-radius: 4px; background: #e3e6ec; }
    .plate { position: absolute; top: 14px; width: 14px; height: 32px; border-radius: 4px; background: var(--accent);
      box-shadow: 0 0 16px var(--accent-soft); }
    .plate.l1 { left: 18px; } .plate.l2 { left: 34px; opacity: .7; }
    .plate.r1 { right: 18px; } .plate.r2 { right: 34px; opacity: .7; }
    .spark { position: absolute; top: 24px; left: 0; width: 46px; height: 13px; border-radius: 8px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      filter: blur(2px); animation: slide 1.25s ease-in-out infinite; }
    @keyframes slide { 0% { left: 8%; } 50% { left: 62%; } 100% { left: 8%; } }

    .timer { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); letter-spacing: 1px; margin-top: 4px; }

    .steps { margin-top: 24px; display: grid; gap: 10px; text-align: left; }
    .step { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--muted);
      transition: color .25s; }
    .dot { width: 22px; height: 22px; border-radius: 50%; flex: 0 0 22px; border: 2px solid #d3d7df;
      display: flex; align-items: center; justify-content: center; font-size: 12px; transition: all .25s; }
    .step.active { color: var(--ink); font-weight: 600; }
    .step.active .dot { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-glow); }
    .step.active .dot::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
      animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(.6); opacity: .5; } }
    .step.done { color: #4b5563; }
    .step.done .dot { border-color: var(--ok); background: var(--ok); }
    .step.done .dot::after { content: '\\2713'; color: #fff; font-size: 12px; }

    .success-check { width: 64px; height: 64px; border-radius: 50%; background: var(--ok); color: #fff; margin: 6px auto 14px;
      display: none; align-items: center; justify-content: center; font-size: 34px; animation: pop .4s ease both;
      box-shadow: 0 0 0 6px var(--ok-glow); }
    @keyframes pop { from { transform: scale(.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    a.btn { display: none; margin-top: 16px; color: #fff; background: var(--accent); text-decoration: none;
      padding: 11px 20px; border-radius: 10px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">${brand.headline}</div>
    <h1 id="title">Building Your Program</h1>
    <div class="sub" id="sub">Warming up...</div>

    <div class="success-check" id="check">&#10003;</div>

    <div class="loader" id="loader">
      <div class="bar"></div>
      <div class="spark"></div>
      <div class="plate l2"></div><div class="plate l1"></div>
      <div class="plate r2"></div><div class="plate r1"></div>
    </div>
    <div class="timer" id="timer">0:00 elapsed</div>

    <div class="steps" id="steps">
      <div class="step" data-k="analyze"><span class="dot"></span>Reviewing client intake</div>
      <div class="step" data-k="design"><span class="dot"></span>Designing the workouts</div>
      <div class="step" data-k="pdf"><span class="dot"></span>Building the PDF</div>
      <div class="step" data-k="ready"><span class="dot"></span>Finishing up</div>
    </div>

    <a class="btn" id="openBtn" href="#">Open Program</a>
  </div>

  <script>
    var start = Date.now();
    var timerEl = document.getElementById('timer');
    var subEl = document.getElementById('sub');
    var steps = ['analyze','design','pdf','ready'];
    var ti = setInterval(function () {
      var s = Math.floor((Date.now() - start) / 1000);
      var m = Math.floor(s / 60), r = s % 60;
      timerEl.textContent = m + ':' + (r < 10 ? '0' : '') + r + ' elapsed';
    }, 250);

    function setPhase(key) {
      var hit = steps.indexOf(key);
      if (hit < 0) return;
      var els = document.querySelectorAll('.step');
      els.forEach(function (el, i) {
        el.classList.remove('active', 'done');
        if (i < hit) el.classList.add('done');
        else if (i === hit) el.classList.add('active');
      });
    }
    // Map server status/progress text to a UI phase.
    function phaseFor(status, progress) {
      var p = (progress || '').toLowerCase();
      if (status === 'rendering' || p.indexOf('pdf') >= 0) return 'pdf';
      if (status === 'ready' || status === 'delivering' || status === 'complete' || p.indexOf('ready') >= 0) return 'ready';
      if (p.indexOf('workout') >= 0 || p.indexOf('design') >= 0) return 'design';
      if (p.indexOf('client') >= 0 || status === 'generating') return 'analyze';
      return 'analyze';
    }

    function finish(jobId) {
      clearInterval(ti);
      document.getElementById('loader').style.display = 'none';
      document.getElementById('steps').style.display = 'none';
      document.getElementById('check').style.display = 'flex';
      document.getElementById('title').textContent = 'Program Ready';
      subEl.textContent = 'Opening your program...';
      if (jobId) {
        var url = '/day-one-program/pdf/' + jobId;
        var btn = document.getElementById('openBtn');
        btn.href = url; btn.style.display = 'inline-block';
        setTimeout(function () { window.location.href = url; }, 900);
      } else {
        subEl.textContent = 'Your program has been sent to the client.';
      }
    }

    setPhase('analyze');
    var es = new EventSource('/day-one-program/status/stream?contactId=${cid}');
    es.addEventListener('progress', function (e) {
      try {
        var d = JSON.parse(e.data);
        if (d.progress) subEl.textContent = d.progress;
        setPhase(phaseFor(d.status, d.progress));
      } catch (_) {}
    });
    es.addEventListener('done', function (e) {
      try { var d = JSON.parse(e.data); es.close(); finish(d.jobId); } catch (_) { es.close(); finish(null); }
    });
    es.addEventListener('failed', function () {
      clearInterval(ti); es.close();
      document.getElementById('loader').style.display = 'none';
      subEl.textContent = 'Your program is being sent to the client. You can close this page.';
    });
    es.onerror = function () { /* SSE auto-reconnects; keep the page up */ };
  </script>
</body>
</html>`
}

module.exports = { renderSuccessPage }
