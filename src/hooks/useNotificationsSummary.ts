// Web hook: Jarvis notification summaries
// Extracted from the 2200-line MessagingContext for lightweight web usage
import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useAuth } from '../contexts/AuthContext';

export interface MessageSummary {
    id: string;
    sender: string;
    message: string;
    conversationUuid?: string;
}

const isLikelyUuid = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
};

const isLowQualitySummary = (value: string | undefined): boolean => {
    if (!value) return true;
    const n = value.toLowerCase();
    return (
        n.includes('messages are not provided') ||
        n.includes('cannot summarize') ||
        n.includes('messages non fournis') ||
        n.includes('impossible de résumer')
    );
};

function parseJarvisNotifications(data: any): MessageSummary[] {
    const summaries: MessageSummary[] = [];

    let parsedData = null;
    if (data.data && Object.keys(data.data).length > 0) {
        parsedData = data.data;
    } else if (data.response && typeof data.response === 'string') {
        try { parsedData = JSON.parse(data.response); } catch { return summaries; }
    }

    if (!parsedData) return summaries;

    if (parsedData.notifications && Array.isArray(parsedData.notifications)) {
        if (parsedData.notifications.length === 0) {
            if (parsedData.total_unread && parsedData.total_unread > 0) {
                summaries.push({
                    id: '0',
                    sender: 'Messages',
                    message: `Vous avez ${parsedData.total_unread} message${parsedData.total_unread > 1 ? 's' : ''} non lu${parsedData.total_unread > 1 ? 's' : ''}`,
                });
            }
        } else {
            parsedData.notifications.forEach((notif: any, index: number) => {
                const conversationUuid =
                    typeof notif.conversation_uuid === 'string' && isLikelyUuid(notif.conversation_uuid)
                        ? notif.conversation_uuid
                        : undefined;
                const summaryText = typeof notif.summary === 'string' ? notif.summary.trim() : '';

                summaries.push({
                    id: conversationUuid || String(index),
                    sender: notif.username || 'Utilisateur inconnu',
                    message: !isLowQualitySummary(summaryText) ? summaryText : 'Nouveau message',
                    conversationUuid,
                });
            });
        }
    }

    return summaries;
}

export function useNotificationsSummary() {
    const { user, isLoggedIn } = useAuth();
    const [summaries, setSummaries] = useState<MessageSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const hasFetchedRef = useRef(false);

    const fetchSummaries = useCallback(async () => {
        if (!isLoggedIn) {
            setSummaries([]);
            setLoading(false);
            setRefreshing(false);
            return;
        }

        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/jarvis/chat/?type=notifications`, {
                method: 'POST',
            });
            if (response.ok) {
                const data = await response.json();
                setSummaries(parseJarvisNotifications(data));
            }
        } catch {
            // silently fail
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [isLoggedIn]);

    useEffect(() => {
        if (!user || hasFetchedRef.current) return;
        hasFetchedRef.current = true;
        setLoading(true);
        fetchSummaries();
    }, [user, fetchSummaries]);

    const refresh = useCallback(() => {
        setRefreshing(true);
        fetchSummaries();
    }, [fetchSummaries]);

    const dismissSummary = useCallback((summaryId: string) => {
        setSummaries(prev => prev.filter(s => s.id !== summaryId));
    }, []);

    return { summaries, loading, refreshing, refresh, dismissSummary };
}
