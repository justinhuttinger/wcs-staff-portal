# wcs-dayone-site

Cloudflare Worker that serves the Day One booking, cancel and reschedule pages
on **book.westcoaststrength.com**.

It **proxies** the live pages from the auth API rather than copying them. The
pages are server-rendered (the API injects the mount base and location into the
HTML), so a static copy would drift the moment the API changed. Proxying means
the subdomain is always current — a change to the widget is live here with no
redeploy of this Worker at all.

Same approach as `join.westcoaststrength.com` (the online-join worker).

## URLs

| Public | Proxied to |
|---|---|
| `book.westcoaststrength.com/salem` | booking page (staff) |
| `book.westcoaststrength.com/salem/cancel?c=…&a=…` | cancel (member) |
| `book.westcoaststrength.com/salem/reschedule?c=…&a=…` | reschedule (member) |
| `book.westcoaststrength.com/` | location list |

Any club slug works: `salem`, `keizer`, `eugene`, `springfield`, `clackamas`,
`milwaukie`, `medford`.

## Why every path is prefixed

The Worker maps everything into `/dayone/*` on the origin. That is a security
boundary, not tidiness: the auth API also serves `/admin`, `/reports`, `/vault`
and the rest, and pointing a public subdomain straight at the service would
expose all of it on a friendly hostname. Here anything outside `/dayone` is
unreachable by construction, rather than by an allowlist someone has to keep
updating.

## Setup

### 1. Connect the repo (auto-deploy on push)

Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** →
**Connect to Git** → pick `wcs-staff-portal`, and set:

- **Root directory**: `cloudflare/dayone-site`
- **Build command**: leave empty (single file, no dependencies)
- **Deploy command**: `npx wrangler deploy`

Every push to `master` that touches this folder redeploys.

Or deploy by hand from this directory:

```bash
npx wrangler deploy
```

### 2. Point the subdomain at it

Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** →
`book.westcoaststrength.com`.

The zone is already on Cloudflare nameservers, so Cloudflare creates the DNS
record and issues the certificate itself. No manual CNAME.

### 3. Access

The widget is **open** — the link is the access. No secret, nothing to type,
which is what makes it usable from a QR code, an SMS or an embed.

That also means booking is reachable by anyone who has the URL, and booking
writes real appointments and sends real SMS to trainers. The origin rate limits
it (6 bookings/min and 60 reads/min per IP), which is why this Worker forwards
the real client IP.

If that ever stops being enough, put **Cloudflare Access** in front of the
booking path: Zero Trust → Access → Applications → add
`book.westcoaststrength.com/` with a policy for your staff email domain, and
**exclude** `/*/cancel` and `/*/reschedule` so members are never asked to log
in — those are keyed on contact and appointment ids and were always public.

## Local development

```bash
npx wrangler dev
```

Proxies the real API, so booking through it books for real. Use the cancel and
reschedule pages against a test contact rather than a member.

## The one coupling to know about

The Worker rewrites `var API = '…'` in HTML responses, because the page derives
its API base from the mount it was served under (`/dayone` on the origin, root
here). If that line in `auth/src/public/dayOne*.html` is ever renamed, this
rewrite silently stops matching and every API call from the subdomain 404s.

Both files live in the same repo, so a grep for `var API` catches it.
