import { test, expect, type Page } from '@playwright/test';

const owner='11111111-1111-4111-8111-111111111111';
const watch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function setup(page:Page, fakePush=true) {
    const user={uuid:owner,username:'Tester',has_accepted_cgu:true,ai_agents_enabled:true,ai_policy_version:1};
    let prefs={images_enabled:true,notifications_enabled:false,quiet_start:22,quiet_end:8,timezone:'Europe/Paris',daily_limit:3,
        push_available:true,images_available:true,vapid_public_key:Buffer.from([4,...Array(64).fill(1)]).toString('base64url'),device_count:0};
    const requests:{path:string;method:string;data:Record<string,unknown> | null}[]=[];
    await page.addInitScript(user=>{
        localStorage.setItem('user',JSON.stringify(user));
        localStorage.setItem('accessToken',`header.${btoa(JSON.stringify({exp:Date.now()/1000+3600}))}.signature`);
        localStorage.setItem('refreshToken','fixture');
    },user);
    if (fakePush) await page.addInitScript(()=>{
        const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>true};
        const registration={active:{postMessage:(_data:unknown,ports:MessagePort[])=>ports[0].postMessage({ok:true})},pushManager:{getSubscription:async()=>null,subscribe:async()=>subscription}};
        Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>registration,getRegistration:async()=>registration,ready:Promise.resolve(registration)}});
        Object.defineProperty(window,'Notification',{configurable:true,value:class {static permission='default';static async requestPermission(){sessionStorage.setItem('permission-requests',String(Number(sessionStorage.getItem('permission-requests')||0)+1));return 'granted';}}});
    });
    await page.routeWebSocket(/\/ws\//,()=>{});
    await page.route(/^https?:\/\/[^/]+\/(watches|tools|api|messaging|framework|jarvis|relations|groups|notif|scripts)\//,async route=>{
        const request=route.request();const path=new URL(request.url()).pathname;
        if (request.method()!=='GET') requests.push({path,method:request.method(),data:request.postData()?request.postDataJSON():null});
        if (path==='/api/auth/profile/') return route.fulfill({json:user});
        if (path==='/watches/preferences/') {
            if (request.method()==='PATCH') prefs={...prefs,...request.postDataJSON()};
            return route.fulfill({json:prefs});
        }
        if (path==='/tools/oauth/status/') return route.fulfill({json:[{provider:'google',granted_scopes:['openid','email']},{provider:'github',granted_scopes:['notifications']}]});
        if (path==='/tools/oauth/initiate/google/') return route.fulfill({json:{auth_url:'https://accounts.google.com/o/oauth2/v2/auth?state=fixture',state:'fixture',redirect_uri:'https://api.echosocial.fr/tools/oauth/callback/google/'}});
        if (path==='/watches/') return route.fulfill({json:{results:[],count:0,next_offset:null,checked_at:new Date().toISOString()}});
        if (path==='/jarvis/instance/') return route.fulfill({json:{is_active:true,default_language:'fr',permissions:{},permission_schema_version:1}});
        if (path==='/watches/presence/') return route.fulfill({status:204});
        return route.fulfill({json:[]});
    });
    await page.goto('/');
    return {requests};
}

async function settings(page:Page) {
    await page.getByTitle('Tester',{exact:true}).click();
    await page.getByRole('button',{name:'Ouvrir les réglages'}).click();
    await page.getByRole('button',{name:'Modération',exact:true}).click();
    await page.getByText('Fonctionnalités IA',{exact:true}).click();
    await expect(page.getByRole('switch',{name:'Notifications de veille',exact:true})).toBeVisible();
}

