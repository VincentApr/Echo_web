import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, empty = false, failCreate = false) {
    const agents = [
        { uuid: 'atelier', name: 'Atelier', description: 'Des idées claires, des projets qui avancent.', is_favorite: true },
        { uuid: 'voyages', name: 'Voyages', description: 'De nouvelles perspectives pour vos prochaines escapades.' },
        { uuid: 'lecture', name: 'Lecture', description: 'Des lectures et des découvertes à partager.' },
        { uuid: 'musique', name: 'Musique', description: 'Une bande-son pour chaque moment.' },
    ];
    const conversations = empty ? [] : [
        { uuid: 'atelier-recent', agent_uuid: 'atelier', agent_name: 'Atelier', updated_at: '2026-10-24', last_message: { content: 'Réponse IA à ne pas afficher', is_ai_generated: true, created_at: '2026-10-24' } },
        { uuid: 'atelier-old', framework_agent: agents[0], updated_at: '2026-10-20' },
        ...agents.slice(1).map(agent => ({ uuid: `${agent.uuid}-conv`, agent_uuid: agent.uuid, agent_name: agent.name, updated_at: '2026-10-21' })),
    ].map(item => ({ ...item, conversation_type: 'agent', unread_count: 0 }));
    const creates: unknown[] = [];
    await page.addInitScript(() => {
        localStorage.setItem('user', JSON.stringify({ uuid: 'wallet-owner', username: 'Tester', has_accepted_cgu: true, ai_agents_enabled: true }));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test');
    });
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (path === '/watches/') return route.fulfill({ json: { results: [], next_offset: null } });
        if (path === '/framework/agents/') return route.fulfill({ json: agents });
        if (path === '/messaging/conversations/agents/') return route.fulfill({ json: conversations });
        if (path === '/messaging/conversations/agents/create/') {
            creates.push(route.request().postDataJSON());
            return route.fulfill({ status: failCreate ? 403 : 201, json: failCreate ? { detail: 'Indisponible' } : { uuid: 'new-conversation', created_at: '2026-10-24', agent: agents[0] } });
        }
        if (path.includes('/messages/')) {
            const id = path.split('/')[3];
            const first = url.searchParams.get('ordering') === 'created_at';
            return route.fulfill({ json: { results: [
                { uuid: `${id}-ai`, content: 'Réponse IA à ne pas afficher', is_ai_generated: true, created_at: first ? '2026-10-01' : '2026-10-25' },
                { uuid: `${id}-human`, content: first ? `Projet ${id}` : `Dernier prompt ${id}`, is_ai_generated: false, created_at: '2026-10-23' },
            ], next: null } });
        }
        return route.fulfill({ json: [] });
    });
    await page.goto('/');
    await page.getByTitle('Jarvis', { exact: true }).click();
    return creates;
}

test('collection groups by agent, uses human prompts, and restores the selected card on return', async ({ page }, testInfo) => {
    await setup(page);
    await expect(page.locator('.agent-wallet .identity-card')).toHaveCount(4);
    await expect(page.getByText('Ma collection', { exact: true })).toHaveCount(0);
    await expect(page.locator('.agent-wallet__dock')).toHaveCount(0);
    await expect(page.locator('.identity-card__brand')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sélectionner Atelier', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Dernier prompt atelier-recent', { exact: true })).toBeVisible();
    await expect(page.locator('.agent-history__row')).toHaveCount(2);
    await expect(page.locator('.agent-history')).not.toContainText('Réponse IA');
    await page.screenshot({ path: testInfo.outputPath('collection-desktop.png') });
    await page.getByRole('button', { name: 'Sélectionner Voyages', exact: true }).click();
    await expect(page.locator('.agent-history__row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Ouvrir la conversation : Projet voyages-conv', exact: true }).click();
    await expect(page.locator('.conversation-thread')).toBeVisible();
    const panel = page.locator('.agent-history-panel');
    await expect(page.locator('.sidebar__green-body')).toHaveCSS('width', '194px');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.agent-history__row')).toHaveCount(1);
    await expect(panel).toContainText('Dernier prompt voyages-conv');
    await expect(panel.locator('.conv-square')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('agent-history-sidebar.png') });
    await page.getByRole('button', { name: 'Retour aux conversations', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sélectionner Voyages', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sidebar__panel--open')).toHaveCount(0);
});

test('new conversation creates a separate session with the selected agent', async ({ page }) => {
    const creates = await setup(page);
    await page.getByRole('button', { name: 'Sélectionner Voyages', exact: true }).click();
    await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
    await expect(page.locator('.conversation-thread')).toBeVisible();
    expect(creates).toEqual([{ agent_uuid: 'voyages' }]);
    await expect(page.locator('.thread-header-name')).toHaveText('Voyages');
});

test('failed creation keeps the collection open with an actionable error', async ({ page }) => {
    await setup(page, false, true);
    await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Impossible de créer');
    await expect(page.getByRole('button', { name: 'Nouvelle conversation', exact: true })).toBeEnabled();
    await expect(page.locator('.conversation-thread')).toHaveCount(0);
});

test('mobile wallet scrolls without widening the page and respects reduced motion', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    await expect(page.getByText('Dernier prompt atelier-recent', { exact: true })).toBeVisible();
    const wallet = page.locator('.agent-wallet');
    await expect(wallet).toHaveCSS('scrollbar-width', 'none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('collection-mobile.png') });
    await page.getByRole('button', { name: 'Sélectionner Musique', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Historique de Musique' })).toBeVisible();
    await expect(page.locator('.agent-history')).toHaveCSS('animation-name', 'none');
});

test('empty collection offers agent selection', async ({ page }) => {
    const creates = await setup(page, true);
    await expect(page.getByText('Ta collection commence ici')).toBeVisible();
    await page.getByRole('button', { name: 'Choisir un agent', exact: true }).click();
    await expect(page.locator('.add-page')).toBeVisible();
    await page.locator('.add-page__agent-row').filter({ hasText: 'Atelier' }).click();
    await expect(page.locator('.conversation-thread')).toBeVisible();
    expect(creates).toEqual([{ agent_uuid: 'atelier' }]);
});

 test('sidebar switches between the selected agent sessions and highlights the active one', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'Ouvrir la conversation : Projet atelier-recent', exact: true }).click();
    const panel = page.locator('.agent-history-panel');
    await expect(panel.locator('.agent-history__row')).toHaveCount(2);
    await panel.getByRole('button', { name: 'Ouvrir la conversation : Projet atelier-old', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Ouvrir la conversation : Projet atelier-old', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(panel).not.toContainText('voyages-conv');
 });


test('adding an agent keeps the sidebar closed', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'Ajouter un agent à ma collection' }).click();
    await expect(page.locator('.sidebar__panel--open')).toHaveCount(0);
    await expect(page.locator('.agent-collection')).toHaveCount(0);
});
