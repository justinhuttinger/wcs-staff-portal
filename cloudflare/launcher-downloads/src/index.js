// Launcher downloads + auto-update feed, served from a private R2 bucket.
//
// The GitHub repos are private, so GitHub Releases can no longer serve the
// launcher installer or electron-updater's latest.yml. CI uploads each build
// to R2 under a channel prefix and this Worker serves it publicly:
//
//   /{channel}/latest.yml             electron-updater feed (Windows; abc.yml on /abc)
//   /{channel}/latest-mac.yml         electron-updater feed (macOS; abc-mac.yml on /abc)
//   /{channel}/<versioned file>       installers, blockmaps, mac zips
//   /portal/Portal-Setup.exe          stable "latest Windows installer" link
//   /portal/Portal-mac-arm64.dmg      stable "latest Mac (Apple Silicon)" link
//   /portal/Portal-mac-x64.dmg        stable "latest Mac (Intel)" link
//   /abc/WCS-ABC-Setup.exe (+ WCS-ABC-mac-arm64.dmg / -x64.dmg)  same for WCS ABC
//   /{channel}/releases/latest        JSON summary for portal/public/download.html
//   /                                 download page (Portal + WCS ABC), see landing.js
//
// Channels: "portal" (the WCS Portal launcher) and "abc" (the ABC-only launcher,
// whose installer is named differently; the stable links resolve per channel).
// "kiosk" is reserved for Action1 kiosk scripts if they move off raw GitHub.

import { APPS, renderLanding } from './landing.js'

const CHANNELS = new Set(['portal', 'abc', 'kiosk'])

// Per-channel update feeds. The ABC app is built with `channel: abc`, so
// electron-updater reads abc.yml / abc-mac.yml instead of latest*.yml.
const FEEDS = {
  portal: { win: 'latest.yml', mac: 'latest-mac.yml' },
  abc:    { win: 'abc.yml',    mac: 'abc-mac.yml' },
}

// Stable alias -> which feed (win/mac) to read and how to pick the file.
const isExe = f => /\.exe$/i.test(f)
const isArmDmg = f => /arm64.*\.dmg$/i.test(f)
const isX64Dmg = f => /\.dmg$/i.test(f) && !/arm64/i.test(f)
const ALIASES = {
  portal: {
    'Portal-Setup.exe':      { feed: 'win', match: isExe },
    'Portal-mac-arm64.dmg':  { feed: 'mac', match: isArmDmg },
    'Portal-mac-x64.dmg':    { feed: 'mac', match: isX64Dmg },
  },
  abc: {
    'WCS-ABC-Setup.exe':     { feed: 'win', match: isExe },
    'WCS-ABC-mac-arm64.dmg': { feed: 'mac', match: isArmDmg },
    'WCS-ABC-mac-x64.dmg':   { feed: 'mac', match: isX64Dmg },
  },
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text('Method not allowed', 405)
    }

    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts.length === 0) return landing(env, request)

    const [channel, ...rest] = parts
    if (!CHANNELS.has(channel) || rest.length === 0) return text('Not found', 404)
    // No path traversal or nested keys beyond "releases/latest".
    if (rest.some(p => p === '..' || p === '.' || /[\\/]/.test(p))) return text('Bad request', 400)

    if (rest.join('/') === 'releases/latest') return releaseSummary(env, channel, url)
    if (rest.length !== 1) return text('Not found', 404)

    let name = rest[0]
    const alias = ALIASES[channel] && ALIASES[channel][name]
    if (alias) {
      const feed = await readFeed(env, channel, FEEDS[channel][alias.feed])
      const file = feed && feed.files.find(f => alias.match(f.url))
      if (!file) return text('No release published yet', 404)
      // Redirect so the browser saves the real versioned filename and the
      // versioned object can be cached as immutable.
      return new Response(null, {
        status: 302,
        headers: { ...CORS, Location: `/${channel}/${encodeURIComponent(file.url)}`, 'Cache-Control': 'no-store' },
      })
    }

    return serveObject(request, env, `${channel}/${name}`, name)
  },
}

