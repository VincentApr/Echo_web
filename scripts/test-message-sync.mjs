import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync(new URL('../src/services/localSync.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const timestamp = Date.parse('2026-10-01T12:00:00Z');
function setup(pages) {
    const persisted = [];
    const requests = [];
    let checkpoints = 0;
    const db = {
        initialize: async () => {}, getMessageCount: async () => 1,
        getSyncState: async () => null, getNewestMessageTimestamp: async () => timestamp,
        getMessageUuids: async () => ['known'],
        upsertMessages: async messages => { persisted.push(...messages); },
        setSyncState: async () => { checkpoints++; },
    };
    const exports = {};
    const require = name => {
        if (name === '@web/config/api') return { API_BASE_URL: 'https://backend.example' };
        if (name === './webDatabase') return { webDatabaseManager: db };
        if (name === '../utils/logger') return { webLogger: { info() {}, warn() {}, error() {}, debug() {} } };
        if (name === '@web/services/apiClient') return { fetchWithAuth: async url => {
            requests.push(url);
            const page = pages[requests.length - 1];
            return page instanceof Error ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(page));
        } };
        throw new Error(name);
    };
    vm.runInNewContext(js, { exports, require, URL, window: { location: { origin: 'https://web.example' } } });
    return { api: exports, persisted, requests, checkpoints: () => checkpoints };
}
const message = (uuid, offset = 1) => ({ uuid, created_at: new Date(timestamp + offset).toISOString(), content: uuid });
const first = { results: [message('latest', 3000)], next: 'https://backend.example/messaging/conversations/conv/messages/?page=2' };
{
    const s = setup([first, { results: [message('middle', 2000), message('same-timestamp', 0), message('known', 0)], next: null }]);
    assert.equal(await s.api.syncNewerMessagesForConversation('owner', 'conv', { force: true }), 3);
    assert.equal(s.requests.length, 2);
    assert.ok(s.requests.every(url => url.startsWith('https://backend.example/')), 'production pagination stays on the backend');
    assert.equal(s.persisted.length, 4, 'all pages and same-timestamp messages are reconciled');
    assert.equal(s.checkpoints(), 1);
}
{
    const s = setup([first, new Error('offline')]);
    await assert.rejects(s.api.syncNewerMessagesForConversation('owner', 'conv', { force: true }));
    assert.equal(s.persisted.length, 0, 'partial recovery does not advance the local watermark');
    assert.equal(s.checkpoints(), 0);
}
{
    const s = setup([{ results: [message('latest')], next: 'https://untrusted.example/messages' }]);
    await assert.rejects(s.api.syncNewerMessagesForConversation('owner', 'conv', { force: true }));
    assert.equal(s.requests.length, 1, 'do not forward authenticated pagination to another origin');
}
console.log('Recovery checks passed: multiple pages, equal timestamps, interrupted recovery and production pagination.');
