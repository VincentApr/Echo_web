import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync(new URL('../src/services/apiClient.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const jwt = offset => `header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + offset })).toString('base64url')}.signature`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function setup() {
  const values = new Map([['accessToken', jwt(-60)], ['refreshToken', 'refresh-old'], ['user', '{"uuid":"test-user"}']]);
  const requests = [];
  let handler;
  const context = {
    exports: {}, Headers, Response, AbortSignal, atob,
    require: name => { assert.equal(name, '../config/api'); return { API_BASE_URL: 'https://backend.example' }; },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    navigator: { locks: { request: (_name, callback) => Promise.resolve().then(callback) } },
    fetch: async (url, options) => { requests.push({ url, options }); return handler(url, options); },
  };
  vm.runInNewContext(js, context);
  let logouts = 0;
  context.exports.setLogoutCallback(() => { logouts++; values.clear(); });
  return { api: context.exports, values, requests, respond: fn => { handler = fn; }, logouts: () => logouts };
}

{
  const s = setup();
  const fresh = jwt(3600);
  s.values.set('accessToken', fresh);
  assert.equal(await s.api.getValidAccessToken(), fresh);
  assert.equal(s.requests.length, 0);
}
{
  const s = setup();
  let notified;
  const stop = s.api.subscribeAccessToken(token => { notified = token; });
  s.respond(() => json({ access: jwt(3600), refresh: 'rotated-refresh' }));
  const tokens = await Promise.all([s.api.getValidAccessToken(), s.api.getValidAccessToken(), s.api.getValidAccessToken()]);
  assert.equal(s.requests.length, 1, 'concurrent restoration shares a refresh');
  assert.equal(s.requests[0].url, 'https://backend.example/api/auth/token/refresh/');
  assert.deepEqual(JSON.parse(s.requests[0].options.body), { refresh: 'refresh-old' });
  assert.equal(s.values.get('refreshToken'), 'rotated-refresh');
  assert.equal(tokens[0], notified, 'React/WebSocket consumers receive the renewed token');
  assert.equal(tokens[0], tokens[2]);
  stop();
}
for (const failure of ['offline', 500, 429, 'invalid-json']) {
  const s = setup();
  s.respond(() => {
    if (failure === 'offline') throw new TypeError('Failed to fetch');
    if (failure === 'invalid-json') return new Response('<html>not an auth response</html>');
    return json({}, failure);
  });
  await assert.rejects(s.api.getValidAccessToken());
  assert.equal(s.logouts(), 0);
  assert.equal(s.values.get('refreshToken'), 'refresh-old');
  assert.ok(s.values.has('user'));
  s.respond(() => json({ access: jwt(3600) }));
  assert.ok(await s.api.getValidAccessToken(), 'session recovers after transient failure');
}
for (const status of [401, 403]) {
  const s = setup();
  s.respond(() => json({ code: 'token_not_valid' }, status));
  assert.equal(await s.api.getValidAccessToken(), null);
  assert.equal(s.logouts(), 1);
}
{
  const s = setup();
  const fresh = jwt(3600);
  s.respond((url, options) => url.endsWith('/token/refresh/')
    ? json({ access: fresh })
    : json({}, options.headers.get('Authorization') === `Bearer ${fresh}` ? 200 : 401));
  const responses = await Promise.all([s.api.fetchWithAuth('/profile'), s.api.fetchWithAuth('/conversations')]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(s.requests.filter(item => item.url.endsWith('/token/refresh/')).length, 1);
}
{
  const s = setup();
  let finish;
  s.respond(() => new Promise(resolve => { finish = resolve; }));
  const result = s.api.getValidAccessToken();
  await Promise.resolve();
  s.values.clear(); // Explicit logout while renewal is in flight.
  finish(json({ access: jwt(3600), refresh: 'must-not-be-restored' }));
  assert.equal(await result, null);
  assert.equal(s.values.size, 0);
}
{
  const s = setup();
  s.values.delete('accessToken');
  s.respond(() => json({ access: jwt(3600) }));
  assert.ok(await s.api.getValidAccessToken(), 'refresh token can restore a missing access token');
}
console.log('Session persistence checks passed: renewal, rotation, concurrency, offline recovery, rejection and logout.');