// "/" : download page for every app, built from the live feeds.
async function landing(env, request) {
  const feeds = {}
  await Promise.all(APPS.map(async app => {
    const [win, mac] = await Promise.all([
      readFeed(env, app.channel, FEEDS[app.channel].win),
      readFeed(env, app.channel, FEEDS[app.channel].mac),
    ])
    feeds[app.channel] = { win, mac }
  }))
  const html = renderLanding(feeds)
  return new Response(request.method === 'HEAD' ? null : html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

async function serveObject(request, env, key, name) {
  const isFeed = /\.ya?ml$/i.test(name)
  const obj = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers })
  if (obj === null) return text('Not found', 404)

  const headers = new Headers(CORS)
  obj.writeHttpMetadata(headers)
  headers.set('ETag', obj.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  // Feeds change every release; everything else is versioned and immutable.
  headers.set('Cache-Control', isFeed ? 'no-cache' : 'public, max-age=31536000, immutable')
  if (!headers.has('Content-Type')) headers.set('Content-Type', contentType(name))
  if (/\.(exe|dmg|zip)$/i.test(name)) headers.set('Content-Disposition', `attachment; filename="${name}"`)

  // onlyIf precondition failed (e.g. If-None-Match matched): body is absent.
  if (!('body' in obj) || !obj.body) {
    return new Response(null, { status: 304, headers })
  }

  if (obj.range && request.headers.has('range')) {
    const { offset = 0, length = obj.size - offset } = obj.range
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    headers.set('Content-Length', String(length))
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers })
  }
  headers.set('Content-Length', String(obj.size))
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers })
}

// Minimal parser for electron-builder's latest*.yml: version, releaseDate and
// the files list (url + size). Avoids a YAML dependency in the Worker.
async function readFeed(env, channel, feedName) {
  const obj = await env.BUCKET.get(`${channel}/${feedName}`)
  if (!obj) return null
  const body = await obj.text()
  const feed = { version: '', releaseDate: '', files: [] }
  let current = null
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    let m
    if ((m = line.match(/^version:\s*['"]?([^'"]+)['"]?$/))) feed.version = m[1]
    else if ((m = line.match(/^releaseDate:\s*['"]?([^'"]+)['"]?$/))) feed.releaseDate = m[1]
    else if ((m = line.match(/^\s*-\s*url:\s*['"]?([^'"]+)['"]?$/))) {
      current = { url: m[1], size: 0 }
      feed.files.push(current)
    } else if (current && (m = line.match(/^\s+size:\s*(\d+)$/))) current.size = Number(m[1])
    else if (/^\S/.test(line)) current = null
  }
  return feed
}

async function releaseSummary(env, channel, url) {
  const feeds = FEEDS[channel]
  if (!feeds) return json({ error: 'No releases on this channel' }, 404)
  const [win, mac] = await Promise.all([
    readFeed(env, channel, feeds.win),
    readFeed(env, channel, feeds.mac),
  ])
  if (!win && !mac) return json({ error: 'No release published yet' }, 404)
  const base = `${url.origin}/${channel}/`
  const files = []
  for (const feed of [win, mac]) {
    if (!feed) continue
    for (const f of feed.files) {
      if (/\.zip$/i.test(f.url)) continue // mac update payloads, not for humans
      files.push({ name: f.url, size: f.size, url: base + encodeURIComponent(f.url), version: feed.version })
    }
  }
  const newest = [win, mac].filter(Boolean).sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1))[0]
  return json({ version: newest.version, releaseDate: newest.releaseDate, files })
}

function contentType(name) {
  if (/\.ya?ml$/i.test(name)) return 'text/yaml; charset=utf-8'
  if (/\.exe$/i.test(name)) return 'application/vnd.microsoft.portable-executable'
  if (/\.dmg$/i.test(name)) return 'application/x-apple-diskimage'
  if (/\.zip$/i.test(name)) return 'application/zip'
  if (/\.ps1$/i.test(name)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function text(body, status) {
  return new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } })
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
