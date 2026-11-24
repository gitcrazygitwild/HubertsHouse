// Hubert's House service worker: phone reminders only (bins out tonight, bath night,
// Frankie's next bottle). No caching and no fetch handler, so the app loads exactly as
// before. A tap on a reminder opens (or focuses) the app on the right page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let note = {};
  try { note = event.data ? event.data.json() : {}; } catch { note = { body:event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(note.title || 'Hubert’s House', {
    body:note.body || '', tag:note.tag || 'hubert', renotify:true, icon:'./icon-192.png', badge:'./icon-192.png', data:{ url:note.url || './' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const same = open.find(client => client.url.startsWith(self.registration.scope));
    if (same) { await same.focus(); if ('navigate' in same) await same.navigate(target).catch(() => {}); return; }
    await self.clients.openWindow(target);
  })());
});
