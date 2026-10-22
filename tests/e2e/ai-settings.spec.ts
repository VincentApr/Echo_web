import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, options: { failSave?: boolean; legacy?: boolean; failLoad?: boolean } = {}) {
    const user = { uuid: 'settings-owner', username: 'Tester', email: 'test@example.test', has_accepted_cgu: true, ai_agents_enabled: true, ai_policy_version: options.legacy ? 0 : 1 };
    const permissions = { 'messages.conversations': true, 'messages.read': true, 'messages.send': true, 'messages.mark_read': true,
        'groups.read': true, 'groups.create': true, 'groups.update': true, 'groups.members': true, 'groups.moderate': true, 'groups.delete': true,
        'calendar.read': true, 'calendar.create': true, 'calendar.update': true, 'calendar.delete': true,
        'agents.read': true, 'agents.create': true, 'agents.update': true, 'agents.delete': true };
    let instance = { is_active: true, default_language: 'fr', permission_schema_version: 1, permissions };
    const patches: Record<string, unknown>[] = [];
    const aiRequests: string[] = [];
    await page.addInitScript(user => {
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
        localStorage.setItem('refreshToken', 'test-refresh');
    }, user);
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/watches/') return route.fulfill({ json: { results: [], count: 0, next_offset: null, checked_at: new Date().toISOString() } });
        if (path === '/jarvis/instance/') {
            if (options.failLoad) return route.fulfill({ status: 503, json: {} });
            if (route.request().method() === 'PATCH') {
                const patch = route.request().postDataJSON(); patches.push(patch);
                if (options.failSave) return route.fulfill({ status: 503, json: {} });
                instance = { ...instance, ...patch, permissions: { ...instance.permissions, ...patch.permissions } };
            }
            return route.fulfill({ json: options.legacy ? { is_active: true, default_language: 'fr' } : instance });
        }
        if (path === '/api/auth/profile/' && route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON(); patches.push(patch);
            if (options.failSave) return route.fulfill({ status: 503, json: {} });
            Object.assign(user, patch);
            return route.fulfill({ json: user });
        }
        if (path.includes('/trigger/') || path === '/jarvis/chat/' || path === '/jarvis/vocal/') aiRequests.push(path);
        return route.fulfill({ json: [] });
    });
    await page.goto('/');
    await page.getByTitle('Tester', { exact: true }).click();
    await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
    await page.getByRole('button', { name: 'Modération', exact: true }).click();
    await page.getByText('Fonctionnalités IA', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Désactiver toute présence d’IA' })).toBeVisible();
    return { patches, aiRequests };
}

test('granular permissions save only the changed action and persist on reopen', async ({ page }) => {
    const fixture = await setup(page);
    await page.locator('summary').filter({ hasText: 'Messages' }).click();
    const read = page.getByRole('switch', { name: 'Lire les messages', exact: true });
    await expect(read).toBeChecked();
    await read.click();
    await expect(page.getByRole('status')).toHaveText('Paramètres sauvegardés');
    await expect(read).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Envoyer des messages' })).toBeChecked();
    expect(fixture.patches).toEqual([{ permissions: { 'messages.read': false } }]);
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
    await page.getByRole('button', { name: 'Modération', exact: true }).click();
    await page.getByText('Fonctionnalités IA', { exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Messages' }).click();
    await expect(read).not.toBeChecked();
});

test('global opt-out hides AI entry points and keeps granular choices after reactivation', async ({ page }) => {
    const fixture = await setup(page);
    await page.locator('summary').filter({ hasText: 'Messages' }).click();
    const read = page.getByRole('switch', { name: 'Lire les messages', exact: true });
    await read.click();
    await expect(page.getByRole('status')).toHaveText('Paramètres sauvegardés');
    await page.getByRole('button', { name: 'Désactiver toute présence d’IA' }).click();
    await expect(page.getByRole('heading', { name: 'Echo sans IA' })).toBeVisible();
    await expect(read).toBeDisabled();
    await expect(page.getByTitle('Jarvis', { exact: true })).toHaveCount(0);
    await expect(page.getByTitle('Catalogue', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    await page.getByTitle('Accueil', { exact: true }).click();
    await expect(page.locator('.home-page__suggestions')).toHaveCount(0);
    await expect(page.locator('.web-bottom-bar')).toHaveCount(0);
    expect(fixture.aiRequests).toEqual([]);
    await page.getByTitle('Tester', { exact: true }).click();
    await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
    await page.getByRole('button', { name: 'Modération', exact: true }).click();
    await page.getByText('Fonctionnalités IA', { exact: true }).click();
    await page.getByRole('button', { name: 'Réactiver les fonctionnalités IA' }).click();
    await expect(page.getByTitle('Jarvis', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'Messages' }).click();
    await expect(read).not.toBeChecked();
    await expect(read).toBeEnabled();
    expect(fixture.patches.slice(-2)).toEqual([{ ai_agents_enabled: false }, { ai_agents_enabled: true }]);
});

test('failed saves restore the previous permission and global setting', async ({ page }) => {
    await setup(page, { failSave: true });
    await page.locator('summary').filter({ hasText: 'Messages' }).click();
    const read = page.getByRole('switch', { name: 'Lire les messages', exact: true });
    await read.click();
    await expect(page.getByRole('alert')).toContainText('Sauvegarde impossible');
    await expect(read).toBeChecked();
    await page.getByRole('button', { name: 'Désactiver toute présence d’IA' }).click();
    await expect(page.getByRole('alert')).toContainText('Modification impossible');
    await expect(page.getByTitle('Jarvis', { exact: true })).toBeVisible();
});

test('legacy servers never expose unsupported permissions as working controls', async ({ page }) => {
    await setup(page, { legacy: true });
    await expect(page.getByText('Les autorisations détaillées nécessitent la mise à jour du serveur.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Désactiver toute présence d’IA' })).toBeDisabled();
    await page.locator('summary').filter({ hasText: 'Messages' }).click();
    await expect(page.getByRole('switch', { name: 'Lire les messages', exact: true })).toBeDisabled();
});

test('global opt-out stays available when Jarvis settings cannot load', async ({ page }) => {
    await setup(page, { failLoad: true });
    await expect(page.getByText('Impossible de charger les paramètres Jarvis.')).toBeVisible();
    await page.getByRole('button', { name: 'Désactiver toute présence d’IA' }).click();
    await expect(page.getByRole('heading', { name: 'Echo sans IA' })).toBeVisible();
});
