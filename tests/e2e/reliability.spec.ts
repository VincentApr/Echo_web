import { test, expect, type Page, type Route, type WebSocketRoute } from '@playwright/test';

const owner = '11111111-1111-4111-8111-111111111111';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const conversations = [
    { uuid: a, other_participant: { uuid: 'alice', username: 'Alice' }, name: 'Alice', conversation_type: 'direct', unread_count: 0 },
    { uuid: b, other_participant: { uuid: 'bob', username: 'Bob' }, name: 'Bob', conversation_type: 'direct', unread_count: 0 },
];
async function setup(page: Page, send?: (route: Route) => Promise<void>) {
    const requests: string[] = [];
    const sockets: WebSocketRoute[] = [];
    const messages: Record<string, object[]> = { [a]: [], [b]: [] };
    await page.addInitScript(({ owner }) => {
        if (localStorage.getItem('test-session-initialized')) return;
        localStorage.setItem('test-session-initialized', 'yes');
        localStorage.setItem('user', JSON.stringify({ uuid: owner, username: 'Tester', email: 'test@example.test', has_accepted_cgu: true, ai_agents_enabled: true }));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test-refresh');
    }, { owner });
    await page.routeWebSocket(/\/ws\/chat\//, ws => { sockets.push(ws); });
    // Every backend route is intercepted: the tests never use real accounts.
    await page.route(/\/(api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        if (path.endsWith('/messages/create/') && send) return send(route);
        if (path === '/messaging/conversations/private/') return route.fulfill({ json: conversations });
        if (path.includes('/messages/')) {
            const id = path.split('/')[3];
            return route.fulfill({ json: { results: messages[id] || [], next: null } });
        }
        if (path === `/messaging/conversations/${a}/` || path === `/messaging/conversations/${b}/`) {
            const id = path.split('/')[3];
            return route.fulfill({ json: { ...conversations.find(item => item.uuid === id), messages: messages[id] } });
        }
        return route.fulfill({ json: [] });
    });
    await page.goto('/');
    await page.getByTitle('Conversations', { exact: true }).click();
    await page.locator('.conv-square[title="Alice"]').click();
    await expect(page.locator('.web-bottom-bar__input')).toBeVisible();
    return { requests, sockets, messages };
}
const input = (page: Page) => page.locator('.web-bottom-bar__input');

test('older history keeps its visible anchor and uses a discreet loader', async ({ page }) => {
    const fixture = await setup(page);
    await page.evaluate(async ({ owner, a }) => {
        const path = '/src/services/webDatabase.ts';
        const { webDatabaseManager: db } = await import(/* @vite-ignore */ path);
        const connection = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('echo_web_local_db');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = connection.transaction('messages', 'readwrite');
            for (let i = 0; i < 160; i++) {
                const uuid = `history-${String(i).padStart(4, '0')}`;
                const time = Date.now() - (200 - i) * 60_000;
                const raw = { uuid, conversation_uuid: a, sender_uuid: 'alice', sender_username: 'Alice',
                    content: `Historique ${i} — message de test`, created_at: new Date(time).toISOString(), is_ai_generated: false };
                tx.objectStore('messages').put({ id: `${owner}::${uuid}`, owner_uuid: owner,
                    uuid, conversation_uuid: a, created_at_ms: time, raw, sync_status: 'synced', is_pending: false });
            }
            tx.oncomplete = () => { connection.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        });
        const original = db.getMessagesPage.bind(db);
        db.getMessagesPage = async (...args: unknown[]) => {
            if ((args[2] as { beforeCreatedAtMs?: number }).beforeCreatedAtMs !== undefined) {
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            return original(...args);
        };
    }, { owner, a });
    fixture.sockets.at(-1)!.send(JSON.stringify({ type: 'message_updated', message: {
        uuid: 'history-0159', conversation_uuid: a, content: 'Historique 159 — message de test',
    } }));
    await expect(page.getByText('Historique 159 — message de test', { exact: true })).toBeVisible();
    const viewport = page.locator('.thread-messages');
    await viewport.evaluate(element => { element.scrollTop = 80; });
    await expect(page.getByRole('status', { name: 'Chargement des messages précédents' })).toBeVisible();
    const anchor = page.getByText('Historique 130 — message de test', { exact: true });
    const before = await anchor.boundingBox();
    expect(before).not.toBeNull();
    await expect(page.getByRole('status', { name: 'Chargement des messages précédents' })).toHaveCount(0);
    await expect(page.getByText('Historique 100 — message de test', { exact: true })).toHaveCount(1);
    const after = await anchor.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(3);
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(80);

    // A media-like late expansion above the viewport must not shift reading.
    await page.getByText('Historique 100 — message de test', { exact: true }).evaluate(element => {
        element.style.paddingBottom = '120px';
    });
    await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - before!.y)).toBeLessThan(3);

    // A failed page remains explicitly retryable instead of looping at the top.
    await page.evaluate(async () => {
        const path = '/src/services/webDatabase.ts';
        const { webDatabaseManager: db } = await import(/* @vite-ignore */ path);
        const original = db.getMessagesPage.bind(db);
        db.historyTestFail = true;
        db.getMessagesPage = async (...args: unknown[]) => {
            if (db.historyTestFail && (args[2] as { beforeCreatedAtMs?: number }).beforeCreatedAtMs !== undefined) {
                throw new Error('History temporarily unavailable');
            }
            return original(...args);
        };
    });
    await viewport.evaluate(element => { element.scrollTop = 0; });
    const retry = page.getByRole('button', { name: 'Réessayer le chargement' });
    await expect(retry).toBeVisible({ timeout: 15000 });
    await page.evaluate(async () => {
        const path = '/src/services/webDatabase.ts';
        const { webDatabaseManager: db } = await import(/* @vite-ignore */ path);
        db.historyTestFail = false;
    });
    await retry.click();
    await expect(page.getByText('Historique 70 — message de test', { exact: true })).toHaveCount(1);
    await expect(retry).toHaveCount(0);

    // Opening a message menu freezes the underlying conversation; closing it
    // restores normal scrolling at the same position.
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.getByText('Historique 159 — message de test', { exact: true }).click();
    await expect(page.locator('.msg-ctx-backdrop')).toBeVisible();
    await expect(viewport).toHaveCSS('overflow-y', 'hidden');
    const lockedTop = await viewport.evaluate(element => element.scrollTop);
    await page.mouse.move(650, 350);
    await page.mouse.wheel(0, -400);
    await page.keyboard.press('PageUp');
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(lockedTop);
    await page.keyboard.press('Escape');
    await expect(page.locator('.msg-ctx-backdrop')).toHaveCount(0);
    await expect(viewport).toHaveCSS('overflow-y', 'auto');
    await page.mouse.wheel(0, -300);
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeLessThan(lockedTop);
});

