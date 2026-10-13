import { test, expect } from '@playwright/test';

test('IndexedDB upgrade preserves history and pages without scanning the conversation', async ({ page }) => {
    await page.route('**/history-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>History test</title>' }));
    await page.goto('/history-test');
    const result = await page.evaluate(async () => {
        // Recreate the old schema before the service is first opened (logged out).
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('echo_web_local_db', 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                const messages = db.createObjectStore('messages', { keyPath: 'id' });
                messages.createIndex('owner_uuid', 'owner_uuid');
                messages.createIndex('owner_conversation', ['owner_uuid', 'conversation_uuid']);
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('messages', 'readwrite');
                for (const owner of ['owner', 'other']) {
                    for (let i = 0; i < 3000; i++) {
                        const uuid = String(i).padStart(6, '0');
                        // Many identical timestamps exercise the UUID cursor.
                        const time = 1_700_000_000_000 + Math.floor(i / 7);
                        tx.objectStore('messages').put({ id: `${owner}:${uuid}`, owner_uuid: owner,
                            conversation_uuid: 'conv', uuid, created_at_ms: time,
                            raw: { uuid, created_at: time }, sync_status: 'synced', is_pending: false });
                    }
                }
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
        });
        const path = '/src/services/webDatabase.ts';
        const { webDatabaseManager: db } = await import(/* @vite-ignore */ path);
        await db.initialize();
        // Fail if paging falls back to getAll (the previous implementation).
        const original = IDBIndex.prototype.getAll;
        IDBIndex.prototype.getAll = () => { throw new Error('Full history scan forbidden'); };
        try {
            const ids: string[] = [];
            let cursor: { limit: number; beforeCreatedAtMs?: number; beforeUuid?: string } = { limit: 50 };
            let pages = 0;
            for (;;) {
                const page = await db.getMessagesPage('conv', 'owner', cursor);
                ids.push(...page.messages.map((message: { uuid: string }) => message.uuid));
                pages++;
                if (!page.hasMoreLocal) break;
                const last = page.messages.at(-1);
                cursor = { limit: 50, beforeCreatedAtMs: last.created_at, beforeUuid: last.uuid };
                if (pages > 65) throw new Error('Pagination loop');
            }
            const empty = await db.getMessagesPage('missing', 'owner', { limit: 50 });
            const timestampOnly = await db.getMessagesPage('conv', 'owner', { limit: 50, beforeCreatedAtMs: 1_700_000_000_001 });
            return { ids, pages, count: await db.getMessageCount('conv', 'owner'), empty,
                timestampOnly: timestampOnly.messages.length };
        } finally { IDBIndex.prototype.getAll = original; }
    });
    expect(result.count).toBe(3000);
    expect(result.pages).toBe(60);
    expect(result.ids).toEqual(Array.from({ length: 3000 }, (_, index) => String(2999 - index).padStart(6, '0')));
    expect(result.empty).toEqual({ messages: [], hasMoreLocal: false });
    expect(result.timestampOnly).toBe(7);
});
