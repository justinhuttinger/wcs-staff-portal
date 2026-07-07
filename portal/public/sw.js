/* Tour Check-In service worker — Web Push for the installed iPad app. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { /* non-JSON payload */ }
  const title = data.title || 'New tour'
  const options = {
    body: data.body || '',
    tag: data.tag || 'tour-arrival',
    renotify: true,
    requireInteraction: true,
    icon: '/wcs-logo.png',
    badge: '/wcs-logo.png',
    data: { url: data.url || null },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || null
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Prefer an already-open tour app window over anything else at this scope.
      const tourWin = wins.find((w) => w.url && w.url.includes('/tour.html'))
      if (tourWin && 'focus' in tourWin) return tourWin.focus()
      // App closed: open the tour URL carried in the push payload. Never open
      // '/' — that is the login-gated staff portal, not the tour app.
      if (url && self.clients.openWindow) return self.clients.openWindow(url)
      for (const w of wins) {
        if ('focus' in w) return w.focus()
      }
    })
  )
})
