// Talks to the service that manages the iPads. Signs in fresh for each run because
// sessions don't last. Addresses and the login come from the environment:
//   MEMO_IPAD_LOGIN_URL      where sign-in starts
//   MEMO_IPAD_WALLPAPER_URL  base address for reading and setting images
//   MEMO_IPAD_USER, MEMO_IPAD_PASSWORD
// Errors name the step that failed and never include the login or a response body.

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const FORM_FLAGS = { 'js-available': 'true', 'webauthn-available': 'true', 'is-brave': 'false', 'webauthn-platform-available': 'false' }
const MAX_REDIRECTS = 15
const TIMEOUT_MS = 30000

function isConfigured(env = process.env) {
  return !!(env.MEMO_IPAD_LOGIN_URL && env.MEMO_IPAD_WALLPAPER_URL && env.MEMO_IPAD_USER && env.MEMO_IPAD_PASSWORD)
}

function createClient({ env = process.env, fetchImpl = fetch } = {}) {
  const jar = new Map() // host -> Map(cookie name -> value)

  function keepCookies(url, res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const eq = pair.indexOf('=')
      const domain = attrs.find(a => /^\s*domain=/i.test(a))
      const host = domain ? domain.split('=')[1].trim().replace(/^\./, '') : new URL(url).host
      if (!jar.has(host)) jar.set(host, new Map())
      jar.get(host).set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  function cookiesFor(url) {
    const host = new URL(url).host
    const out = []
    for (const [h, cookies] of jar) {
      if (host === h || host.endsWith('.' + h)) for (const [k, v] of cookies) out.push(`${k}=${v}`)
    }
    return out.join('; ')
  }

  // Follows redirects by hand so cookies set along the way are kept.
  async function request(url, init = {}) {
    let current = url
    let options = init
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const res = await fetchImpl(current, {
        ...options,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json,*/*', cookie: cookiesFor(current), ...(options.headers || {}) },
      })
      keepCookies(current, res)
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).href
        options = {}
        continue
      }
      return { res, url: current }
    }
    throw new Error('Too many redirects')
  }

  const postForm = (url, fields) => request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })
  const stateOf = url => new URL(url).searchParams.get('state')

  async function signIn() {
    const user = env.MEMO_IPAD_USER
    const start = await request(env.MEMO_IPAD_LOGIN_URL)
    const state = stateOf(start.url)
    if (!state) throw new Error('Sign-in failed: login page not reached')

    const named = await postForm(start.url, { state, username: user, 'allow-passkeys': 'true', ...FORM_FLAGS })
    if (!new URL(named.url).pathname.includes('password')) throw new Error('Sign-in failed: password step not reached')

    const done = await postForm(named.url, { state: stateOf(named.url), username: user, password: env.MEMO_IPAD_PASSWORD, ...FORM_FLAGS })
    // Signing in ends back on the service. Still being on the login host means the
    // password was refused or it wants something more, like a two-step code.
    if (new URL(done.url).host === new URL(named.url).host || done.res.status >= 400) {
      throw new Error('Sign-in failed: login rejected or an extra step is required')
    }
  }

  const base = () => env.MEMO_IPAD_WALLPAPER_URL.replace(/\/$/, '')
  const jsonHeaders = { accept: 'application/json' }

  // { home, lock } image ids, which are the md5 of each image.
  async function readWallpaper(target) {
    const { res } = await request(`${base()}/${target}`, { headers: jsonHeaders })
    if (res.status !== 200) throw new Error(`Reading the current image failed (${res.status})`)
    return res.json()
  }

  async function readImage(id) {
    const { res } = await request(`${base()}/image/${id}`)
    if (res.status !== 200) throw new Error(`Saving the normal image failed (${res.status})`)
    return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/jpeg' }
  }

  async function setLockImage(target, bytes, type = 'image/png') {
    const body = new FormData()
    body.append('file', new Blob([bytes], { type }), type === 'image/png' ? 'memo.png' : 'memo.jpg')
    const { res } = await request(`${base()}/${target}/lock`, { method: 'POST', body, headers: jsonHeaders })
    if (res.status !== 200) throw new Error(`Uploading the image failed (${res.status})`)
    return res.json()
  }

  return { signIn, readWallpaper, readImage, setLockImage }
}

module.exports = { createClient, isConfigured }
