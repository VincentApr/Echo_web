// Isolated review environment: real watch API and source decisions + in-memory fixture DB.
// Never proxy to production. The ordinary development server remains unchanged.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const python = process.env.ECHO_TEST_PYTHON || 'python3';
const experience = process.env.ECHO_WATCH_PREVIEW_MODE === 'experience';
const agents = experience || process.env.ECHO_WATCH_PREVIEW_MODE === 'agents';
const topics = agents || process.env.ECHO_WATCH_PREVIEW_MODE === 'topics';
const intelligent = topics || process.env.ECHO_WATCH_PREVIEW_MODE === 'intelligent';
const apiPort = experience ? 8006 : agents ? 8005 : topics ? 8004 : intelligent ? 8003 : 8002;
const previewPort = experience ? 5179 : agents ? 5178 : topics ? 5177 : intelligent ? 5176 : 5175;
const api = spawn(python, ['scripts/test-watches-backend.py', '--serve', String(apiPort), ...(intelligent ? ['--intelligent'] : []), ...(topics ? ['--group-topics'] : []), ...(agents ? ['--agents'] : []), ...(experience ? ['--experience'] : [])], { stdio: 'inherit' });
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
        name: 'echo-local-watch-review',
        async transformIndexHtml() {
            const profile = await fetch(`http://127.0.0.1:${apiPort}/api/auth/profile/`).then(response => response.json());
            const token = `header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`;
            return [{ tag: 'script', injectTo: 'head-prepend', children: `if (!localStorage.getItem(${JSON.stringify(`echo:pinned-conversations:${profile.uuid}`)})) localStorage.setItem(${JSON.stringify(`echo:pinned-conversations:${profile.uuid}`)}, ${JSON.stringify(JSON.stringify([profile.preview_pinned_uuid]))});localStorage.setItem('user', ${JSON.stringify(JSON.stringify(profile))});localStorage.setItem('accessToken', ${JSON.stringify(token)});localStorage.setItem('refreshToken', 'local-preview-only');` }, {
                tag: 'div', injectTo: 'body', attrs: { style: 'position:fixed;bottom:8px;right:12px;z-index:9999;padding:7px 12px;border-radius:8px;background:#173c30;color:white;font:12px system-ui;pointer-events:none;' },
                children: experience ? 'Aperçu Gmail + GitHub · données fictives · illustration IA d’exemple · aucun push réel' : agents ? 'Simulation lot 4 · relais agent réel · services et IA simulés' : topics ? 'Simulation lot 3 · regroupement réel · services et IA simulés' : intelligent ? 'Simulation lot 2 · moteur réel · services et IA simulés' : 'Simulation locale · données fictives · aucun appel IA',
            }];
        },
    }] });
    await server.listen();
    console.log(`Aperçu veilles : http://127.0.0.1:${previewPort}/`);
    console.log(agents ? 'Accueil → Votre candidature de stage → Discuter avec Recherche de stage' : 'Accueil → une veille → Accepter / Refuser');
} catch (error) {
    await close();
    console.error(error);
    process.exitCode = 1;
}
