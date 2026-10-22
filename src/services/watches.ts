import { API_BASE_URL } from '../config/api';
import { fetchWithAuth } from './apiClient';

export interface WatchItem {
    uuid: string;
    kind: 'friend_request' | 'group_invitation' | 'email_thread' | 'calendar_event' | 'echo_conversation' | 'topic' | 'github_notification';
    title: string;
    summary: string;
    payload: { actor?: string; avatar_url?: string | null; message?: string; group_name?: string; description?: string; expires_at?: string; source_label?: string };
    source_status: string;
    result: string;
    seen_at: string | null;
    handled_at: string | null;
    snoozed_until: string | null;
    source_created_at: string;
    updated_at: string;
    priority?: number;
    expires_at?: string | null;
    artwork_version?: string | null;
    actions: WatchChoice[];
    navigation?: { type: 'external'; url: string } | { type: 'conversation'; uuid: string }
        | { type: 'agent_conversation'; uuid: string; agent_uuid: string; agent_name: string;
            agent_avatar_url: string; unread_count: number; draft: string };
}
export interface WatchFeed { results: WatchItem[]; count: number; next_offset: number | null; checked_at: string; }
export type WatchScope = 'active' | 'history';
export type WatchAction = 'accept' | 'decline' | 'seen' | 'dismiss' | 'snooze' | 'open_source' | 'discuss_agent';
export interface WatchChoice { id: WatchAction; label: string; source_uuid?: string; agent_uuid?: string; }
export type WatchCommand = WatchAction | { action: WatchAction; source_uuid?: string; agent_uuid?: string };

export function watchSourceLabel(item: WatchItem): string {
    if (item.kind === 'topic') return item.payload.source_label || 'Veille';
    return { friend_request: 'Demande d’ami', group_invitation: 'Invitation', email_thread: 'Gmail',
        calendar_event: 'Google Agenda', echo_conversation: 'Conversation Echo', github_notification: 'GitHub' }[item.kind];
}

export async function requestWatchScan(): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/watches/refresh/`, { method: 'POST' });
    if (!response.ok) throw new Error('La veille ne peut pas être lancée pour le moment.');
}

export async function watchRequest<T>(path: string, action?: WatchCommand): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}/watches/${path}`, action ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typeof action === 'string' ? { action } : action),
    } : undefined);
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === 'string' && data.detail !== 'Not found.' ? data.detail
            : response.status === 404 ? 'Cette veille est indisponible. Le serveur doit peut-être être mis à jour.'
            : 'Impossible de mettre à jour cette veille. Réessayez dans un instant.');
    }
    return response.json() as Promise<T>;
}
