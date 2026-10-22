import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { WatchItem } from '../../src/services/watches';

test.use({ viewport: { width: 1440, height: 1000 }, screen: { width: 1440, height: 1000 } });

const owner = '11111111-1111-4111-8111-111111111111';
const friendId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const groupId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const emailId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const echoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const calendarId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const topicId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const agentId = '99999999-9999-4999-8999-999999999999';
const agentThreadId = '88888888-8888-4888-8888-888888888888';
const watchDraft = 'Aide-moi à préparer ma réponse.\n\nContexte de la veille : votre candidature est retenue et un entretien est prévu demain.';
async function setup(page: Page, failAction = false, generated = false, grouped = false, recommended = false, album = false, failImage = false) {
    const actions: string[] = [];
    const scans: string[] = [];
    const targets: string[] = [];
    const items: WatchItem[] = [
        { uuid: friendId, kind: 'friend_request' as const, title: 'Lucas souhaite vous ajouter', summary: 'Lucas vous a envoyé une demande d’ami.', payload: { actor: 'Lucas', message: 'On garde le contact ?', source_label: 'Demande d’ami Echo' } },
        { uuid: groupId, kind: 'group_invitation' as const, title: 'Rejoignez Randonnées', summary: 'Léa vous invite à rejoindre le groupe « Randonnées ».', payload: { actor: 'Léa', group_name: 'Randonnées', message: 'Tu viens avec nous ?', source_label: 'Invitation de groupe Echo' } },
    ].map(item => ({ ...item, source_status: 'pending', result: '', seen_at: null as string | null, handled_at: null as string | null, snoozed_until: null as string | null, source_created_at: new Date().toISOString(), updated_at: new Date().toISOString(), actions: [{id:'accept' as const, label:item.kind === 'friend_request' ? 'Accepter la demande' : 'Rejoindre le groupe'}, {id:'decline' as const, label:'Refuser'}] }));
    if (generated) items.push(
        {...items[0], uuid:emailId, kind:'email_thread', title:'Une réponse pour votre stage', summary:'Votre candidature est retenue. Un entretien vous est proposé mardi.', payload:{actor:'Recrutement',source_label:'Gmail'}, actions:[{id:'open_source',label:'Consulter le mail'},{id:'dismiss',label:'Masquer'}]},
        {...items[0], uuid:echoId, kind:'echo_conversation', title:'Organiser la sortie', summary:'Lucas attend votre choix de créneau.', payload:{actor:'Lucas',source_label:'Conversation Echo'}, actions:[{id:'open_source',label:'Ouvrir la conversation'},{id:'dismiss',label:'Masquer'}]},
    );
    if (album) for (const item of items.filter(item => !['friend_request','group_invitation'].includes(item.kind))) {
        item.artwork_version = 'album-version';
        item.cover = {layout:'album_v1', title:item.title, subtitle:'Votre veille'};
    }
    if (grouped) {
        const index = items.findIndex(item=>item.uuid===emailId);
        items[index] = {...items[index],uuid:topicId,kind:'topic',title:'Votre candidature de stage',
            summary:'Votre candidature est retenue. Un entretien est prévu demain : consultez le mail et préparez votre présentation.',
            payload:{source_label:'Gmail · Agenda'},actions:[
                {id:'open_source',label:'Consulter le mail',source_uuid:emailId},
                {id:'open_source',label:'Voir l’événement',source_uuid:calendarId},
                {id:'dismiss',label:'Masquer'}]};
    }
    if (recommended) items.find(item => item.uuid === topicId)!.actions.splice(2, 0,
        {id:'discuss_agent',label:'Discuter avec Recherche de stage',agent_uuid:agentId});
    await page.addInitScript(owner => {
        localStorage.setItem('user', JSON.stringify({uuid:owner, username:'Tester', has_accepted_cgu:true, ai_agents_enabled:true}));
        localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({exp:Date.now()/1000+3600}))}.signature`);
        localStorage.setItem('refreshToken', 'test-refresh');
        localStorage.setItem(`echo:pinned-conversations:${owner}`, JSON.stringify(['pinned']));
    }, owner);
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//, async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/watches/refresh/') { scans.push(route.request().method()); return route.fulfill({status:202,json:{status:'queued'}}); }
        if (path === '/watches/') {
            const history = new URL(route.request().url()).searchParams.get('scope') === 'history';
            return route.fulfill({ json: { results: items.filter(item => history ? item.handled_at : !item.handled_at && !item.snoozed_until), count:2, next_offset:null, checked_at:new Date().toISOString() } });
        }
        if (path.endsWith('/artwork/')) {
            if (failImage) return route.fulfill({status:503,json:{detail:'Indisponible'}});
            return route.fulfill({contentType:'image/webp',body:readFileSync('public/watch-covers/friend.webp')});
        }
        if (path.startsWith('/watches/')) {
            const item = items.find(item => path.includes(item.uuid));
            if (!item) return route.fulfill({status:404,json:{}});
            if (route.request().method() === 'POST') {
                const { action, source_uuid } = route.request().postDataJSON(); actions.push(action);
                if (failAction && action !== 'seen') return route.fulfill({status:503,json:{detail:'Service momentanément indisponible.'}});
                if (action === 'discuss_agent') {
                    targets.push(route.request().postDataJSON().agent_uuid);
                    return route.fulfill({json:{...item,navigation:{type:'agent_conversation',uuid:agentThreadId,agent_uuid:agentId,
                        agent_name:'Recherche de stage',agent_avatar_url:'',unread_count:0,draft:watchDraft}}});
                }
                if (action === 'open_source') {
                    if (item.kind === 'topic') {
                        targets.push(source_uuid);
                        return route.fulfill({json:{...item,navigation:{type:'external',url:source_uuid===emailId ? 'https://mail.google.com/mail/?authuser=camille%40example.test#all/thread-stage' : 'https://calendar.google.com/calendar/event?eid=example'}}});
                    }
                    return route.fulfill({json:{...item,navigation:item.kind === 'email_thread' ? {type:'external',url:'https://mail.google.com/mail/?authuser=camille%40example.test#all/thread-stage'} : {type:'conversation',uuid:'pinned'}}});
                }
                if (action === 'seen') item.seen_at = new Date().toISOString();
                if (action === 'accept' || action === 'decline') { item.source_status = action === 'accept' ? 'accepted' : 'declined'; item.result = action === 'accept' ? 'Demande acceptée.' : 'Demande refusée.'; item.actions = []; item.handled_at = new Date().toISOString(); }
                if (action === 'dismiss') item.handled_at = new Date().toISOString();
                if (action === 'snooze') item.snoozed_until = new Date(Date.now()+86400000).toISOString();
            }
            return route.fulfill({json:item});
        }
        if (path === '/messaging/conversations/private/') return route.fulfill({json:[{uuid:'pinned',name:'Conversation épinglée',conversation_type:'direct',unread_count:0,other_participant:{uuid:'friend',username:'Conversation épinglée',photo_profil_url:'/watch-covers/friend.webp'}}]});
        if (path === '/messaging/conversations/pinned/') return route.fulfill({json:{uuid:'pinned',conversation_type:'direct',unread_count:0,other_participant:{uuid:'friend',username:'Conversation épinglée',photo_profil_url:'/watch-covers/friend.webp'}}});
        if (recommended && path === '/messaging/conversations/agents/') return route.fulfill({json:[{
            uuid:agentThreadId,conversation_type:'ai_agent',unread_count:0,
            framework_agent:{uuid:agentId,name:'Recherche de stage',avatar_url:''}}]});
        return route.fulfill({json:[]});
    });
    await page.goto('/');
    await expect(page.getByRole('button',{name:/Lucas souhaite/})).toBeVisible();
    return {actions,items,scans,targets};
}

test('a recommended agent opens with an editable draft and sends no message', async ({page}) => {
    const fixture = await setup(page, false, true, true, true);
    const sends: string[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && /\/messages\//.test(request.url())) sends.push(request.url());
    });
    await page.getByRole('button',{name:/Votre candidature de stage/}).click();
    await expect(page.locator('.web-bottom-bar')).toHaveCount(0);
    await page.getByRole('button',{name:'Discuter avec Recherche de stage'}).click();
    await expect(page.locator('.thread-header-name')).toHaveText('Recherche de stage');
    await expect(page.locator('.web-bottom-bar textarea')).toHaveValue(watchDraft);
    expect(await page.locator('.web-bottom-bar textarea').evaluate(input => input.clientHeight)).toBeGreaterThan(42);
    await page.locator('.web-bottom-bar textarea').fill(`${watchDraft}\nMon ajout personnel.`);
    expect(fixture.targets).toEqual([agentId]);
    expect(fixture.items.find(item=>item.uuid===topicId)?.handled_at).toBeNull();
    expect(sends).toEqual([]);
});

test('agent handoff preserves existing writing and does not duplicate context on a second opening', async ({page}) => {
    await setup(page, false, true, true, true);
    await page.evaluate(({owner,agentThreadId}) => {
        localStorage.setItem('echo:composer:v1:' + JSON.stringify([owner,agentThreadId]), JSON.stringify({
            draft:{text:'Mon brouillon déjà commencé.',jarvisMode:false,agent:null,reply:null},sends:[]}));
    }, {owner,agentThreadId});
    const expected = `Mon brouillon déjà commencé.\n\n${watchDraft}`;
    for (let i = 0; i < 2; i++) {
        await page.goto(`/veilles/${topicId}`);
        await page.getByRole('button',{name:'Discuter avec Recherche de stage'}).click();
        await expect(page.locator('.web-bottom-bar textarea')).toHaveValue(expected);
    }
});

test('an unavailable agent action leaves the user on the watch and preserves the local draft', async ({page}) => {
    await setup(page, true, true, true, true);
    await page.getByRole('button',{name:/Votre candidature de stage/}).click();
    await page.getByRole('button',{name:'Discuter avec Recherche de stage'}).click();
    await expect(page.getByRole('alert')).toHaveText('Service momentanément indisponible.');
    await expect(page).toHaveURL(new RegExp(`/veilles/${topicId}`));
    await expect(page.locator('.web-bottom-bar')).toHaveCount(0);
});

test('pinned conversations lead the grid and a watch has a stable detail layout without composer', async ({page}) => {
    const fixture = await setup(page);
    await expect(page.locator('.watch-grid > button').first()).toHaveAttribute('aria-label','Ouvrir Conversation épinglée');
    await page.getByRole('button',{name:/Lucas souhaite/}).click();
    await expect(page).toHaveURL(new RegExp(`/veilles/${friendId}`));
    await expect(page.locator('.watch-summary')).toContainText('Lucas vous a envoyé une demande d’ami.');
    await expect(page.locator('.watch-page .thread-header > button')).toHaveCount(1);
    await expect(page.locator('.watch-page .thread-header-info .thread-header-name')).toHaveText('Lucas souhaite vous ajouter');
    await expect(page.locator('.watch-page h2')).toHaveCount(0);
    await expect(page.locator('.web-bottom-bar')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Accepter la demande'})).toBeEnabled();
    expect(fixture.actions).toEqual(['seen']);
    await page.reload();
    await expect(page.locator('.watch-summary')).toContainText('Lucas vous a envoyé une demande d’ami.');
    await page.getByRole('button',{name:'Retour à l’accueil'}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.watch-grid')).toBeVisible();
});

test('acceptance persists and removes the subject from the single grid', async ({page}) => {
    const fixture = await setup(page);
    await page.getByRole('button',{name:/Lucas souhaite/}).click();
    await expect(page.getByRole('button',{name:'Accepter la demande'})).toBeEnabled();
    await page.getByRole('button',{name:'Accepter la demande'}).click();
    await expect(page.locator('.watch-result')).toHaveText('Demande acceptée.');
    await expect(page.getByRole('button',{name:'Accepter la demande'})).toHaveCount(0);
    await page.getByRole('button',{name:'Retour à l’accueil'}).click();
    await expect(page.getByRole('button',{name:/Lucas souhaite/})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Traitées',exact:true})).toHaveCount(0);
    await page.goto(`/veilles/${friendId}`);
    await expect(page.locator('.watch-result')).toHaveText('Demande acceptée.');
    expect(fixture.actions.filter(action=>action==='accept')).toHaveLength(1);
});

test('failure keeps the source actionable and browser back returns to the grid', async ({page}) => {
    await setup(page,true);
    await page.getByRole('button',{name:/Lucas souhaite/}).click();
    await expect(page.getByRole('button',{name:'Accepter la demande'})).toBeEnabled();
    await page.getByRole('button',{name:'Accepter la demande'}).click();
    await expect(page.getByRole('alert')).toContainText('Service momentanément indisponible');
    await expect(page.getByRole('button',{name:'Accepter la demande'})).toBeEnabled();
    await page.goBack();
    await expect(page.locator('.watch-grid')).toBeVisible();
});

test('the watch header is inert and mobile navigation keeps snooze separate from answering', async ({page}) => {
    const fixture = await setup(page);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:/Lucas souhaite/}).click();
    await page.locator('.watch-page .thread-header-info').click();
    await expect(page).toHaveURL(new RegExp(`/veilles/${friendId}`));
    await expect(page.locator('.watch-inline-list')).toHaveCount(0);
    await page.getByRole('button',{name:'Retour à l’accueil'}).click();
    await page.getByRole('button',{name:/Rejoignez Randonnées/}).click();
    await expect(page.locator('.watch-summary')).toContainText('Léa vous invite');
    await expect(page.getByRole('button',{name:'Rejoindre le groupe'})).toBeEnabled();
    await page.getByRole('button',{name:'Plus tard'}).click();
    await expect(page.getByRole('status').filter({hasText:'Cette veille reviendra'})).toBeVisible();
    expect(fixture.items[1].source_status).toBe('pending');
    await page.getByRole('button',{name:'Retour à l’accueil'}).click();
    await expect(page.getByRole('button',{name:/Rejoignez Randonnées/})).toHaveCount(0);
});


test('the home keeps fixed squares, photo-only pins and readable native templates', async ({page}) => {
    await setup(page);
    await expect(page.locator('.watch-home > header')).toHaveCount(0);
    await expect(page.locator('.watch-home h1, .watch-home h2')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'À suivre',exact:true})).toHaveCount(0);
    const grid = page.locator('.watch-grid');
    expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(9);
    const pin = grid.locator('.watch-card').first();
    await expect(pin.locator('img')).toHaveCount(1);
    await expect(pin.locator('strong, small, .watch-card__shade')).toHaveCount(0);
    const card = grid.locator('.watch-card--friend_request').first();
    const before = await card.boundingBox();
    expect(before?.width).toBe(125);
    expect(before?.height).toBe(125);
    const title = await card.locator('.watch-card__fixed-copy strong').boundingBox();
    const detail = await card.locator('small').boundingBox();
    expect(title!.x).toBeGreaterThan(before!.x);
    expect(title!.y).toBeGreaterThan(before!.y);
    expect(title!.y + title!.height).toBeLessThanOrEqual(detail!.y);
    expect(detail!.y + detail!.height).toBeLessThan(before!.y + before!.height);
    expect(await card.locator('.watch-card__fixed-copy strong').evaluate(element => getComputedStyle(element).color)).toBe('rgb(62, 38, 58)');
    await page.setViewportSize({width:1000,height:1000});
    const after = await card.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(6);
});

test('a session queues a background scan and generated suggestions keep the validated layout', async ({page}) => {
    const fixture = await setup(page,false,true);
    await expect.poll(()=>fixture.scans.length).toBeGreaterThan(0);
    const initialScans = fixture.scans.length;
    await page.getByRole('button',{name:/Une réponse pour votre stage/}).click();
    await expect(page.locator('.watch-summary')).toContainText('Un entretien vous est proposé mardi');
    await expect(page.locator('.sidebar__nav-btn--active[title="Accueil"]')).toBeVisible();
    await expect(page.getByRole('button',{name:'Consulter le mail'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Accepter la demande'})).toHaveCount(0);
    await page.getByRole('button',{name:'Masquer',exact:true}).click();
    await page.getByRole('button',{name:'Retour à l’accueil'}).click();
    await expect(page.getByRole('button',{name:/Une réponse pour votre stage/})).toHaveCount(0);
    expect(fixture.scans.length).toBe(initialScans);
    expect(fixture.actions).not.toContain('open_source');
});

test('opening a mail requires a click and uses the source returned by the server', async ({page}) => {
    const fixture = await setup(page,false,true);
    await page.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Boîte de réception fictive</p>'}));
    await page.getByRole('button',{name:/Une réponse pour votre stage/}).click();
    expect(fixture.actions).not.toContain('open_source');
    await page.getByRole('button',{name:'Consulter le mail'}).click();
    await expect(page).toHaveURL(/https:\/\/mail\.google\.com\/mail\/\?authuser=camille%40example\.test#all\/thread-stage/);
    expect(fixture.items.find(item=>item.uuid===emailId)?.handled_at).toBeNull();
});

test('an Echo suggestion opens the existing conversation without sending anything', async ({page}) => {
    const fixture = await setup(page,false,true);
    await page.getByRole('button',{name:/Organiser la sortie/}).click();
    await page.getByRole('button',{name:'Ouvrir la conversation',exact:true}).click();
    await expect(page.locator('.watch-page')).toHaveCount(0);
    await expect(page.locator('.thread-header-name').first()).toContainText('Conversation épinglée');
    expect(fixture.actions.filter(action=>action==='open_source')).toHaveLength(1);
    expect(fixture.items.find(item=>item.uuid===echoId)?.handled_at).toBeNull();
});

test('a combined topic has one card and opens each exact source from the same detail page', async ({page}) => {
    const fixture = await setup(page,false,true,true);
    await page.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Mail fictif</p>'}));
    await page.route('https://calendar.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Événement fictif</p>'}));
    await expect(page.getByRole('button',{name:/Votre candidature de stage/})).toHaveCount(1);
    await expect(page.getByRole('button',{name:/Une réponse pour votre stage/})).toHaveCount(0);
    await page.getByRole('button',{name:/Votre candidature de stage/}).click();
    await expect(page.locator('.watch-summary')).toContainText('Un entretien est prévu demain');
    await expect(page.locator('.watch-page .thread-header > button')).toHaveCount(1);
    await expect(page.locator('.web-bottom-bar')).toHaveCount(0);
    await page.getByRole('button',{name:'Consulter le mail',exact:true}).click();
    await expect(page).toHaveURL(/mail\.google\.com/);
    expect(fixture.targets).toEqual([emailId]);
    await page.goto(`/veilles/${topicId}`);
    await page.getByRole('button',{name:'Voir l’événement',exact:true}).click();
    await expect(page).toHaveURL(/calendar\.google\.com/);
    expect(fixture.targets).toEqual([emailId,calendarId]);
});

test('snoozing a combined topic removes the whole subject from the single grid', async ({page}) => {
    await setup(page,false,true,true);
    await page.getByRole('button',{name:/Votre candidature de stage/}).click();
    await page.getByRole('button',{name:'Plus tard',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Cette veille reviendra'})).toBeVisible();
    await page.getByRole('button',{name:'Retour à l’accueil'}).click();
    await expect(page.getByRole('button',{name:/Votre candidature de stage/})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Organiser la sortie/})).toBeVisible();
});

test('a denied topic refresh removes the cached common summary from the open page', async ({page}) => {
    await setup(page,false,true,true);
    await page.getByRole('button',{name:/Votre candidature de stage/}).click();
    await expect(page.locator('.watch-summary')).toBeVisible();
    await expect(page.getByRole('button',{name:'Plus tard',exact:true})).toBeEnabled();
    await page.route(new RegExp(`/watches/${topicId}/$`),route=>route.fulfill({status:404,json:{detail:'Accès révoqué.'}}));
    await page.getByRole('button',{name:'Plus tard',exact:true}).click();
    await expect(page.locator('.watch-page .watch-notice')).toBeVisible();
    await expect(page.locator('.watch-summary')).toHaveCount(0);
    await expect(page.locator('.watch-page .thread-header-name')).toHaveCount(0);
    await expect(page.locator('.watch-list').getByRole('button',{name:'Votre candidature de stage',exact:true})).toHaveCount(0);
});


test('generated album covers have no text overlay while native events keep their fixed template', async ({page}) => {
    await setup(page,false,true,false,false,true);
    const card=page.getByRole('button',{name:'Une réponse pour votre stage — Votre veille'});
    await expect(card).toHaveClass(/watch-card--album/);
    await expect(card.locator('.watch-card__cover')).toBeVisible();
    await expect(card.locator('strong,small,.watch-card__shade')).toHaveCount(0);
    const friend=page.getByRole('button',{name:/Lucas souhaite/});
    await expect(friend.locator('.watch-card__fixed-copy strong')).toHaveText('Lucas');
    await expect(friend.locator('img')).toHaveAttribute('src','/watch-covers/friend.webp');
    await card.click();
    await expect(page.locator('.watch-summary')).toContainText('Votre candidature est retenue');
});

test('unavailable album artwork keeps a readable and clickable fallback', async ({page}) => {
    await setup(page,false,true,false,false,true,true);
    const card=page.getByRole('button',{name:'Une réponse pour votre stage — Votre veille'});
    await expect(card).toHaveClass(/watch-card--pending/);
    await expect(card.locator('strong')).toHaveText('Une réponse pour votre stage');
    await card.click();
    await expect(page.getByRole('button',{name:'Consulter le mail',exact:true})).toBeVisible();
});
