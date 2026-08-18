/**
 * book.westcoaststrength.com — Day One booking, cancel and reschedule.
 *
 * A reverse proxy, not a copy. The pages are rendered by the auth API (it
 * injects the mount base and location into the HTML), so a static duplicate
 * would drift the moment the API changed. Proxying means the subdomain is
 * always current with no deploy at all — the same approach as the online-join
 * worker on join.westcoaststrength.com.
 *
 * Every incoming path is mapped into /dayone/* on the origin:
 *
 *   /                 -> /dayone/
 *   /salem            -> /dayone/salem
 *   /salem/cancel     -> /dayone/salem/cancel
 *   /api/config       -> /dayone/api/config
 *   /logo.png         -> /dayone/logo.png
 *
 * That prefix is not decoration: it means nothing outside /dayone can be
 * reached through this hostname. The auth API also serves /admin, /reports,
 * /vault and the rest, and pointing a public subdomain straight at the service
 * would expose all of it. Here it is unreachable by construction rather than by
 * an allowlist someone has to remember to update.
 */

const ORIGIN = 'https://wcs-auth-api.onrender.com'
const MOUNT = '/dayone'

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Health check for uptime monitors, answered without touching the origin.
    if (url.pathname === '/__health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    }

    const target = new URL(ORIGIN)
    target.pathname = MOUNT + (url.pathname === '/' ? '/' : url.pathname)
    target.search = url.search

    const headers = new Headers(request.headers)
    // The origin must see its own host, not ours, or Express builds the wrong
    // absolute URLs.
    headers.delete('host')
    // Keep the real client IP visible: the origin rate limits on it, and
    // without this every request would look like it came from Cloudflare.
    const clientIp = request.headers.get('cf-connecting-ip')
    if (clientIp) headers.set('x-forwarded-for', clientIp)

    // No credential is injected: the widget is open by design, the link itself
    // is the access. The origin rate limits booking (6/min) and reads (60/min)
    // per IP, which is why forwarding the real client IP above matters.
    //
    // If abuse appears, put Cloudflare Access in front of /:location so only
    // signed-in staff can book, and exclude /*/cancel and /*/reschedule so
    // members are not asked to log in. See README.

    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    })

    // The page derives its API base from the mount it was served under, which
    // is /dayone on the origin. From this hostname the mount is the root, so
    // rewrite it — otherwise every call would go to /dayone/api/... here and
    // get proxied to /dayone/dayone/api/...
    const type = response.headers.get('content-type') || ''
    if (type.includes('text/html')) {
      const body = (await response.text()).replace(/var API = '[^']*'/, "var API = ''")
      const out = new Headers(response.headers)
      out.delete('content-length')      // length changed
      out.delete('content-encoding')    // body is decoded now
      return new Response(body, { status: response.status, headers: out })
    }

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  },
}
