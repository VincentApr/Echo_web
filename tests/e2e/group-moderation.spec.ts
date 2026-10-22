import { test, expect, type Page } from '@playwright/test';

const groupUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversationUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function setup(page: Page, role: 'owner' | 'moderator' | 'member' = 'owner', failSave = false) {
    const current = { uuid: 'current', username: 'Camille', email:'test@example.test', has_accepted_cgu:true, ai_agents_enabled:true, ai_policy_version:1 };
    const members = [
        { user: { uuid:'current', username:'Camille' }, role, is_muted:false, is_ai_blocked:false },
        { user: { uuid:'lucas', username:'Lucas' }, role:'member', is_muted:false, is_ai_blocked:false },
        { user: { uuid:'alex', username:'Alex' }, role:'moderator', is_muted:false, is_ai_blocked:false },
        ...(role !== 'owner' ? [{user:{uuid:'owner', username:'Propriétaire'},role:'owner',is_muted:false,is_ai_blocked:false}] : []),
    ];
    const banned: object[] = [];
    const agent = { uuid:'agent', name:'Voyages', is_blocked:false, is_automatic:true };
    const patches: { path:string; data: Record<string, unknown> }[] = [];
    let policy = 'everyone';
    const conversation = {uuid:conversationUuid, conversation_type:'group_chat',name:'Escapades',group_info:{uuid:groupUuid,name:'Escapades'},group_uuid:groupUuid,unread_count:0};
    await page.addInitScript(({ current, conversationUuid }) => {
        localStorage.setItem('user',JSON.stringify(current));
        localStorage.setItem('accessToken',`header.${btoa(JSON.stringify({exp:Date.now()/1000+3600}))}.signature`);
        localStorage.setItem('refreshToken','local-test-only');
        localStorage.setItem(`echo:pinned-conversations:${current.uuid}`, JSON.stringify([conversationUuid]));
    }, { current, conversationUuid });
    await page.routeWebSocket(/\/ws\/chat\//, () => {});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts|calendrier|news)\//, async route => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() === 'PATCH') {
            const data = route.request().postDataJSON();
            patches.push({ path, data });
            if (failSave) return route.fulfill({status:403,json:{detail:'Permission refusée'}});
            const member = members.find(item => path.includes(`/members/${item.user.uuid}/`));
            if (member) {
                if (data.action === 'mute') member.is_muted = true;
                if (data.action === 'unmute') member.is_muted = false;
                if (path.endsWith('/ai-block/')) member.is_ai_blocked = data.action === 'block';
                if (data.action === 'ban') { banned.push({...member,is_banned:true,ban_reason:data.reason}); members.splice(members.indexOf(member),1); }
                if (data.action === 'promote') member.role = 'moderator';
            }
            if (data.action === 'unban') banned.splice(0);
            if (path.includes('/agents/')) { agent.is_blocked = data.action === 'block'; agent.is_automatic = false; }
            if (path.endsWith('/ai-policy/')) policy = data.ai_agent_policy;
            return route.fulfill({json:{message:'Enregistré'}});
        }
        if (path === '/api/auth/profile/') return route.fulfill({json:current});
        if (path === '/watches/') return route.fulfill({json:{results:[],count:0,next_offset:null}});
        if (path === `/groups/${groupUuid}/`) return route.fulfill({json:{id:1,uuid:groupUuid,name:'Escapades',parent:null,member_count:members.length,members,my_membership:{role},ai_agent_policy:policy}});
        if (path === `/groups/${groupUuid}/stats/`) return route.fulfill({json:{total_members:members.length,recent_activity:{messages_7d:0,new_members_7d:0}}});
        if (path === `/groups/${groupUuid}/members/`) return route.fulfill({json:members});
        if (path === `/groups/${groupUuid}/moderation/`) return route.fulfill({json:{banned_members:banned,agents:[agent]}});
        if (path.includes('/messages/')) return route.fulfill({json:{results:[],next:null}});
        if (path === `/messaging/conversations/${conversationUuid}/`) return route.fulfill({json:{...conversation,messages:[]}});
        if (path === '/messaging/conversations/groups/' || path === '/messaging/conversations/') return route.fulfill({json:[conversation]});
        return route.fulfill({json:[]});
    });
    await page.goto('/');
    await page.getByRole('button',{name:'Ouvrir Escapades',exact:true}).click();
    await page.locator('.thread-header-info').click();
    await expect(page.getByRole('heading',{name:'Escapades',exact:true})).toBeVisible();
    return { patches };
}