test('drafts stay in their conversation and survive reload with agent selection', async ({ page }) => {
    await setup(page);
    await input(page).fill('Brouillon Alice');
    await page.getByRole('button', { name: 'Parler à Jarvis dans ce fil' }).click();
    await page.locator('.conv-square[title="Bob"]').click();
    await expect(input(page)).toHaveValue('');
    await input(page).fill('Brouillon Bob');
    await page.locator('.conv-square[title="Alice"]').click();
    await expect(input(page)).toHaveValue('Brouillon Alice');
    await expect(page.getByText('Commencer un thread avec Jarvis')).toBeVisible();
    await page.reload();
    await page.getByTitle('Conversations', { exact: true }).click();
    await page.locator('.conv-square[title="Alice"]').click();
    await expect(input(page)).toHaveValue('Brouillon Alice');
    await expect(page.getByText('Commencer un thread avec Jarvis')).toBeVisible();
});

test('late failure in Alice cannot overwrite Bob or his reply target', async ({ page }) => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let submitted!: () => void;
    const arrived = new Promise<void>(resolve => { submitted = resolve; });
    await setup(page, async route => { submitted(); await waiting; await route.fulfill({ status: 400, json: { detail: 'Rejected' } }); });
    await input(page).fill('Message refusé Alice');
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await arrived;
    await page.locator('.conv-square[title="Bob"]').click();
    await input(page).fill('Brouillon Bob');
    release();
    await expect.poll(() => page.evaluate(({ owner, a }) => JSON.parse(localStorage.getItem('echo:composer:v1:' + JSON.stringify([owner, a]))!).sends[0]?.status, { owner, a })).toBe('failed');
    await expect(input(page)).toHaveValue('Brouillon Bob');
    await page.locator('.conv-square[title="Alice"]').click();
    await page.getByRole('button', { name: 'Reprendre dans la saisie' }).click();
    await expect(input(page)).toHaveValue('Message refusé Alice');
});

