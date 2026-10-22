// Isolated review environment: real group moderation API + in-memory fixture DB.
// Never proxy to production. The ordinary development server remains unchanged.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const python = process.env.ECHO_TEST_PYTHON || 'python3';
const apiPort = 8007;
const previewPort = 5181;
const api = spawn(python, ['scripts/test-group-moderation-backend.py', '--serve', String(apiPort)], { stdio: 'inherit' });
let server;
const close = async () => { api.kill(); await server?.close(); };
process.on('SIGINT', () => { void close().then(() => process.exit()); });
process.on('SIGTERM', () => { void close().then(() => process.exit()); });
try {
    let user;
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            const response = await fetch(`http://127.0.0.1:${apiPort}/api/auth/profile/`);
            if (response.ok) { user = await response.json(); break; }
        } catch { /* Wait for the isolated Python API to start. */ }
        if (api.exitCode !== null) throw new Error('Impossible de démarrer l’API de simulation.');
        await delay(100);
    }
    if (!user) throw new Error('API de simulation indisponible.');
    const proxy = Object.fromEntries(['/watches', '/tools', '/api', '/messaging', '/framework', '/jarvis', '/groups', '/relations', '/notif', '/scripts', '/news', '/feedback', '/calendrier', '/ws'].map(prefix => [prefix, {
        target: `http://127.0.0.1:${apiPort}`, changeOrigin: true,
    }]));
    server = await createServer({ server: { host: '127.0.0.1', port: previewPort, strictPort: true, proxy }, plugins: [{
        name: 'echo-local-group-review',
        async transformIndexHtml() {
            const profile = await fetch(`http://127.0.0.1:${apiPort}/api/auth/profile/`).then(response => response.json());
            const token = `header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`;
            return [{ tag: 'script', injectTo: 'head-prepend', children: `if (!localStorage.getItem(${JSON.stringify(`echo:pinned-conversations:${profile.uuid}`)})) localStorage.setItem(${JSON.stringify(`echo:pinned-conversations:${profile.uuid}`)}, ${JSON.stringify(JSON.stringify([profile.preview_pinned_uuid]))});localStorage.setItem('user', ${JSON.stringify(JSON.stringify(profile))});localStorage.setItem('accessToken', ${JSON.stringify(token)});localStorage.setItem('refreshToken', 'local-preview-only');` }, {
                tag: 'div', injectTo: 'body', attrs: { style: 'position:fixed;bottom:8px;right:12px;z-index:9999;padding:7px 12px;border-radius:8px;background:#173c30;color:white;font:12px system-ui;pointer-events:none;' },
                children: 'Simulation modération · données fictives · aucun appel IA',
            }];
        },
    }] });
    await server.listen();
    console.log(`Aperçu modération : http://127.0.0.1:${previewPort}/`);
    console.log('Accueil → Escapades → nom du groupe dans le header → Membres');
} catch (error) {
    await close();
    console.error(error);
    process.exitCode = 1;
}
