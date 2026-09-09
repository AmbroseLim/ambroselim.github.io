self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Pulse', body: 'New message' }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/vite.svg', badge: '/vite.svg' }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => windows[0]?.focus() ?? clients.openWindow('/')))
})