test('notification permission is asked only after a click and preferences persist',async({page})=>{
    const fixture=await setup(page);await settings(page);
    expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
    await page.getByRole('switch',{name:'Notifications de veille',exact:true}).click();
    await expect(page.getByRole('switch',{name:'Notifications de veille',exact:true})).toBeChecked();
    expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBe('1');
    expect(fixture.requests.some(request=>request.path==='/watches/subscriptions/' && request.method==='POST')).toBe(true);
    await page.getByLabel('Maximum par jour').selectOption('2');
    await expect(page.getByLabel('Maximum par jour')).toHaveValue('2');
    await expect(page.getByLabel('Maximum par jour')).toBeEnabled();
    await page.getByLabel('Début des heures calmes').selectOption('21');
    await expect(page.getByLabel('Début des heures calmes')).toHaveValue('21');
    await expect(page.getByLabel('Début des heures calmes')).toBeEnabled();
    await page.getByRole('switch',{name:'Illustrations générées',exact:true}).click();
    await expect(page.getByRole('switch',{name:'Illustrations générées',exact:true})).not.toBeChecked();
    await expect(page.getByRole('switch',{name:'Notifications de veille',exact:true})).toBeEnabled();
    await page.getByRole('switch',{name:'Notifications de veille',exact:true}).click();
    await expect(page.getByRole('switch',{name:'Notifications de veille',exact:true})).not.toBeChecked();
});

test('Google login does not masquerade as Gmail access and connecting a service preserves OAuth state',async({page})=>{
    await setup(page);await settings(page);
    await expect(page.getByText('Autorisations de lecture à compléter')).toBeVisible();
    await expect(page.getByText('Notifications GitHub autorisées')).toBeVisible();
    await page.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Google fictif</p>'}));
    const google=page.getByRole('region',{name:'Services de veille'}).locator('.spage-row').filter({hasText:'Gmail et Google Agenda'});
    await google.getByRole('button',{name:'Connecter',exact:true}).click();
    await expect(page).toHaveURL(/accounts.google.com/);
});

test('callback exchanges the code once and rejects a mismatched state',async({page})=>{
    const fixture=await setup(page);
    await page.evaluate(({owner})=>sessionStorage.setItem('echo:watch-oauth',JSON.stringify({owner,provider:'google',state:'fixture',redirect_uri:'https://api.echosocial.fr/tools/oauth/callback/google/',at:Date.now()})),{owner});
    await page.goto('/oauth/watch-callback/?state=fixture&code=code-once');
    await expect(page.getByRole('status')).toHaveText('Service connecté. La première veille a été demandée.');
    await expect(page).toHaveURL(/\/oauth\/watch-callback\/$/);
    expect(fixture.requests.filter(request=>request.path==='/tools/oauth/exchange/google/')).toHaveLength(1);
    await page.goto('/oauth/watch-callback/?state=foreign&code=wrong-code');
    await expect(page.getByRole('alert')).toContainText('autre session');
    expect(fixture.requests.filter(request=>request.path==='/tools/oauth/exchange/google/')).toHaveLength(1);
});

test('the real service worker keeps payloads generic and isolates account bindings',async({page,context})=>{
    await setup(page,false);
    const workerPromise=context.waitForEvent('serviceworker');
    await page.evaluate(async owner=>{
        const registration=await navigator.serviceWorker.register('/watch-push-sw.js');
        await navigator.serviceWorker.ready;
        await new Promise<void>(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>resolve();registration.active!.postMessage({type:'echo-watch-account',owner},[channel.port2]);});
    },owner);
    const worker=await workerPromise;
    const results=await worker.evaluate(async({owner,watch})=>{
        const captured:{title:string;options:NotificationOptions}[]=[];
        Object.defineProperty(self.registration,'showNotification',{value:async(title:string,options:NotificationOptions)=>{captured.push({title,options});}});
        const dispatch=async(data:unknown)=>{
            let task=Promise.resolve();
            const event=new PushEvent('push',{data:JSON.stringify(data)});
            Object.defineProperty(event,'waitUntil',{value:(value:Promise<void>)=>{task=value;}});
            self.dispatchEvent(event);await task;
        };
        await dispatch({owner,watch,title:'Private mail subject',body:'Secret excerpt',url:'https://evil.example'});
        await dispatch({owner:'22222222-2222-4222-8222-222222222222',watch});
        await dispatch({owner,watch:'https://evil.example'});
        return captured;
    },{owner,watch});
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Echo');
    expect(results[0].options.body).toBe('Une nouvelle veille vous attend.');
    expect(results[0].options.data).toEqual({owner,watch});
});
