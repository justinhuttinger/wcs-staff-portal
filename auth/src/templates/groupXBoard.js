// The public class board. One self-contained HTML document: inlined CSS and
// JS, no external fonts, no CDN. The only network call it makes is to its own
// /public/group-x/schedule endpoint.
//
// Design notes, so the next person does not "fix" these into something worse:
//
//  * Agenda columns, not a proportional time grid. WCS classes cluster hard at
//    6am, 9:30am and 4:30pm — a 6am-10pm grid renders ~80% empty air, which on
//    a wall-mounted TV is space stolen from type size. Stacking each day's
//    classes in time order buys roughly 3x the legible type at 20 feet.
//  * The week is derived from the CLIENT clock on every refresh, never baked
//    in at render time. A TV left running for months has to roll to the new
//    week by itself at local midnight Monday.
//  * A failed poll keeps the last good render on screen. A stale schedule
//    beats a blank TV.
//  * Type scales with viewport width so the same URL fills a 1080p or 4K
//    screen and still reads inside a narrow website iframe.

// Class name -> collar color. Keyed on the 6 real WCS class types, with a
// hashed fallback so a new class type still gets a stable color instead of
// falling back to grey.
const COLLARS = ['#ff3b30', '#ffb400', '#2fd4c8', '#7c6cff', '#4ade80', '#ff7ab8']

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderBoardHtml({ clubSlug, clubName }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Group X Schedule · West Coast Strength ${escapeHtml(clubName)}</title>
<meta name="robots" content="index, follow">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --ink:    #16181d;
    --ink-2:  #1e2129;
    --ink-3:  #262a33;
    --paper:  #f4f4f2;
    --muted:  rgba(244,244,242,.52);
    --line:   rgba(244,244,242,.10);
    --red:    #ff2d2d;
    --display: 'Arial Narrow', 'Helvetica Neue Condensed', 'Roboto Condensed', ui-sans-serif, system-ui, sans-serif;
    --ui: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--ink);
    color: var(--paper);
    font-family: var(--ui);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    padding: clamp(14px, 1.6vw, 34px);
  }

  /* ---- Header ------------------------------------------------------- */
  .head {
    display: flex; align-items: baseline; gap: clamp(10px, 1.4vw, 24px);
    flex-wrap: wrap;
    padding-bottom: clamp(10px, 1vw, 18px);
    border-bottom: 2px solid var(--red);
    margin-bottom: clamp(12px, 1.2vw, 22px);
  }
  .mark {
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-weight: 800;
    letter-spacing: .01em;
    font-size: clamp(22px, 2.5vw, 52px);
    line-height: .95;
  }
  .mark em { font-style: normal; color: var(--red); }
  .club {
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-size: clamp(15px, 1.5vw, 30px);
    letter-spacing: .14em;
    color: var(--muted);
  }
  .range {
    margin-left: auto;
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-size: clamp(15px, 1.6vw, 32px);
    letter-spacing: .08em;
    font-variant-numeric: tabular-nums;
  }

  /* ---- Week --------------------------------------------------------- */
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: clamp(5px, .5vw, 12px);
    align-items: start;
  }
  .day {
    background: var(--ink-2);
    border-radius: 10px;
    overflow: hidden;
    min-height: clamp(90px, 10vw, 150px);
  }
  .day.today { background: var(--ink-3); outline: 2px solid var(--red); }

  .dhead {
    padding: clamp(6px, .6vw, 13px) clamp(7px, .7vw, 15px);
    border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: .5em;
  }
  .day.today .dhead { background: var(--red); border-bottom-color: transparent; }
  .dow {
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-weight: 800;
    letter-spacing: .09em;
    font-size: clamp(13px, 1.35vw, 28px);
    line-height: 1;
  }
  .dnum {
    margin-left: auto;
    font-family: var(--display);
    font-variant-numeric: tabular-nums;
    font-size: clamp(12px, 1.15vw, 24px);
    color: var(--muted);
    line-height: 1;
  }
  .day.today .dnum { color: rgba(255,255,255,.8); }

  .list { padding: clamp(4px, .4vw, 9px); display: flex; flex-direction: column; gap: clamp(3px, .3vw, 7px); }

  .cls {
    position: relative;
    background: rgba(244,244,242,.045);
    border-radius: 7px;
    padding: clamp(5px, .55vw, 12px) clamp(6px, .6vw, 13px);
    padding-left: clamp(11px, 1.05vw, 21px);
  }
  .cls::before {
    content: '';
    position: absolute; left: clamp(4px, .38vw, 8px); top: clamp(5px, .5vw, 11px); bottom: clamp(5px, .5vw, 11px);
    width: clamp(3px, .28vw, 6px);
    border-radius: 3px;
    background: var(--collar, var(--red));
  }
  .time {
    font-family: var(--display);
    font-stretch: condensed;
    font-variant-numeric: tabular-nums;
    font-size: clamp(11px, 1.02vw, 21px);
    letter-spacing: .045em;
    color: var(--collar, var(--paper));
    line-height: 1.15;
  }
  .name {
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-weight: 800;
    font-size: clamp(13px, 1.32vw, 29px);
    letter-spacing: .015em;
    line-height: 1.05;
    margin-top: .08em;
  }
  .who {
    font-size: clamp(9.5px, .82vw, 17px);
    color: var(--muted);
    line-height: 1.2;
    margin-top: .22em;
  }

  .foot {
    margin-top: clamp(10px, 1vw, 20px);
    display: flex; gap: 1em; align-items: center;
    font-size: clamp(9.5px, .78vw, 15px);
    color: var(--muted);
    letter-spacing: .05em;
    text-transform: uppercase;
    font-family: var(--display);
    font-stretch: condensed;
  }
  .dot { width: .55em; height: .55em; border-radius: 50%; background: #4ade80; }
  .dot.stale { background: var(--ffb400, #ffb400); }

  /* ---- Narrow: website iframe / phone -------------------------------- */
  @media (max-width: 900px) {
    .week { grid-template-columns: 1fr; gap: 8px; }
    .day { min-height: 0; }
    .day:not(.today):has(.list:empty) { display: none; }
    .dow  { font-size: 19px; }
    .dnum { font-size: 17px; }
    .time { font-size: 15px; }
    .name { font-size: 21px; }
    .who  { font-size: 13px; }
    .range { margin-left: 0; width: 100%; }
  }

  @media (prefers-reduced-motion: no-preference) {
    .day { transition: outline-color .2s ease; }
  }
</style>
</head>
<body>
  <header class="head">
    <div class="mark">West Coast <em>Strength</em></div>
    <div class="club">${escapeHtml(clubName)}</div>
    <div class="range" id="range"></div>
  </header>

  <main class="week" id="week" aria-live="polite"></main>

  <footer class="foot">
    <span class="dot" id="dot"></span>
    <span id="status">Loading schedule</span>
  </footer>

<script>
(function () {
  var CLUB = ${JSON.stringify(clubSlug)};
  var COLLARS = ${JSON.stringify(COLLARS)};
  var REFRESH_MS = 5 * 60 * 1000;
  var weekEl = document.getElementById('week');
  var rangeEl = document.getElementById('range');
  var statusEl = document.getElementById('status');
  var dotEl = document.getElementById('dot');
  var lastGood = null;

  function collarFor(name) {
    var s = String(name || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLLARS[h % COLLARS.length];
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Today in the club's own timezone. A TV in the gym and a phone in another
  // state must highlight the same column.
  function pacificToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  function render(data) {
    var today = pacificToday();
    rangeEl.textContent = data.range_label || '';
    weekEl.innerHTML = data.days.map(function (d) {
      var isToday = d.date === today;
      // A day with no classes renders as an empty column, not a "no classes"
      // message. The gap is the information.
      var items = d.classes.map(function (c) {
        var collar = collarFor(c.class_name);
        return '<div class="cls" style="--collar:' + collar + '">'
          + '<div class="time">' + esc(c.time_label) + '</div>'
          + '<div class="name">' + esc(c.class_name) + '</div>'
          + (c.instructor ? '<div class="who">' + esc(c.instructor) + '</div>' : '')
          + '</div>';
      }).join('');
      return '<section class="day' + (isToday ? ' today' : '') + '">'
        + '<div class="dhead"><span class="dow">' + esc(d.weekday) + '</span>'
        + '<span class="dnum">' + esc(d.day_number) + '</span></div>'
        + '<div class="list">' + items + '</div>'
        + '</section>';
    }).join('');
  }

  function setStatus(text, stale) {
    statusEl.textContent = text;
    dotEl.className = 'dot' + (stale ? ' stale' : '');
  }

  function load() {
    // Ask for the week containing today, recomputed on every poll, so a screen
    // left running rolls over on its own at local midnight Monday.
    var url = '/public/group-x/schedule?club=' + encodeURIComponent(CLUB)
      + '&week=' + encodeURIComponent(pacificToday());
    fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        lastGood = data;
        render(data);
        setStatus('Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), false);
      })
      .catch(function () {
        // Keep the last good board on screen. A stale schedule beats a blank TV.
        if (lastGood) {
          setStatus('Showing last update, reconnecting', true);
        } else {
          setStatus('Schedule unavailable, retrying', true);
        }
      });
  }

  load();
  setInterval(load, REFRESH_MS);
})();
</script>
</body>
</html>`
}

module.exports = { renderBoardHtml, COLLARS }