test('a lost HTTP response is recoverable, never retried automatically', async ({ page }) => {
    let attempts = 0;
    await setup(page, async route => { attempts++; await route.abort('failed'); });
    await input(page).fill('Envoi incertain');
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByText('Envoi non confirmé : vérifie la conversation avant de le renvoyer.', { exact: false })).toBeVisible();
    await page.reload();
    await page.getByTitle('Conversations', { exact: true }).click();
    await page.locator('.conv-square[title="Alice"]').click();
    await expect(page.getByRole('button', { name: 'Reprendre dans la saisie' })).toBeEnabled();
    expect(attempts).toBe(1);
});

test('offline sends preserve text without a network submission', async ({ page, context }) => {
    let attempts = 0;
    await setup(page, async route => { attempts++; await route.fulfill({ json: {} }); });
    await input(page).fill('À envoyer plus tard');
    await context.setOffline(true);
    await expect(page.getByText('Hors connexion · les brouillons sont conservés')).toBeVisible();
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByText('Message non envoyé.', { exact: false })).toBeVisible();
    expect(attempts).toBe(0);
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Reprendre dans la saisie' }).click();
    await expect(input(page)).toHaveValue('À envoyer plus tard');
});

test('reconnection retrieves a missed message without reloading the page', async ({ page }) => {
    const { sockets, messages } = await setup(page);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    messages[a].push({ uuid: 'missed-message', conversation_uuid: a, content: 'Message reçu pendant la coupure', created_at: new Date().toISOString(), sender_uuid: 'alice', sender_username: 'Alice' });
    sockets.at(-1)!.close({ code: 1001 });
    await expect(page.getByText('Message reçu pendant la coupure', { exact: true })).toBeVisible();
});

test('a successful delayed send does not clear the next draft and double clicks send once', async ({ page }) => {
    let attempts = 0;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    await setup(page, async route => {
        attempts++;
        await waiting;
        const body = route.request().postDataJSON();
        await route.fulfill({ json: { uuid: 'confirmed', conversation_uuid: a, sender_uuid: owner,
            content: body.content, client_message_id: body.client_message_id, created_at: new Date().toISOString() } });
    });
    await input(page).fill('Premier message');
    // Two synchronous clicks exercise the submit lock, not just the disabled UI.
    await page.getByRole('button', { name: 'Envoyer', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => attempts).toBe(1);
    await input(page).fill('Brouillon suivant');
    release();
    await expect(page.getByText('Premier message', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(({ owner, a }) => JSON.parse(localStorage.getItem('echo:composer:v1:' + JSON.stringify([owner, a]))!).sends.length, { owner, a })).toBe(0);
    await expect(input(page)).toHaveValue('Brouillon suivant');
    expect(attempts).toBe(1);
});

test('HTTP acceptance followed by a sync failure must not offer to resend', async ({ page }) => {
    const { requests } = await setup(page);
    let accepted = false;
    await page.route(`**/messaging/conversations/${a}/messages/**`, async route => {
        if (new URL(route.request().url()).pathname.endsWith('/create/')) {
            accepted = true;
            const body = route.request().postDataJSON();
            return route.fulfill({ json: { uuid: 'accepted-before-error', conversation_uuid: a, sender_uuid: owner,
                content: body.content, client_message_id: body.client_message_id, created_at: new Date().toISOString() } });
        }
        if (accepted) return route.fulfill({ status: 503, json: {} });
        return route.fallback();
    });
    await input(page).fill('Déjà envoyé');
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Message envoyé');
    await expect(page.getByRole('button', { name: 'Reprendre dans la saisie' })).toHaveCount(0);
    await expect(input(page)).toHaveValue('');
    expect(requests.length).toBeGreaterThan(0);
});

test('reopening with an expired access token renews the session and keeps the draft', async ({ page }) => {
    await setup(page);
    await input(page).fill('Brouillon conservé après expiration');
    await page.evaluate(() => localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`));
    let renewals = 0;
    await page.route('**/api/auth/token/refresh/', async route => {
        renewals++;
        await route.fulfill({ json: { access: `header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`, refresh: 'rotated-test-refresh' } });
    });
    await page.reload();
    await page.getByTitle('Conversations', { exact: true }).click();
    await page.locator('.conv-square[title="Alice"]').click();
    await expect(input(page)).toHaveValue('Brouillon conservé après expiration');
    expect(renewals).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('refreshToken'))).toBe('rotated-test-refresh');
});
