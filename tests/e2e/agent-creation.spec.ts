import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, lostFavoriteResponse = false) {
    const agents: Record<string, unknown>[] = [];
    const creations: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    let favoriteCalls = 0;
    const tools = [{ uuid: 'calendar-tool', display_name: 'Calendrier', description: 'Lire les rendez-vous.' }];
    await page.addInitScript(() => {
        localStorage.setItem('user', JSON.stringify({ uuid: 'test-owner', username: 'Tester', has_accepted_cgu: true, ai_agents_enabled: true }));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test-refresh');
    });
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/tools/') return route.fulfill({ json: tools });
        if (path === '/watches/') return route.fulfill({ json: { results: [], count: 0, next_offset: null, checked_at: new Date().toISOString() } });
        if (path === '/framework/agents/tools/' && request.method() === 'POST') {
            const body = request.postDataJSON();
            creations.push(body);
            const agent = { ...body, tools: tools.filter(tool => body.tool_uuids?.includes(tool.uuid)), agent_type: 'ToolAgent', uuid: `agent-${agents.length}`, is_mine: true, is_favorite: false, is_public: body.visibility === 'public' };
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
                Object.assign(agents[0], patch, { is_public: (patch.visibility ?? agents[0].visibility) === 'public', ...(patch.tool_uuids ? { tools: tools.filter(tool => patch.tool_uuids.includes(tool.uuid)) } : {}) });
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
    await page.getByRole('button', { name: 'Modifier le nom' }).click();
    await page.getByLabel('Nom de l’agent').fill('Mon assistant');
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await page.getByRole('button', { name: /^Instructions/ }).click();
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
    await expect(page.locator('.identity-card--compact').getByRole('img', { name: 'Favori' })).toBeVisible();
    await expect(page.locator('.identity-card--compact .identity-card__visibility')).toHaveText('Privé');
});

