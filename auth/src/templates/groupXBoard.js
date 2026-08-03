// The public class board. One self-contained HTML document: inlined CSS, JS,
// and font. No external fonts, no CDN. The only network call it makes is to
// its own /public/group-x/schedule endpoint.
//
// Styling mirrors the westcoaststrength.com theme (wp-content/themes/wcs-custom)
// so the board reads as part of the site rather than a bolted-on widget. Tokens
// below are copied from that theme's :root and must stay in sync with it:
//   --color-bg #ffffff  --color-surface #f4f4f2  --color-text #16181d
//   --color-accent #ff0000  --color-accent-hover #cc0000
//   --color-line rgb(0 0 0 / .12)  --color-muted rgb(0 0 0 / .58)
//   --font-display 'WCSDisplay', 'Arial Narrow'  (uppercase, line-height .9)
//   fluid --step-* type scale
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
const { WCS_DISPLAY_FACE } = require('./wcsDisplayFont')

// Per-class colour on the left bar, hashed from the class NAME so the same
// class is the same colour everywhere — across days, across clubs, and
// matching the staff calendar, which hashes the same string with the same
// algorithm and palette order.
//
// Red is deliberately absent: it belongs to today's column and the New badge,
// and a red bar would compete with both.
const COLLARS = [
  '#0284c7', // sky
  '#059669', // emerald
  '#7c3aed', // violet
  '#d97706', // amber
  '#4f46e5', // indigo
  '#0d9488', // teal
]

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Shared by the Group X board and the facility (courts / pool) boards. The
// only differences are the heading, the eyebrow and which endpoint it polls, so
// they are parameters rather than a forked copy of 300 lines of CSS.
function renderBoardHtml({ clubSlug, clubName, safePercent, boardTitle, eyebrowLabel, scheduleUrl, showDurationTag, layout, embed, emptyLabel }) {
  const title = boardTitle || 'Class Schedule'
  const eyebrow = eyebrowLabel || 'Group X'
  const feed = scheduleUrl || '/public/group-x/schedule'
  // What an empty day column says. Today's column appends " today", so this
  // has to read as a sentence with that word on the end: "No classes today".
  const empty = emptyLabel || 'No classes'
  // Group X shows a start time only, so a non-standard length is worth
  // flagging. Courts and pool already show "6:00 - 10:00 AM", where a
  // "240 min" tag says nothing the range has not already said.
  const durationTag = showDurationTag !== false
  // 'time'  cards keep one size and sit at a height matching their start time,
  //         with real gaps between a 6am and a 4pm class. Group X, where a
  //         single early class filling the column read as an all-day event.
  // 'fill'  cards grow with their duration and pack the column. Courts and
  //         pool, where a 4 hour open gym genuinely is four times the block.
  const layoutMode = layout === 'fill' ? 'fill' : 'time'
  // TV overscan: most TVs crop 2-5% off every edge, a broadcast-era holdover,
  // so content laid out to the true viewport gets its edges cut. We inset the
  // whole board by a safe margin. 3% covers the common case; ?safe=N (0-10)
  // lets a gym whose TV crops harder dial it in without a redeploy.
  const safe = Number.isFinite(safePercent) ? Math.min(Math.max(safePercent, 0), 10) : 3
  // Embedded in an iframe on westcoaststrength.com rather than on a TV. The
  // page around it already says which gym and which schedule this is, so the
  // board drops its own title block and its "Updated 10:03" status line and
  // renders just the week. Overscan padding goes too — there's no TV cropping
  // the edges, and the parent page supplies its own margins.
  //
  // The week range stays. It lives in the same header as the title, but
  // "JUL 31 - AUG 6" is the one thing the surrounding page can't say for the
  // board, since the board picks the week off the client clock.
  const isEmbed = embed === true
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · West Coast Strength ${escapeHtml(clubName)}</title>
<style>
${WCS_DISPLAY_FACE}
  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; }

  :root {
    /* Copied from wcs-custom/assets/css/main.css :root — keep in sync. */
    --color-bg: #ffffff;
    --color-surface: #f4f4f2;
    --color-text: #16181d;
    --color-accent: #ff0000;
    --color-accent-hover: #cc0000;
    --color-line: rgb(0 0 0 / 0.12);
    --color-muted: rgb(0 0 0 / 0.58);
    --font-display: 'WCSDisplay', 'Arial Narrow', sans-serif;
    --font-body: system-ui, -apple-system, 'Segoe UI', sans-serif;
    --step--1: clamp(0.83rem, 0.8rem + 0.15vw, 0.9rem);
    --step-0:  clamp(1rem, 0.95rem + 0.25vw, 1.13rem);
    --step-1:  clamp(1.2rem, 1.1rem + 0.5vw, 1.5rem);
    --step-2:  clamp(1.44rem, 1.25rem + 0.95vw, 2rem);
    --step-3:  clamp(1.73rem, 1.4rem + 1.65vw, 2.66rem);
    --step-4:  clamp(2.07rem, 1.55rem + 2.6vw, 3.55rem);
    /* The board heading is the one piece of type that has to read from the
       far side of a gym floor, so it gets its own step above the theme scale. */
    --step-board: clamp(2.6rem, 1.4rem + 5.6vw, 7rem);
    --space-xs: clamp(0.75rem, 0.7rem + 0.25vw, 1rem);
    --space-s:  clamp(1rem, 0.9rem + 0.5vw, 1.5rem);
    --space-m:  clamp(1.5rem, 1.3rem + 1vw, 2.5rem);
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --dur-fast: 0.3s;
  }

  html { -webkit-text-size-adjust: 100%; height: 100%; }
  /* Fill the screen exactly and never scroll. A wall-mounted TV has no one to
     scroll it, so the whole week has to be on screen at once. dvh first for
     mobile browser chrome, vh fallback for TV browsers that lack dvh. */
  body {
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-body);
    font-size: var(--step-0);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    /* Overscan-safe inset. Percentages are of the viewport, so the board sits
       inside whatever the TV crops. box-sizing keeps it inside 100dvh. */
    padding: ${isEmbed ? '0' : `${safe}vh ${safe}vw`};
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Theme convention: display face is uppercase, weight 400, tight leading. */
  .title { font-family: var(--font-display); font-weight: 400; text-transform: uppercase; line-height: .9; letter-spacing: -0.005em; }
  .eyebrow {
    font-family: var(--font-body); font-size: clamp(.8rem, .55rem + .7vw, 1.35rem);
    font-weight: 600;
    letter-spacing: .22em; text-transform: uppercase; color: var(--color-accent);
  }
  .accent { color: var(--color-accent); }

  /* ---- Header ------------------------------------------------------- */
  .head {
    display: flex; align-items: flex-end; gap: var(--space-s);
    flex-wrap: wrap;
    flex: 0 0 auto;
    padding-bottom: clamp(.4rem, 1vh, 1.1rem);
    border-bottom: 5px solid var(--color-accent);
    margin-bottom: clamp(.5rem, 1.2vh, 1.3rem);
  }
  .head__titles { display: flex; flex-direction: column; gap: .18em; }
  .mark { font-size: var(--step-board); }
  .range {
    margin-left: auto;
    font-family: var(--font-display); text-transform: uppercase;
    font-size: clamp(1.3rem, .8rem + 2.2vw, 3rem); line-height: .9;
    font-variant-numeric: tabular-nums;
    color: var(--color-muted);
  }

  /* ---- Week --------------------------------------------------------- */
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: clamp(3px, .32vw, 8px);
    /* Take all remaining height. min-height:0 is required or the grid refuses
       to shrink below its content and pushes the page into a scroll. */
    flex: 1 1 auto;
    min-height: 0;
    align-items: stretch;
  }
  .day {
    background: var(--color-surface);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .day--today { background: var(--color-bg); box-shadow: inset 0 0 0 3px var(--color-accent); }

  .dhead {
    padding: clamp(6px, .55vw, 12px) clamp(7px, .65vw, 14px);
    border-bottom: 1px solid var(--color-line);
    display: flex; align-items: baseline; gap: .45em;
  }
  .day--today .dhead { background: var(--color-accent); border-bottom-color: transparent; color: #fff; }
  .dow {
    font-family: var(--font-display); text-transform: uppercase;
    letter-spacing: .04em; font-size: clamp(14px, 1.42vw, 30px); line-height: .9;
  }
  /* Month and day, not a bare number. Somebody glancing at a wall should be
     able to tell Mon Aug 3 from Mon Aug 10 without counting columns, and a
     board photographed or shared out of context still says which week it is. */
  .dnum {
    margin-left: auto; font-family: var(--font-display);
    text-transform: uppercase; letter-spacing: .03em;
    font-variant-numeric: tabular-nums; font-size: clamp(12px, 1.22vw, 26px);
    line-height: .9; color: var(--color-text); white-space: nowrap;
  }
  .day--today .dnum { color: #fff; }

  .list {
    padding: clamp(4px, .38vw, 9px);
    display: flex; flex-direction: column;
    gap: clamp(3px, .3vw, 7px);
    flex: 1 1 auto;
    min-height: 0;
    /* A day with an unusually full schedule scrolls inside its own column
       rather than pushing the whole board into a page scroll. Scrollbar hidden
       because nobody is going to drag one on a TV. */
    overflow-y: auto;
    scrollbar-width: none;
  }
  .list::-webkit-scrollbar { display: none; }

  /* A day with nothing on it says so. An empty column on its own reads as a
     board that failed to load rather than a quiet day, and a club still filling
     its schedule in can have a whole week of them on the website. margin:auto
     centres it in the column, which is a flex box in both layout modes. */
  .none {
    margin: auto;
    padding: .5em .4em;
    text-align: center;
    color: var(--color-muted);
    font-size: clamp(11px, .85vw, 18px);
    line-height: 1.25;
  }
  .day--today .none { color: var(--color-text); }

  .cls {
    position: relative;
    background: var(--color-bg);
    padding: clamp(3px, .38vw, 9px) clamp(5px, .5vw, 11px);
    padding-left: clamp(12px, 1.1vw, 23px);
  }
  .day--today .cls { background: var(--color-surface); }
  .cls::before {
    content: '';
    position: absolute; left: clamp(4px, .36vw, 8px);
    top: clamp(5px, .48vw, 11px); bottom: clamp(5px, .48vw, 11px);
    width: clamp(5px, .45vw, 11px);
    background: var(--collar, var(--color-text));
  }
  .time {
    font-family: var(--font-display); text-transform: uppercase;
    font-variant-numeric: tabular-nums;
    font-size: calc(var(--fs, 1) * clamp(13px, 1.3vw, 27px)); line-height: .95;
    letter-spacing: .02em; color: var(--color-muted);
  }
  .name {
    font-family: var(--font-display); text-transform: uppercase;
    font-size: calc(var(--fs, 1) * clamp(16px, 1.75vw, 40px)); line-height: .9;
    letter-spacing: -0.005em; margin-top: .12em;
  }
  .who {
    font-size: calc(var(--fs, 1) * clamp(10px, .88vw, 18px)); line-height: 1.25;
    margin-top: .3em; color: var(--color-muted);
  }

  /* NEW badge. The board is otherwise a calm grid, so this is the one place
     that moves — it has to catch an eye walking past without turning the wall
     into a slot machine. */
  .cls--new { background: var(--color-bg); box-shadow: inset 0 0 0 2px var(--color-accent); }
  .badge {
    display: inline-block;
    margin-top: .35em;
    padding: .12em .5em .16em;
    background: var(--color-accent);
    color: #fff;
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: .12em;
    font-size: clamp(8.5px, .72vw, 15px);
    line-height: 1.15;
  }
  @media (prefers-reduced-motion: no-preference) {
    .badge { animation: pulse 2.4s var(--ease-out) infinite; }
    @keyframes pulse {
      0%, 68%, 100% { opacity: 1; }
      80% { opacity: .45; }
    }
  }

  /* Only classes that actually have a description become clickable, so a tap
     never opens an empty box. Nothing on a TV has a pointer, so this is
     effectively website-only and stays invisible there. */
  .cls--tap { cursor: pointer; }
  .cls--tap:hover { background: var(--color-surface); }
  .cls--tap:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
  .day--today .cls--tap:hover { background: var(--color-bg); }

  .scrim {
    position: fixed; inset: 0;
    background: rgb(0 0 0 / .55);
    display: none;
    align-items: center; justify-content: center;
    padding: var(--space-s);
    z-index: 50;
  }
  .scrim[data-open="1"] { display: flex; }
  .sheet {
    background: var(--color-bg);
    max-width: 46ch; width: 100%;
    max-height: 80vh; overflow-y: auto;
    padding: var(--space-m);
    box-shadow: 0 24px 60px rgb(0 0 0 / .35);
  }
  .sheet__eyebrow {
    font-size: var(--step--1); font-weight: 600; letter-spacing: .22em;
    text-transform: uppercase; color: var(--color-accent);
  }
  .sheet__title {
    font-family: var(--font-display); text-transform: uppercase;
    font-size: var(--step-3); line-height: .9; letter-spacing: -0.005em;
    margin: .15em 0 .35em;
  }
  .sheet__meta { color: var(--color-muted); font-size: var(--step-0); margin-bottom: .9em; }
  .sheet__body { font-size: var(--step-0); line-height: 1.6; }
  .sheet__close {
    margin-top: var(--space-s);
    display: inline-flex; align-items: center; justify-content: center;
    padding: .5em 1.2em;
    background: var(--color-accent); color: #fff;
    border: 0; cursor: pointer;
    font-family: var(--font-display); text-transform: uppercase;
    font-size: var(--step-0); letter-spacing: .04em;
  }
  .sheet__close:hover { background: var(--color-accent-hover); }
  .sheet__close:focus-visible { outline: 3px solid var(--color-text); outline-offset: 2px; }

  /* Most classes run 60 minutes, so only the exceptions are called out.
     Tagging every class "60 min" would be noise that teaches people to ignore
     the line the one time it matters. */
  .len {
    display: inline-block;
    margin-left: .5em;
    padding: 0 .35em;
    border: 1px solid var(--color-line);
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: .06em;
    font-size: calc(var(--fs, 1) * clamp(8px, .66vw, 14px));
    color: var(--color-muted);
    vertical-align: baseline;
  }

  /* Time mode: same-size cards, gaps proportional to the time between them.
     --cards is the busiest day of the week, so capping each card at that
     fraction of the column guarantees the fullest day fits exactly. Gaps are
     shrinkable, so on a packed day they collapse to nothing and the cards
     still fit rather than overflowing.
     overflow is hidden, not auto: a TV has nobody to scroll it, so anything
     that does not fit is invisible content. The sizing above is what keeps
     that from happening; this is the guarantee, not the mechanism. */
  .list--time { overflow: hidden; }
  .list--time .cls {
    flex: 0 1 auto;
    max-height: calc(100% / var(--cards, 4));
    overflow: hidden;
  }
  .gap { flex: 1 1 0; min-height: 0; pointer-events: none; }

  .foot {
    flex: 0 0 auto;
    margin-top: var(--space-xs);
    display: flex; gap: .7em; align-items: center;
    font-size: var(--step--1); font-weight: 600;
    letter-spacing: .22em; text-transform: uppercase;
    color: var(--color-muted);
  }
  .dot { width: .5em; height: .5em; border-radius: 50%; background: var(--color-accent); flex: none; }
  .dot--stale { background: var(--color-muted); }

  /* ---- Narrow: website iframe / phone -------------------------------- */
  /* Stack only on genuinely narrow screens (phones, a skinny website embed).
     TV browsers can report widths well under 1000px, and a 16:9 screen must
     never stack, so this is gated on portrait orientation too. Here the page
     is allowed to scroll again, because a phone has someone holding it. */
  @media (max-width: 760px) and (orientation: portrait) {
    body { height: auto; min-height: 100vh; overflow: visible; }
    .week { grid-template-columns: 1fr; gap: 7px; flex: 0 0 auto; }
    .list { overflow-y: visible; }
    .day--empty:not(.day--today) { display: none; }
    .dow  { font-size: 20px; }
    .dnum { font-size: 18px; }
    .time { font-size: 15px; }
    .name { font-size: 22px; }
    .who  { font-size: 13px; }
    .range { margin-left: 0; width: 100%; }
  }

  @media (prefers-reduced-motion: no-preference) {
    .day { transition: box-shadow var(--dur-fast) var(--ease-out); }
  }
${isEmbed ? `
  /* ---- Embedded on the website ---------------------------------------- */
  /* The page around the iframe carries the title and the chrome, so the board
     is only the week. The header element stays because the week range lives in
     it (and its red rule is a useful lid on the grid), but the title block is
     not rendered at all in this mode. */
  .head { padding-bottom: clamp(.25rem, .6vh, .6rem); margin-bottom: clamp(.4rem, 1vh, 1rem); }
  .range { margin-left: 0; }
  .foot { display: none; }
` : ''}
</style>
</head>
<body>
  <header class="head">
${isEmbed ? '' : `    <div class="head__titles">
      <span class="eyebrow">${escapeHtml(clubName)} · ${escapeHtml(eyebrow)}</span>
      <h1 class="title mark">${escapeHtml(title)}</h1>
    </div>
`}    <div class="range" id="range"></div>
  </header>

  <main class="week" id="week" aria-live="polite"></main>

  <div class="scrim" id="scrim" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" data-open="0">
    <div class="sheet" id="sheet">
      <div class="sheet__eyebrow" id="sheetEyebrow"></div>
      <h2 class="sheet__title" id="sheetTitle"></h2>
      <div class="sheet__meta" id="sheetMeta"></div>
      <div class="sheet__body" id="sheetBody"></div>
      <button type="button" class="sheet__close" id="sheetClose">Close</button>
    </div>
  </div>

  <footer class="foot">
    <span class="dot" id="dot"></span>
    <span id="status">Loading schedule</span>
  </footer>

<script>
(function () {
  var CLUB = ${JSON.stringify(clubSlug)};
  var FEED = ${JSON.stringify(feed)};
  var SHOW_LEN = ${JSON.stringify(durationTag)};
  var LAYOUT = ${JSON.stringify(layoutMode)};
  var EMPTY = ${JSON.stringify(empty)};
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

  // Time mode: every card is the same size, so the constraint is simply how
  // many the busiest day holds. Four classes have to fit a column without
  // scrolling, so the type comes down as the day fills up.
  function fontScaleForCount(n) {
    if (n <= 1) return 1.9;
    if (n === 2) return 1.6;
    if (n === 3) return 1.3;
    if (n === 4) return 1.05;
    if (n === 5) return 0.9;
    return 0.78;
  }

  // Fill mode: cards vary with duration, so the smallest card is the shortest
  // event as a fraction of its own column's total minutes. Type is scaled
  // against THAT, so nothing overflows and quieter columns still read large.
  function fontScaleForFraction(f) {
    if (f >= 0.9) return 1.9;
    if (f >= 0.45) return 1.7;
    if (f >= 0.3) return 1.45;
    if (f >= 0.22) return 1.25;
    if (f >= 0.16) return 1.1;
    return 1.0;
  }

  function smallestCardFraction(days) {
    var smallest = 1;
    days.forEach(function (d) {
      if (!d.classes.length) return;
      var total = 0, min = Infinity;
      d.classes.forEach(function (c) {
        var mins = c.duration_minutes || 60;
        total += mins;
        if (mins < min) min = mins;
      });
      if (total > 0) smallest = Math.min(smallest, min / total);
    });
    return smallest;
  }

  // "06:00" or "6:00 AM" -> minutes past midnight.
  function startMinutes(c) {
    var t = String(c.time || '');
    var m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function gapEl(minutes) {
    // Zero-weight spacers still need to exist so the gap sequence stays in
    // step with the cards, but they take no space.
    return '<div class="gap" style="flex-grow:' + Math.max(0, minutes || 0) + '"></div>';
  }

  function render(data) {
    rangeEl.textContent = data.range_label || '';

    // The time window is derived from the week's own classes rather than a
    // fixed 6am-10pm, so a board with nothing before 9am does not waste a
    // third of every column on empty morning.
    var allMins = [];
    data.days.forEach(function (d) {
      d.classes.forEach(function (c) { allMins.push(startMinutes(c)); });
    });
    var windowStart = allMins.length ? Math.min.apply(null, allMins) : 0;
    var windowEnd = allMins.length ? Math.max.apply(null, allMins) : 0;
    // A single time of day would make every gap zero; give it a nominal span
    // so the layout stays stable.
    if (windowEnd - windowStart < 60) windowEnd = windowStart + 60;
    var busiest = 0;
    data.days.forEach(function (d) {
      if (d.classes.length > busiest) busiest = d.classes.length;
    });
    weekEl.style.setProperty('--cards', Math.max(1, busiest));
    weekEl.style.setProperty('--fs', LAYOUT === 'time'
      ? fontScaleForCount(busiest)
      : fontScaleForFraction(smallestCardFraction(data.days)));
    weekEl.innerHTML = data.days.map(function (d) {
      // The server marks the first column, so the browser does not re-derive
      // the club's timezone.
      var isToday = d.is_today === true;
      // A day with no classes says so. The empty column used to be the message
      // -- fine on a TV beside six full ones, but on the website a club still
      // filling its schedule in shows a whole week of blank columns, which
      // reads as a board that failed to load rather than a quiet week.
      var cards = d.classes.map(function (c) {
        // Detail rides on the element, so the click handler needs no lookup.
        var tappable = !!c.description;
        var attrs = tappable
          ? ' role="button" tabindex="0" data-desc="' + esc(c.description)
            + '" data-name="' + esc(c.class_name)
            + '" data-when="' + esc(c.time_label)
            + '" data-who="' + esc(c.instructor || '') + '"'
          : '';
        return '<div class="cls' + (c.is_new ? ' cls--new' : '') + (tappable ? ' cls--tap' : '')
          + '"' + attrs
          + ' style="--collar:' + collarFor(c.class_name)
          + (LAYOUT === 'fill' ? ';flex-grow:' + (c.duration_minutes || 60) : '') + '">'
          + '<div class="time">' + esc(c.time_label)
          + (SHOW_LEN && c.duration_minutes && c.duration_minutes !== 60
              ? '<span class="len">' + esc(c.duration_minutes) + ' min</span>' : '')
          + '</div>'
          + '<div class="name">' + esc(c.class_name) + '</div>'
          + (c.instructor ? '<div class="who">' + esc(c.instructor) + '</div>' : '')
          + (c.is_new ? '<span class="badge">New class</span>' : '')
          + '</div>';
      });

      // Time mode inserts weighted spacers so a class sits at a height roughly
      // matching its start, leaving honest empty space between a 6am and a 4pm
      // class. Flex does the arithmetic; nothing has to be measured.
      var items;
      if (LAYOUT === 'time' && cards.length) {
        var mins = d.classes.map(startMinutes);
        var parts = [];
        parts.push(gapEl(mins[0] - windowStart));
        for (var i = 0; i < cards.length; i++) {
          parts.push(cards[i]);
          if (i < cards.length - 1) parts.push(gapEl(mins[i + 1] - mins[i]));
        }
        parts.push(gapEl(windowEnd - mins[mins.length - 1]));
        items = parts.join('');
      } else {
        items = cards.join('');
      }

      return '<section class="day' + (isToday ? ' day--today' : '')
        + (d.classes.length ? '' : ' day--empty') + '">'
        + '<div class="dhead"><span class="dow">' + esc(d.weekday) + '</span>'
        + '<span class="dnum">' + esc(d.label || d.day_number) + '</span></div>'
        + '<div class="list' + (LAYOUT === 'time' ? ' list--time' : '') + '">'
        + (d.classes.length ? items : '<p class="none">' + esc(EMPTY) + (isToday ? ' today' : '') + '</p>')
        + '</div>'
        + '</section>';
    }).join('');
  }

  function setStatus(text, stale) {
    statusEl.textContent = text;
    dotEl.className = 'dot' + (stale ? ' dot--stale' : '');
  }

  function load() {
    // Ask for the week containing today, recomputed on every poll, so a screen
    // left running rolls over on its own at local midnight Monday.
    // FEED may already carry a query string (the facility boards pass
    // ?facility=pool), so pick the separator rather than always using '?'.
    var sep = FEED.indexOf('?') === -1 ? '?' : '&';
    var url = FEED + sep + 'club=' + encodeURIComponent(CLUB)
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
        setStatus(lastGood ? 'Showing last update, reconnecting' : 'Schedule unavailable, retrying', true);
      });
  }

  // ---- class detail popup --------------------------------------------------
  var scrim = document.getElementById('scrim');
  var lastFocus = null;

  function openSheet(el) {
    document.getElementById('sheetEyebrow').textContent = el.getAttribute('data-when') || '';
    document.getElementById('sheetTitle').textContent = el.getAttribute('data-name') || '';
    var who = el.getAttribute('data-who');
    document.getElementById('sheetMeta').textContent = who ? 'With ' + who : '';
    document.getElementById('sheetBody').textContent = el.getAttribute('data-desc') || '';
    lastFocus = el;
    scrim.setAttribute('data-open', '1');
    document.getElementById('sheetClose').focus();
  }

  function closeSheet() {
    scrim.setAttribute('data-open', '0');
    // Send focus back where it came from, so keyboard users are not dumped at
    // the top of the page.
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  // Delegated, because the grid is rebuilt on every refresh.
  weekEl.addEventListener('click', function (e) {
    var card = e.target.closest ? e.target.closest('.cls--tap') : null;
    if (card) openSheet(card);
  });
  weekEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest ? e.target.closest('.cls--tap') : null;
    if (!card) return;
    e.preventDefault();
    openSheet(card);
  });

  document.getElementById('sheetClose').addEventListener('click', closeSheet);
  scrim.addEventListener('click', function (e) { if (e.target === scrim) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

${isEmbed ? `
  // Tell the embedding page how tall we are -- but only when STACKED. Wide,
  // this is a fill-the-viewport TV layout (height: 100dvh, never scrolls), so
  // scrollHeight is simply whatever height the iframe was handed and reporting
  // it back says nothing. Stacked, the narrow portrait media query switches the
  // body to height:auto and the number becomes a real content height, which is
  // the case the parent can't guess. The parent ignores the message unless
  // stacked is true.
  //
  // targetOrigin '*' because the board doesn't know which page embedded it, and
  // the payload is a number -- there is nothing here worth scoping.
  var STACK_MQ = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
  function postHeight() {
    try {
      parent.postMessage({
        type: 'wcs-board-height',
        stacked: STACK_MQ.matches,
        height: Math.ceil(document.documentElement.scrollHeight)
      }, '*');
    } catch (e) {}
  }
  window.addEventListener('resize', postHeight);
  if (STACK_MQ.addEventListener) STACK_MQ.addEventListener('change', postHeight);
  window.addEventListener('load', postHeight);
  // Each schedule refresh can change the stacked height, and a ResizeObserver
  // catches that without reaching into render().
  if (window.ResizeObserver) { new ResizeObserver(postHeight).observe(document.body); }
  postHeight();
` : ''}
  load();
  // Refreshing while someone is reading a description would yank it away, so
  // hold off until the popup is closed.
  setInterval(function () { if (scrim.getAttribute('data-open') !== '1') load(); }, REFRESH_MS);
})();
</script>
</body>
</html>`
}

module.exports = { renderBoardHtml, COLLARS }
