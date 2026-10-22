import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, lostFavoriteResponse = false) {
    const agents: Record<string, unknown>[] = [];
    const creations: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    let favoriteCalls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('user', JSON.stringify({ uuid: 'test-owner', username: 'Tester', has_accepted_cgu: true, ai_agents_enabled: true }));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test-refresh');
    });
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/watches/') return route.fulfill({ json: { results: [], count: 0, next_offset: null, checked_at: new Date().toISOString() } });
        if (path === '/framework/agents/mistral/' && request.method() === 'POST') {
            const body = request.postDataJSON();
            creations.push(body);
            const agent = { ...body, uuid: `agent-${agents.length}`, is_mine: true, is_favorite: false, is_public: body.visibility !== 'private' };
            agents.push(agent);
            return route.fulfill({ status: 201, json: agent });
        }
        if (path.endsWith('/favorite/')) {
            favoriteCalls++;
            agents[0].is_favorite = !agents[0].is_favorite;
            if (lostFavoriteResponse && favoriteCalls === 1) return route.abort();
            return route.fulfill({ json: { is_favorite: agents[0].is_favorite } });
        }
        if (path === '/framework/agents/agent-0/') {
            if (request.method() === 'PATCH') {
                const patch = request.postDataJSON();
                updates.push(patch);
                Object.assign(agents[0], patch, { is_public: patch.visibility !== 'private' });
            }
            return route.fulfill({ json: agents[0] });
        }
        if (path === '/framework/agents/') return route.fulfill({ json: { created_agents: agents, favorite_agents: agents.filter(a => a.is_favorite) } });
        if (path === '/framework/agents/public/') return route.fulfill({ json: agents });
        return route.fulfill({ json: [] });
    });
    await page.goto('/');
    await page.getByTitle('Catalogue', { exact: true }).click();
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByLabel('Nom de l’agent').fill('Mon assistant');
    await page.getByLabel('Instructions système').fill('Tu aides à organiser des projets.');
    return { creations, updates, favoriteCalls: () => favoriteCalls };
}

test('creation defaults to private and adds the agent to favorites', async ({ page }) => {
    const fixture = await setup(page);
    await expect(page.getByRole('button', { name: /Marketplace/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Créer mon agent' }).click();
    await expect(page.getByText('« Mon assistant » a été créé et ajouté aux favoris.')).toBeVisible();
    expect(fixture.creations).toHaveLength(1);
    expect(fixture.creations[0].visibility).toBe('private');
    expect(fixture.creations[0]).not.toHaveProperty('is_public');
    expect(fixture.favoriteCalls()).toBe(1);
    await page.getByRole('button', { name: 'Mes Agents', exact: true }).click();
    await expect(page.locator('.agent-card__favorite')).toHaveText('Favori');
    await expect(page.locator('.agent-card__visibility')).toHaveText('Privé');
});

test('friends sharing has accurate labels and can be changed without public publishing', async ({ page }) => {
    const fixture = await setup(page);
    await page.getByRole('button', { name: /Amis uniquement/ }).click();
    await page.getByRole('button', { name: 'Créer mon agent' }).click();
    await expect(page.getByText('« Mon assistant » a été créé et ajouté aux favoris.')).toBeVisible();
    expect(fixture.creations[0].visibility).toBe('friends');
    await page.getByRole('button', { name: 'Mes Agents', exact: true }).click();
    await expect(page.locator('.agent-card__visibility')).toHaveText('Amis uniquement');
    await page.getByRole('heading', { name: 'Mon assistant' }).click();
    await expect(page.getByText('Visibilité : Amis uniquement')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rendre public' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Rendre privé' }).click();
    await expect(page.getByText('Visibilité : Privé')).toBeVisible();
    await page.getByRole('button', { name: 'Partager avec mes amis' }).click();
    await expect(page.getByText('Visibilité : Amis uniquement')).toBeVisible();
    expect(fixture.updates).toEqual([{ visibility: 'private' }, { visibility: 'friends' }]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Découvrir', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mon assistant' })).toHaveCount(0);
});

test('retry after a lost favorite response neither recreates nor unfavorites the agent', async ({ page }) => {
    const fixture = await setup(page, true);
    await page.getByRole('button', { name: 'Créer mon agent' }).click();
    const retry = page.getByRole('button', { name: /Réessayer l’ajout/ });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(page.getByText('« Mon assistant » a été ajouté aux favoris.')).toBeVisible();
    expect(fixture.creations).toHaveLength(1);
    expect(fixture.favoriteCalls()).toBe(1);
});
