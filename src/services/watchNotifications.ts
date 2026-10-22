import { API_BASE_URL } from '../config/api';
import { fetchWithAuth } from './apiClient';

export interface WatchPreferences {
    images_enabled: boolean;
    notifications_enabled: boolean;
    quiet_start: number;
    quiet_end: number;
    timezone: string;
    daily_limit: number;
    push_available: boolean;
    images_available: boolean;
    vapid_public_key: string;
    device_count: number;
}

export async function preferences(patch?: Partial<WatchPreferences>): Promise<WatchPreferences> {
    const response = await fetchWithAuth(`${API_BASE_URL}/watches/preferences/`, patch ? {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    } : undefined);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.notifications_enabled !== 'boolean') throw new Error(
        typeof data.detail === 'string' ? data.detail : 'Les réglages de veille ne sont pas encore disponibles sur le serveur.');
    return data;
}

export function pushSupported(): boolean {
    return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushWorker(): Promise<ServiceWorkerRegistration> {
    const registration = await navigator.serviceWorker.register('/watch-push-sw.js', { scope: '/' });
    if (!registration.active) await navigator.serviceWorker.ready;
    return registration;
}

export async function bindPushAccount(owner: string | null, previous?: string) {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration?.active) return;
    if (owner && JSON.parse(localStorage.getItem('user') || 'null')?.uuid !== owner) return;
    await new Promise<void>((resolve,reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(()=>{channel.port1.close();reject(new Error('Notifications indisponibles'));},5000);
        channel.port1.onmessage = () => {clearTimeout(timer);channel.port1.close();resolve();};
        registration.active!.postMessage({ type: 'echo-watch-account', owner, previous },[channel.port2]);
    });
}

export async function enableDevice(owner: string, key: string) {
    if (!pushSupported()) throw new Error('Ce navigateur ne permet pas les notifications. Sur iPhone, ouvre Echo depuis l’écran d’accueil.');
    // Called from the user's click. Never ask for browser permission on login.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Autorise les notifications pour Echo dans les réglages du navigateur.');
    const registration = await pushWorker();
    const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='));
    const applicationServerKey = Uint8Array.from(decoded, char => char.charCodeAt(0));
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const response = await fetchWithAuth(`${API_BASE_URL}/watches/subscriptions/`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON()) });
    if (!response.ok) {
        if (response.status === 409) await subscription.unsubscribe();
        throw new Error('Impossible d’enregistrer ce navigateur. Réessaie l’activation.');
    }
    await bindPushAccount(owner);
}

export async function disableDevice() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    let response: Response;
    try {
        response = await fetchWithAuth(`${API_BASE_URL}/watches/subscriptions/`, { method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
    } finally { await subscription.unsubscribe(); }
    // Stop local delivery even if the API is unavailable. Its expired endpoint
    // will be removed when the push gateway returns 404/410.
    if (!response.ok) throw new Error('Notifications coupées sur cet appareil. Le serveur n’a pas pu confirmer son retrait.');
}

export async function releaseWatchDevice(owner:string) {
    await bindPushAccount(null,owner).catch(()=>{});
    await disableDevice().catch(()=>{});
}
