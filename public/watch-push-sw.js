/* Echo watch notifications only. No fetch interception, offline cache or tokens. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function account(edit) {
    return new Promise((resolve, reject) => {
        const opening = indexedDB.open('echo-watch-push', 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore('binding');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction('binding', edit ? 'readwrite' : 'readonly');
            const store = tx.objectStore('binding');
            const read = store.get('owner');
            let value;
            read.onsuccess = () => {
                value = read.result || null;
                if (edit) { value = edit(value); store.put(value, 'owner'); }
            };
            tx.oncomplete = () => { db.close(); resolve(value); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
    if (event.data?.type !== 'echo-watch-account') return;
    const {owner,previous} = event.data;
    if (owner !== null && (typeof owner !== 'string' || !uuid.test(owner))) return;
    event.waitUntil(account(current => owner || (current === previous ? null : current)).then(() => {
        event.ports[0]?.postMessage({ok:true});
    }));
});
self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let data;
        try { data = event.data?.json(); } catch { return; }
        if (!data || !uuid.test(data.watch || '') || !uuid.test(data.owner || '') || await account() !== data.owner) return;
        await self.registration.showNotification('Echo', {
            body:'Une nouvelle veille vous attend.', icon:'/favicon-32.png', badge:'/favicon-32.png',
            tag:`echo-watch-${data.watch}`, renotify:false, data:{watch:data.watch,owner:data.owner},
        });
    })());
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const data = event.notification.data;
        if (!data || !uuid.test(data.watch || '') || await account() !== data.owner) return;
        const url = new URL(`/veilles/${data.watch}`, self.location.origin).href;
        const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
        const existing = windows.find(client=>new URL(client.url).origin === self.location.origin);
        if (existing) { await existing.navigate(url); await existing.focus(); }
        else await self.clients.openWindow(url);
    })());
});