test('visibility is edited through the shared three-option switch and only saved on confirmation', async ({ page }) => {
    const fixture = await setup(page);
    const visibility = page.getByRole('group', { name: 'Visibilité', exact: true });
    await visibility.getByRole('button', { name: 'Amis', exact: true }).click();
    await page.getByRole('button', { name: 'Créer mon agent' }).click();
    await expect(page.getByText('« Mon assistant » a été créé et ajouté aux favoris.')).toBeVisible();
    expect(fixture.creations[0].visibility).toBe('friends');
    await page.getByRole('button', { name: 'Mes Agents', exact: true }).click();
    await expect(page.locator('.identity-card--compact .identity-card__visibility')).toHaveText('Amis uniquement');
    await page.getByRole('heading', { name: 'Mon assistant' }).click();
    await expect(page.getByText('Visibilité : Amis uniquement')).toBeVisible();
    await expect(page.getByRole('button', { name: /Rendre privé|Rendre public|Partager avec mes amis/ })).toHaveCount(0);
    await expect(visibility).toHaveCount(0);
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(visibility.getByRole('button', { name: 'Amis', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await visibility.getByRole('button', { name: 'Public', exact: true }).click();
    expect(fixture.updates).toHaveLength(0);
    await page.getByRole('button', { name: 'Quitter la modification' }).click();
    await expect(page.getByText('Visibilité : Amis uniquement')).toBeVisible();
    expect(fixture.updates).toHaveLength(0);
    for (const [label, value] of [['Public', 'public'], ['Privé', 'private']] as const) {
        await page.getByRole('button', { name: 'Modifier', exact: true }).click();
        await visibility.getByRole('button', { name: label, exact: true }).click();
        await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
        await expect(page.getByText(`Visibilité : ${label}`)).toBeVisible();
        expect(fixture.updates.at(-1)?.visibility).toBe(value);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.identity-card--compact .identity-card__visibility')).toHaveText('Privé');
    await page.getByRole('button', { name: 'Découvrir', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mon assistant' })).toHaveCount(0);
});

test('a new public agent appears in discovery', async ({ page }) => {
    const fixture = await setup(page);
    await page.getByRole('group', { name: 'Visibilité', exact: true }).getByRole('button', { name: 'Public', exact: true }).click();
    await page.getByRole('button', { name: 'Créer mon agent' }).click();
    await expect(page.getByText('« Mon assistant » a été créé et ajouté aux favoris.')).toBeVisible();
    expect(fixture.creations[0].visibility).toBe('public');
    await page.getByRole('button', { name: 'Découvrir', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Voir la carte de Mon assistant' })).toBeVisible();
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

test('portrait prompt, reference documents and selected tools survive creation and editing', async ({ page }) => {
    const fixture = await setup(page);
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await page.getByRole('button', { name: 'Modifier le portrait' }).click();
    await page.getByLabel('Prompt du portrait').fill('Un renard en aquarelle.');
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await page.getByRole('button', { name: /^Contexte/ }).click();
    await page.getByRole('textbox', { name: 'Documentation', exact: true }).fill('Priorité au guide interne.');
    await page.locator('input[type=file]').setInputFiles({ name: 'guide.md', mimeType: 'text/markdown', buffer: Buffer.from('Préparer le lancement.') });
    await expect(page.getByRole('button', { name: 'Retirer guide.md' })).toBeVisible();
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await page.getByRole('button', { name: /^Outils/ }).click();
    await page.getByRole('checkbox', { name: 'Calendrier', exact: true }).check();
    await expect(page.locator('.identity-panel')).not.toContainText('Lire les rendez-vous.');
    await page.getByRole('button', { name: 'Créer mon agent' }).click();
    await expect(page.getByText('« Mon assistant » a été créé et ajouté aux favoris.')).toBeVisible();
    expect(fixture.creations[0]).toMatchObject({ avatar_prompt: 'Un renard en aquarelle.', tool_uuids: ['calendar-tool'], identity_context: { text: 'Priorité au guide interne.', documents: [{ name: 'guide.md', content: 'Préparer le lancement.' }] } });
    expect(fixture.creations[0].system_prompt).toContain('Préparer le lancement.');
    await page.getByRole('button', { name: 'Mes Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Voir la carte de Mon assistant' }).click();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await page.getByRole('button', { name: 'Modifier le portrait' }).click();
    await expect(page.getByLabel('Prompt du portrait')).toHaveValue('Un renard en aquarelle.');
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await page.getByRole('button', { name: /^Contexte/ }).click();
    await expect(page.getByRole('textbox', { name: 'Documentation', exact: true })).toHaveValue('Priorité au guide interne.');
    await page.getByRole('button', { name: 'Retirer guide.md' }).click();
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await page.getByRole('button', { name: /^Outils/ }).click();
    await expect(page.getByRole('checkbox', { name: /Calendrier/ })).toBeChecked();
    await page.getByRole('checkbox', { name: /Calendrier/ }).uncheck();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible();
    expect(fixture.updates[0]).toMatchObject({ tool_uuids: [], identity_context: { text: 'Priorité au guide interne.', documents: [] } });
    expect(fixture.updates[0].system_prompt).not.toContain('Préparer le lancement.');
});

test('mobile editing keeps the card fixed and restores focus when closing the panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    const card = page.locator('.identity-card--full');
    const before = (await card.boundingBox())!;
    const panel = page.locator('.identity-panel');
    const bounds = (await panel.boundingBox())!;
    expect(bounds.height).toBe(before.height);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await expect(page.locator('.identity-card-perspective')).toHaveAttribute('inert', '');
    await page.screenshot({ path: test.info().outputPath('creation-mobile-panel.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await expect(page.getByRole('button', { name: /^Instructions/ })).toBeFocused();
    await expect(page.locator('.identity-card-perspective')).not.toHaveAttribute('inert');
    await page.screenshot({ path: test.info().outputPath('creation-mobile.png'), animations: 'disabled' });
});
