import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem('user', JSON.stringify({ uuid: 'grid-owner', username: 'Tester', has_accepted_cgu: true, ai_agents_enabled: true }));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test');
        localStorage.setItem('echo:sidebar-panel-width', '224');
    });
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/watches/') return route.fulfill({ json: { results: [], next_offset: null } });
        if (path === '/messaging/conversations/private/') return route.fulfill({ json: [{ uuid: 'private-grid', conversation_type: 'direct', other_participant: { username: 'Alice' }, unread_count: 2 }] });
        if (path === '/messaging/conversations/groups/') return route.fulfill({ json: [{ uuid: 'group-grid', conversation_type: 'group', group_info: { uuid: 'group', name: 'Équipe' }, unread_count: 0 }] });
        if (path === '/messaging/conversations/agents/') return route.fulfill({ json: [{ uuid: 'agent-grid', conversation_type: 'agent', framework_agent: { uuid: 'agent', name: 'Atelier' }, unread_count: 0 }] });
        if (path.includes('/messages/')) return route.fulfill({ json: { results: [], next: null } });
        return route.fulfill({ json: [] });
    });
    await page.goto('/');
}

for (const tab of [
    { label: 'Conversations', name: 'Alice', add: 'Nouvelle conversation' },
    { label: 'Groupes', name: 'Équipe', add: 'Nouveau groupe' },
]) {
    test(`${tab.label}: first visit is a grid, returning closes the sidebar`, async ({ page }, testInfo) => {
        await setup(page);
        await page.getByTitle(tab.label, { exact: true }).click();
        await expect(page.locator('.sidebar__panel--open')).toHaveCount(0);
        const grid = page.locator('.conversations-home .watch-grid');
        await expect(grid.getByRole('button', { name: `Ouvrir ${tab.name}` })).toBeVisible();
        await expect(grid.locator('button').last()).toHaveAttribute('aria-label', tab.add);
        const tile = grid.getByRole('button', { name: `Ouvrir ${tab.name}` });
        const tileBox = (await tile.boundingBox())!;
        const nameBox = (await tile.locator('.conv-square__name-badge').boundingBox())!;
        expect(nameBox.y).toBeGreaterThanOrEqual(tileBox.y + tileBox.height);
        await page.screenshot({ path: testInfo.outputPath('conversation-grid.png') });
        await grid.getByRole('button', { name: `Ouvrir ${tab.name}` }).click();
        await expect(page.locator('.sidebar__panel--open')).toHaveCount(1);
        await expect(page.locator('.conversation-thread')).toBeVisible();
        await page.getByRole('button', { name: 'Retour aux conversations', exact: true }).click();
        await expect(grid).toBeVisible();
        await expect(page.locator('.sidebar__panel--open')).toHaveCount(0);
        await grid.getByRole('button', { name: tab.add, exact: true }).click();
        await expect(grid).toHaveCount(0);
        await expect(page.locator('.sidebar__panel--open')).toHaveCount(1);
    });
}

test('dragging past one column closes the panel without leaving the thread', async ({ page }) => {
    await setup(page);
    await page.getByTitle('Conversations', { exact: true }).click();
    await page.getByRole('button', { name: 'Ouvrir Alice' }).click();
    await expect(page.locator('.sidebar__green-body')).toHaveCSS('width', '284px');
    const handle = page.getByLabel('Redimensionner la barre latérale');
    let box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 90, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.sidebar__green-body')).toHaveCSS('width', '194px');
    box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(65, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.sidebar__panel--open')).toHaveCount(0);
    await expect(page.locator('.sidebar__green-body')).toHaveCSS('width', '60px');
    await expect(page.locator('.conversation-thread')).toBeVisible();
    box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 134, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.sidebar__green-body')).toHaveCSS('width', '194px');
    await expect(page.locator('.conversation-thread')).toBeVisible();
    await page.getByRole('button', { name: 'Retour aux conversations', exact: true }).click();
    await expect(page.locator('.sidebar__panel--open')).toHaveCount(0);
    await page.getByRole('button', { name: 'Ouvrir Alice' }).click();
    await expect(page.locator('.sidebar__green-body')).toHaveCSS('width', '194px');
});