test('owner sees inline controls while self and owner remain protected', async ({page}) => {
    await setup(page);
    await expect(page.getByRole('button',{name:'Rendre muet · Lucas'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Nommer modérateur · Lucas'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Retirer le rôle de modérateur · Alex'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Rendre muet · Camille'})).toHaveCount(0);
    await expect(page.locator('.mgmt-page summary')).toHaveCount(0);
});

test('moderator can sanction members but not fellow moderators or owner', async ({page}) => {
    await setup(page,'moderator');
    await expect(page.getByRole('button',{name:'Bannir · Lucas'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Bannir · Alex'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Bannir · Propriétaire'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Nommer modérateur · Lucas'})).toHaveCount(0);
});

test('ordinary member has no moderation controls', async ({page}) => {
    await setup(page,'member');
    await expect(page.getByRole('button',{name:/Rendre muet ·/})).toHaveCount(0);
    await expect(page.getByRole('group',{name:'Qui peut utiliser les agents IA'})).toHaveCount(0);
});

test('mute saves the selected duration, refreshes state and can be undone', async ({page}) => {
    const fixture = await setup(page);
    await page.getByRole('button',{name:'Rendre muet · Lucas'}).click();
    await page.getByRole('button',{name:'7 jours',exact:true}).click();
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await expect(page.getByRole('button',{name:'Rétablir la parole · Lucas'})).toBeVisible();
    expect(fixture.patches[0].data).toEqual({action:'mute',reason:'',duration_hours:168});
    await page.getByRole('button',{name:'Rétablir la parole · Lucas'}).click();
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await expect(page.getByRole('button',{name:'Rendre muet · Lucas'})).toBeVisible();
});

test('ban and unban are confirmed and kept separate from active membership', async ({page}) => {
    await setup(page);
    await page.getByRole('button',{name:'Bannir · Lucas'}).click();
    await page.getByRole('textbox',{name:'Motif',exact:true}).fill('Spam');
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Personnes bannies (1)'})).toBeVisible();
    await page.getByRole('button',{name:'Lever le bannissement · Lucas'}).click();
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Personnes bannies (1)'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Bannir · Lucas'})).toHaveCount(0);
});

test('policy and agent suspension are saved; errors do not invent a sanction', async ({page}) => {
    const fixture = await setup(page);
    await page.getByRole('button',{name:'Personne',exact:true}).click();
    await expect(page.getByRole('button',{name:'Personne',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Suspendre · Voyages'}).click();
    await expect(page.getByRole('button',{name:'Réautoriser · Voyages'})).toBeVisible();
    expect(fixture.patches.map(item => item.data)).toEqual([{ai_agent_policy:'disabled'},{action:'block'}]);
});

test('failed sanctions stay visible as errors and do not change the member', async ({page}) => {
    await setup(page,'owner',true);
    await page.getByRole('button',{name:'Rendre muet · Lucas'}).click();
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Permission refusée');
    await expect(page.getByRole('button',{name:'Rendre muet · Lucas'})).toBeVisible();
});

test('mobile keeps controls within the page', async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await setup(page);
    await page.getByRole('button',{name:'Rendre muet · Lucas'}).click();
    await expect(page.getByRole('button',{name:'Confirmer',exact:true})).toBeInViewport();
    expect(await page.locator('.mgmt-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
