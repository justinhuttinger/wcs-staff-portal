/**
 * book.westcoaststrength.com — booking pages, proxied from the auth API.
 *
 * A reverse proxy, not a copy. The pages are server-rendered (the API injects
 * the mount base and location into the HTML), so a static duplicate would drift
 * the moment the API changed. Proxying means the subdomain is always current
 * with no deploy at all — the same approach as the online-join worker on
 * join.westcoaststrength.com.
 *
 * Paths pass through UNCHANGED:
 *
 *   /dayone/salem            -> /dayone/salem
 *   /dayone/salem/cancel     -> /dayone/salem/cancel
 *   /dayone/api/config       -> /dayone/api/config
 *
 * Keeping the /dayone segment leaves room for other booking types later (/pt,
 * /tour, …) on the same subdomain. It also means the page's own idea of its
 * mount base is already correct, so nothing in the HTML needs rewriting.
 *
 * Because paths are no longer implicitly scoped by a rewrite, ALLOWED is the
 * boundary: the auth API also serves /admin, /reports and /vault, and a public
 * subdomain must not expose those. Adding a booking type here is a deliberate
 * one-line act, which is the point.
 */

const ORIGIN = 'https://wcs-auth-api.onrender.com'

// Path prefixes this subdomain will serve. Everything else 404s.
const ALLOWED = ['/dayone']

// Where "/" sends people. Update if this stops being the only booking type.
const DEFAULT_PATH = '/dayone/'

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Health check for uptime monitors, answered without touching the origin.
    if (url.pathname === '/__health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    }

    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect(new URL(DEFAULT_PATH, url).toString(), 302)
    }

    const permitted = ALLOWED.some(
      p => url.pathname === p || url.pathname.startsWith(p + '/'))
    if (!permitted) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      })
    }

    const target = new URL(ORIGIN)
    target.pathname = url.pathname
    target.search = url.search

    const headers = new Headers(request.headers)
    // The origin must see its own host, not ours, or Express builds the wrong
    // absolute URLs.
    headers.delete('host')
    // Keep the real client IP visible: the origin rate limits booking (6/min)
    // and reads (60/min) per IP, and without this every request would look like
    // it came from Cloudflare.
    const clientIp = request.headers.get('cf-connecting-ip')
    if (clientIp) headers.set('x-forwarded-for', clientIp)

    // No credential is injected: the widget is open by design, the link itself
    // is the access. If abuse appears, put Cloudflare Access in front of
    // /dayone/:location so only signed-in staff can book, and exclude
    // /dayone/*/cancel and /dayone/*/reschedule so members are not asked to log
    // in. See README.

    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    })

    // Passed through as-is. Paths are identical on both sides, so the API base
    // the page renders for itself is already right — there is no HTML rewriting
    // here, and nothing to silently break if that markup changes.
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  },
}
