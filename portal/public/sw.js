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
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) return w.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})
