self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || '/icon-192x192.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        url: data.url
      },
      requireInteraction: true
    };
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Opens the page the notification is about (data.url, a same-site path set by
// send-push-notification), or the app root for notifications without one.
// Focuses a tab already showing that page; otherwise opens a new one rather
// than navigating an existing tab, which could throw away unsaved work there.
// An alert link (/alert/…) is the exception: a fire outranks unsaved work, so
// an open app window is focused and told to switch page in place (no reload,
// which would make the browser block the responder siren again until a tap).
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const path = event.notification.data && event.notification.data.url;
  const target = new URL(typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : '/', self.location.origin).href;
  const targetUrl = new URL(target);
  const isAlertLink = targetUrl.pathname.indexOf('/alert/') === 0;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === target && 'focus' in client) return client.focus();
      }
      if (isAlertLink && clientList.length > 0 && 'focus' in clientList[0]) {
        const client = clientList[0];
        client.postMessage({ type: 'open-url', url: targetUrl.pathname + targetUrl.search });
        return client.focus();
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
    })
  );
});
