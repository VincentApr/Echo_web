import { expect, test, type Page } from '@playwright/test';

const instructions = 'Tu aides à organiser les projets. Explique tes recommandations et distingue les faits des hypothèses.\n'.repeat(35);
const documentation = '\n\nDOCUMENTATION DE RÉFÉRENCE\nUtilise prioritairement les informations suivantes. Si elles ne suffisent pas, indique-le clairement.\n\nDOCUMENT : guide-projet.md\nLe lancement est prévu en septembre.\n\n---\n\nDOCUMENT : équipe.txt\nCamille coordonne le projet.';
const portrait = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#87b9ae"/><circle cx="80" cy="66" r="36" fill="#e6efe3"/><ellipse cx="80" cy="153" rx="65" ry="48" fill="#e6efe3"/></svg>')}`;

async function setup(page: Page, failDetail = false) {
    const agents = [
        { uuid: 'agent-atelier', name: 'Atelier', description: 'Des idées claires, des projets qui avancent. Votre partenaire du premier croquis au dernier détail.', avatar: portrait, visibility: 'public', is_mine: true, is_favorite: false, agent_type: 'ToolAgent' },
        { uuid: 'agent-horizon', name: 'Horizon', description: 'Imaginez votre prochain voyage, à votre rythme.', visibility: 'public', is_mine: false },
        { uuid: 'agent-plume', name: 'Plume', description: 'Les mots justes pour donner vie à vos idées.', visibility: 'public', is_mine: false },
    ];
    const details = { ...agents[0], system_prompt: instructions + documentation, tools: [{ uuid: 'tool-calendar', display_name: 'Calendrier', description: 'Consulter les rendez-vous du calendrier connecté.' }, { uuid: 'tool-search', display_name: 'Recherche', description: 'Trouver les informations utiles au projet.' }] };
    const updates: Record<string, unknown>[] = [];
    let detailUnavailable = failDetail;
    await page.addInitScript(() => {
        localStorage.setItem('user', JSON.stringify({ uuid: 'test-owner', username: 'Tester', has_accepted_cgu: true, ai_agents_enabled: true }));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test-refresh');
    });
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/watches/') return route.fulfill({ json: { results: [], count: 0, next_offset: null } });
        if (path === '/framework/agents/public/') return route.fulfill({ json: agents });
        if (path === '/framework/agents/') return route.fulfill({ json: { created_agents: [agents[0]], favorite_agents: [] } });
        if (path === '/framework/agents/agent-atelier/') {
            if (detailUnavailable) return route.fulfill({ status: 503, json: { detail: 'La fiche est temporairement indisponible.' } });
            if (request.method() === 'PATCH') { const patch = request.postDataJSON(); updates.push(patch); Object.assign(details, patch); }
            return route.fulfill({ json: details });
        }
        return route.fulfill({ json: [] });
    });
    await page.goto('/');
    await page.getByTitle('Catalogue', { exact: true }).click();
    return { updates, recover: () => { detailUnavailable = false; } };
}

async function openCard(page: Page) {
    await page.getByRole('button', { name: 'Voir la carte de Atelier' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: /^Instructions/ })).toBeEnabled();
}

test('the card stays fixed while a matching-height side panel scrolls all details', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setup(page);
    await expect(page.locator('.identity-card--compact img').first()).toHaveAttribute('src', portrait);
    await page.screenshot({ path: test.info().outputPath('catalogue.png'), animations: 'disabled' });
    await openCard(page);
    const card = page.locator('.identity-card--full');
    const before = await card.boundingBox();
    const instructionsButton = page.getByRole('dialog').getByRole('button', { name: /^Instructions/ });
    await instructionsButton.click();
    const panel = page.locator('.identity-dialog .identity-panel');
    await expect(panel).toBeVisible();
    const after = await card.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect(panelBox?.height).toBe(after?.height);
    expect(panelBox!.x).toBeGreaterThan(after!.x + after!.width);
    expect(panelBox!.y).toBe(after!.y);
    const content = panel.getByRole('region');
    expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await card.evaluate(element => element.scrollTop)).toBe(0);
    await page.getByRole('dialog').getByRole('button', { name: /^Contexte/ }).click();
    await expect(panel).toContainText('guide-projet.md');
    await expect(panel).toContainText('Camille coordonne le projet.');
    await page.screenshot({ path: test.info().outputPath('badge-desktop.png'), animations: 'disabled' });
    await page.getByRole('dialog').getByRole('button', { name: /^Outils/ }).click();
    await expect(panel).toContainText('Consulter les rendez-vous');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: /^Outils/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Voir la carte de Atelier' })).toBeFocused();
});

