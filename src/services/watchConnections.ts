import { API_BASE_URL } from '../config/api';
import { fetchWithAuth } from './apiClient';

export interface WatchConnection { provider:string; granted_scopes:string[] | string; }
const pendingKey = 'echo:watch-oauth';
const exchanges = new Map<string,Promise<void>>();

export async function connectedServices(): Promise<WatchConnection[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/tools/oauth/status/`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error('Connexions indisponibles');
    return data;
}

export async function connectService(owner:string, provider:string) {
    const response = await fetchWithAuth(`${API_BASE_URL}/tools/oauth/initiate/${encodeURIComponent(provider)}/?app_return_url=${encodeURIComponent(window.location.origin+'/oauth/watch-callback/')}`);
    if (!response.ok) throw new Error('Ce service doit être configuré dans Echo avant de pouvoir être connecté.');
    const data = await response.json();
    const url = new URL(data.auth_url);
    const expected = provider === 'github' ? 'github.com' : 'accounts.google.com';
    if (url.protocol !== 'https:' || url.host !== expected || !data.state || typeof data.redirect_uri !== 'string') throw new Error('Connexion non disponible.');
    sessionStorage.setItem(pendingKey, JSON.stringify({owner,provider,state:data.state,redirect_uri:data.redirect_uri,at:Date.now()}));
    window.location.assign(url.href);
}

export function finishConnection(owner:string, params:URLSearchParams): Promise<void> {
    const state = params.get('state') || '';
    const key = `${owner}:${state}`;
    const existing = exchanges.get(key);
    if (existing) return existing;
    const run = async () => {
        const pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
        if (!pending || pending.owner !== owner || pending.state !== state || Date.now()-pending.at>15*60_000
            || !['google','gmail','google_calendar','calendar','github'].includes(pending.provider)) throw new Error('Cette connexion a expiré ou appartient à une autre session. Recommence depuis les paramètres.');
        try {
            if (params.has('error') || !params.get('code')) throw new Error('La connexion au service a été annulée.');
            const response = await fetchWithAuth(`${API_BASE_URL}/tools/oauth/exchange/${pending.provider}/`, {method:'POST',
                headers:{'Content-Type':'application/json'},body:JSON.stringify({state,code:params.get('code'),redirect_uri:pending.redirect_uri})});
            if (!response.ok) throw new Error('La connexion n’a pas pu être finalisée. Réessaie depuis les paramètres.');
            await fetchWithAuth(`${API_BASE_URL}/watches/refresh/`,{method:'POST'}).catch(()=>{});
        } finally { sessionStorage.removeItem(pendingKey); }
    };
    const promise = run();
    exchanges.set(key,promise);
    return promise;
}
