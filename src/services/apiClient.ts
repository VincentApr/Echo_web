// Persistent browser sessions, with one refresh per session at a time.
import { API_BASE_URL } from '../config/api';

let logoutCallback: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

export function setLogoutCallback(callback: (() => void) | null): void {
  logoutCallback = callback;
}

export function subscribeAccessToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => { tokenListeners.delete(listener); };
}

function accessIsFresh(token: string): boolean {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof exp === 'number' && exp * 1000 > Date.now() + 30_000;
  } catch { return false; }
}

async function refreshAccessToken(failedAccess: string | null): Promise<string | null> {
  if (refreshing) return refreshing;
  const renew = async (): Promise<string | null> => {
    // Another tab/request may have renewed the session while awaiting the lock.
    const currentAccess = localStorage.getItem('accessToken');
    if (currentAccess && currentAccess !== failedAccess) return currentAccess;
    const refresh = localStorage.getItem('refreshToken');
    if (!refresh) { logoutCallback?.(); return null; }
    const response = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
      signal: AbortSignal.timeout(15_000),
    });
    // Never restore an old session after logout or a change of account.
    if (localStorage.getItem('refreshToken') !== refresh) return null;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        logoutCallback?.();
        return null;
      }
      // Network/server failure does not mean the session has been revoked.
      throw new Error('Impossible de renouveler la connexion pour le moment. Réessaie dans un instant.');
    }
    const data = await response.json() as { access?: string; refresh?: string };
    if (typeof data.access !== 'string' || !data.access) throw new Error('Réponse de renouvellement de session invalide.');
    if (localStorage.getItem('refreshToken') !== refresh) return null;
    if (typeof data.refresh === 'string' && data.refresh) localStorage.setItem('refreshToken', data.refresh);
    localStorage.setItem('accessToken', data.access);
    tokenListeners.forEach(listener => listener(data.access!));
    return data.access;
  };
  // Web Locks also serializes rotating refresh tokens across browser tabs.
  refreshing = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('echo-session-refresh', renew);
    }
    return renew();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function getValidAccessToken(): Promise<string | null> {
  const access = localStorage.getItem('accessToken');
  if (access && accessIsFresh(access)) return access;
  if (!access && !localStorage.getItem('refreshToken')) return null;
  return refreshAccessToken(access);
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const sessionUser = localStorage.getItem('user');
  const accessToken = localStorage.getItem('accessToken');
  const headers = new Headers(options.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers });
  if (response.status !== 401) return response;
  if (localStorage.getItem('user') !== sessionUser) return response;
  const token = await refreshAccessToken(accessToken);
  if (!token) return response;
  if (localStorage.getItem('user') !== sessionUser) return response;
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