test('editing uses the fetched instructions and preserves existing reference documents', async ({ page }) => {
    const fixture = await setup(page);
    await openCard(page);
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(page.getByLabel('Instructions système')).toHaveValue(instructions + documentation);
    await page.getByLabel('Nom', { exact: true }).fill('Atelier personnel');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Atelier personnel' })).toBeVisible();
    expect(fixture.updates[0].system_prompt).toBe((instructions + documentation).trim());
});

test('small screens show the scrollable panel over the card without resizing it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    await openCard(page);
    const before = await page.locator('.identity-card--full').boundingBox();
    await page.getByRole('dialog').getByRole('button', { name: /^Instructions/ }).click();
    const panel = page.locator('.identity-dialog .identity-panel');
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.height).toBe(before!.height);
    expect((await page.locator('.identity-card--full').boundingBox())!.height).toBe(before!.height);
    await page.screenshot({ path: test.info().outputPath('badge-mobile-panel.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Fermer la rubrique' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /^Instructions/ })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath('badge-mobile.png'), animations: 'disabled' });
});

test('failed details cannot overwrite instructions and can be retried', async ({ page }) => {
    const fixture = await setup(page, true);
    await page.getByRole('button', { name: 'Voir la carte de Atelier' }).click();
    await expect(page.getByRole('alert')).toContainText('La fiche est temporairement indisponible.');
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeDisabled();
    fixture.recover();
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeEnabled();
    await page.getByRole('dialog').getByRole('button', { name: /^Instructions/ }).click();
    await expect(page.locator('.identity-panel')).toContainText('distingue les faits des hypothèses');
});

test('creator preview displays separate documents without expanding the card', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByLabel('Nom de l’agent').fill('Mon studio');
    await page.getByLabel('Description', { exact: true }).fill('Un partenaire pour écrire.');
    await page.getByLabel('Instructions système').fill('Réponds en français.');
    await page.getByLabel('Documentation', { exact: true }).fill('Guide de style : phrases courtes.');
    await page.locator('input[type=file]').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('Contenu du document de référence.') });
    const preview = page.getByRole('region', { name: 'Aperçu de la carte' });
    await expect(preview.getByRole('heading', { name: 'Mon studio' })).toBeVisible();
    const before = await preview.locator('.identity-card--full').boundingBox();
    await preview.getByRole('button', { name: /^Contexte/ }).click();
    await expect(preview.locator('.identity-panel')).toContainText('notes.md');
    await expect(preview.locator('.identity-panel')).toContainText('Contenu du document de référence.');
    expect((await preview.locator('.identity-card--full').boundingBox())!.height).toBe(before!.height);
});

test('drag tilts the card and releasing returns it to flat', async ({ page }) => {
    await setup(page);
    await openCard(page);
    const card = page.locator('.identity-card--full');
    const bounds = (await card.boundingBox())!;
    await page.mouse.move(bounds.x + 100, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 150, bounds.y + 125, { steps: 5 });
    expect(await card.evaluate(element => (element as HTMLElement).style.getPropertyValue('--identity-ry'))).not.toBe('');
    await page.mouse.up();
    await expect(card).not.toHaveAttribute('data-dragging');
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(bounds.x + 100, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 150, bounds.y + 125);
    await expect(card).not.toHaveAttribute('data-dragging');
    await page.mouse.up();
});
