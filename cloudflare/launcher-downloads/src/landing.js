// Landing page at "/": one card per app with Windows + Mac download buttons,
// rendered from the live update feeds so it always shows the current version.
import { PORTAL_ICON, ABC_ICON } from './icons.js'

export const APPS = [
  {
    channel: 'portal',
    name: 'Portal',
    blurb: 'The WCS staff portal with ABC, GHL and the rest of your tools in tabs.',
    icon: PORTAL_ICON,
    win: 'Portal-Setup.exe',
    macArm: 'Portal-mac-arm64.dmg',
    macX64: 'Portal-mac-x64.dmg',
  },
  {
    channel: 'abc',
    name: 'WCS ABC',
    blurb: 'ABC Financial on its own, with the member Actions toolbar. No sign-in.',
    icon: ABC_ICON,
    win: 'WCS-ABC-Setup.exe',
    macArm: 'WCS-ABC-mac-arm64.dmg',
    macX64: 'WCS-ABC-mac-x64.dmg',
  },
]

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const mb = bytes => (bytes ? ` · ${Math.round(bytes / 1048576)} MB` : '')
const day = iso => {
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
}

// feeds: { [channel]: { win: feed|null, mac: feed|null } } from readFeed()
// apps: which apps to show ("/" = all, "/portal" or "/abc" = just that one).
export function renderLanding(feeds, apps = APPS) {
  const title = apps.length === 1 ? `Download ${apps[0].name}` : 'WCS Downloads'
  const cards = apps.map(app => {
    const { win, mac } = feeds[app.channel] || {}
    const winFile = win && win.files.find(f => /\.exe$/i.test(f.url))
    const armFile = mac && mac.files.find(f => /arm64.*\.dmg$/i.test(f.url))
    const x64File = mac && mac.files.find(f => /\.dmg$/i.test(f.url) && !/arm64/i.test(f.url))
    const newest = [win, mac].filter(Boolean).sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1))[0]

    const buttons = []
    if (winFile) buttons.push(`<a class="btn primary" href="/${app.channel}/${app.win}">Download for Windows<span>v${esc(win.version)}${mb(winFile.size)}</span></a>`)
    if (armFile) buttons.push(`<a class="btn" href="/${app.channel}/${app.macArm}">Mac (Apple Silicon)<span>v${esc(mac.version)}${mb(armFile.size)}</span></a>`)
    if (x64File) buttons.push(`<a class="btn" href="/${app.channel}/${app.macX64}">Mac (Intel)<span>v${esc(mac.version)}${mb(x64File.size)}</span></a>`)

    return `
      <section class="card">
        <div class="head">
          <img src="${app.icon}" alt="" width="56" height="56">
          <div>
            <h2>${esc(app.name)}</h2>
            <p class="meta">${newest ? `Version ${esc(newest.version)}${newest.releaseDate ? ` · ${esc(day(newest.releaseDate))}` : ''}` : 'Coming soon'}</p>
          </div>
        </div>
        <p class="blurb">${esc(app.blurb)}</p>
        <div class="buttons">${buttons.join('') || '<p class="empty">No download published yet.</p>'}</div>
      </section>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="${PORTAL_ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --navy:#1a1a2e; --red:#e53e3e; --red-hover:#c53030; --surface:#fff; --bg:#f4f5f7; --muted:#6b7280; --border:#e2e4e8; --btn-bg:#fff; --btn-text:#1a1a2e; }
  @media (prefers-color-scheme: dark) {
    :root { --navy:#f3f4f6; --surface:#1c1d2b; --bg:#12121c; --muted:#9ca3af; --border:#2d2f40; --btn-bg:#24263a; --btn-text:#f3f4f6; }
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--navy); font-family:'Inter',-apple-system,'Segoe UI',sans-serif; -webkit-font-smoothing:antialiased; line-height:1.5; }
  main { max-width:760px; margin:0 auto; padding:56px 16px; }
  header { text-align:center; margin-bottom:36px; }
  header h1 { font-size:30px; font-weight:800; letter-spacing:-0.02em; }
  .grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); }
  .grid.single { max-width:420px; margin:0 auto; grid-template-columns:1fr; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:28px; display:flex; flex-direction:column; box-shadow:0 10px 30px rgba(0,0,0,0.06); }
  .head { display:flex; align-items:center; gap:14px; }
  .head img { border-radius:12px; flex:none; }
  h2 { font-size:22px; font-weight:700; }
  .meta { color:var(--muted); font-size:14px; }
  .blurb { color:var(--muted); font-size:15px; margin:16px 0 22px; flex:1; }
  .buttons { display:flex; flex-direction:column; gap:10px; }
  .btn { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 16px; border-radius:10px; border:1px solid var(--border); background:var(--btn-bg); color:var(--btn-text); text-decoration:none; font-weight:600; font-size:15px; }
  .btn span { font-weight:500; font-size:13px; color:var(--muted); white-space:nowrap; }
  .btn:hover { border-color:var(--red); }
  .btn.primary { background:var(--red); border-color:var(--red); color:#fff; }
  .btn.primary span { color:rgba(255,255,255,0.85); }
  .btn.primary:hover { background:var(--red-hover); border-color:var(--red-hover); }
  .empty { color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${esc(title)}</h1>
  </header>
  <div class="grid${apps.length === 1 ? ' single' : ''}">${cards}</div>
</main>
</body>
</html>`
}
