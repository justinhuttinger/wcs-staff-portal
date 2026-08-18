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

| Public | Purpose |
|---|---|
| `book.westcoaststrength.com/dayone/salem` | booking page |
| `book.westcoaststrength.com/dayone/salem/cancel?c=…&a=…` | cancel (member) |
| `book.westcoaststrength.com/dayone/salem/reschedule?c=…&a=…` | reschedule (member) |
| `book.westcoaststrength.com/dayone/` | location list |
| `book.westcoaststrength.com/` | redirects to `/dayone/` |

Any club slug works: `salem`, `keizer`, `eugene`, `springfield`, `clackamas`,
`milwaukie`, `medford`.

Paths pass through **unchanged** to the origin. The `/dayone` segment is kept
rather than stripped so other booking types can live beside it later — `/pt`,
`/tour` — on the same subdomain, each with its own pages. It also means the
page's own idea of its mount base is already correct, so no HTML is rewritten in
transit and nothing here breaks if that markup changes.

## The allowlist is the security boundary

`ALLOWED` in `src/index.js` lists the path prefixes this subdomain will serve.
Everything else 404s before the request ever reaches the origin.

That matters because the auth API also serves `/admin`, `/reports` and `/vault`.
Pointing a public subdomain straight at the service would put all of it on a
friendly hostname. Adding a booking type is a deliberate one-line edit here,
which is exactly the point — a new prefix should be a decision, not a side
effect of someone adding a route to the API.

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
`book.westcoaststrength.com/dayone/` with a policy for your staff email domain,
and **exclude** `/dayone/*/cancel` and `/dayone/*/reschedule` so members are
never asked to log in — those are keyed on contact and appointment ids and were
always public.

## Local development

```bash
npx wrangler dev
```

Proxies the real API, so booking through it books for real. Use the cancel and
reschedule pages against a test contact rather than a member.

## Adding another booking type

When there is a second way to book, add its prefix to `ALLOWED` and point
`DEFAULT_PATH` wherever `/` should land:

```js
const ALLOWED = ['/dayone', '/pt']
```

Nothing else changes here — the pages come from the auth API, so the work is on
that side. This Worker only decides what the subdomain is willing to serve.
