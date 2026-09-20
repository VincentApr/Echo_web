// Web useConversations hook — aligned with mobile API response fields
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { webDatabaseManager } from '../services/webDatabase';
import { syncConversationsByType } from '../services/localSync';
import { webLogger } from '../utils/logger';

const backgroundConversationSyncInFlight = new Map<string, Promise<void>>();

export interface Conversation {
    uuid: string;
    unread_count: number;
    is_pinned?: boolean;
    is_muted?: boolean;
    is_archived?: boolean;
    created_at?: string;
    updated_at?: string;
    conversation_type: 'direct' | 'group' | 'agent' | 'group_chat' | 'ai_agent';

    last_message?: {
        content: string;
        created_at: string | null;
        sender_username: string;
    };

    // Direct conversation — API returns `other_participant`
    other_participant?: {
        username: string;
        surnom?: string;
        uuid?: string;
        photo_profil_url?: string;
        photo_profil?: string | null;
        is_online?: boolean;
    };

    // Group conversation
    group_info?: {
        uuid?: string;
        name: string;
        avatar: string | null;
        member_count?: number;
    };

    // Agent conversation
    framework_agent?: {
        name: string;
        avatar_url: string;
        uuid?: string;
        agent_type?: string;
        description?: string;
    };

    // Some API versions return agent data under agent_info
    agent_info?: {
        uuid?: string;
        name?: string;
        avatar_url?: string;
    };

    agent_name?: string;
    agent_avatar?: string;
    agent_avatar_url?: string;

    // Legacy / fallback fields from older API versions
    other_user?: {
        username: string;
        uuid: string;
        photo_profil?: string | null;
        photo_profil_url?: string;
    };
    group_name?: string;
    group_photo?: string | null;
    group_photo_url?: string;
    members_count?: number;

    // Computed display fields (filled by enrichConversation)
    name: string;
    avatar_url: string;
}

const MAX_PAGES = 20;

function toEpochMs(value?: string | number | null): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getConversationActivityTimestamp(conv: Pick<Conversation, 'last_message' | 'updated_at' | 'created_at'>): number {
    return toEpochMs(conv.last_message?.created_at ?? conv.updated_at ?? conv.created_at);
}

function compareConversationsByMobileOrder(a: Conversation, b: Conversation): number {
    const aHasMessages = !!a.last_message?.created_at;
    const bHasMessages = !!b.last_message?.created_at;

    if (aHasMessages !== bHasMessages) {
        return aHasMessages ? -1 : 1;
    }

    const aIsPinned = !!a.is_pinned;
    const bIsPinned = !!b.is_pinned;
    if (aIsPinned !== bIsPinned) {
        return aIsPinned ? -1 : 1;
    }

    const activityA = getConversationActivityTimestamp(a);
    const activityB = getConversationActivityTimestamp(b);
    if (activityA !== activityB) {
        return activityB - activityA;
    }

    const aHasUnread = (a.unread_count || 0) > 0;
    const bHasUnread = (b.unread_count || 0) > 0;
    if (aHasUnread !== bHasUnread) {
        return aHasUnread ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
}

function extractResultsAndNext(payload: unknown): { results: Conversation[]; next: string | null } {
    if (Array.isArray(payload)) return { results: payload as Conversation[], next: null };
    const p = payload as Record<string, unknown>;
    return {
        results: (p.results as Conversation[]) || [],
        next: (p.next as string) || null,
    };
}

async function fetchAllPages(endpoint: string): Promise<Conversation[]> {
    let url = `${API_BASE_URL}${endpoint}`;
    let all: Conversation[] = [];
    let pages = 0;

    while (url && pages < MAX_PAGES) {
        const res = await fetchWithAuth(url);
        if (!res.ok) break;
        const data = await res.json();
        const { results, next } = extractResultsAndNext(data);
        all = all.concat(results);
        url = next || '';
        pages++;
    }

    return all;
}

function normalizeConvType(conv: Conversation): 'direct' | 'group' | 'agent' {
    const t = conv.conversation_type as string;
    if (t === 'group_chat' || t === 'group') return 'group';
    if (t === 'ai_agent' || t === 'agent') return 'agent';
    return 'direct';
}

function resolveAgentDisplayName(conv: Conversation): string {
    const inferredFromLastMessage = conv.last_message?.sender_username || undefined;

    return (
        conv.framework_agent?.name ||
        conv.agent_info?.name ||
        conv.agent_name ||
        (conv as any).ai_agent?.name ||
        inferredFromLastMessage ||
        'Agent IA'
    );
}

function computeDisplayName(conv: Conversation): string {
    if (conv.conversation_type === 'group') {
        return conv.group_info?.name || conv.group_name || 'Groupe';
    }
    if (conv.conversation_type === 'agent') {
        return resolveAgentDisplayName(conv);
    }
    // Direct conversation — prefer other_participant (current API), fall back to other_user (legacy)
    const p = conv.other_participant;
    const u = conv.other_user;
    return p?.surnom || p?.username || u?.username || 'Utilisateur';
}

function computeAvatarUrl(conv: Conversation): string {
    if (conv.conversation_type === 'group') {
        return conv.group_info?.avatar || conv.group_photo_url || conv.group_photo || '';
    }
    if (conv.conversation_type === 'agent') {
        return (
            conv.framework_agent?.avatar_url ||
            conv.agent_info?.avatar_url ||
            conv.agent_avatar ||
            conv.agent_avatar_url ||
            (conv as any).ai_agent?.avatar_url ||
            ''
        );
    }
    const p = conv.other_participant;
    const u = conv.other_user;
    return p?.photo_profil_url || u?.photo_profil_url || u?.photo_profil || '';
}

function enrichConversation(conv: Conversation): Conversation {
    const normalizedType = normalizeConvType(conv);
    return {
        ...conv,
        conversation_type: normalizedType,
        name: computeDisplayName({ ...conv, conversation_type: normalizedType }),
        avatar_url: computeAvatarUrl({ ...conv, conversation_type: normalizedType }),
    };
}

export function useConversations() {
    const { isLoggedIn, user } = useAuth();
    const queryClient = useQueryClient();

    const loadConversationType = async (
        localType: 'direct' | 'group' | 'agent',
        remoteType: 'private' | 'group' | 'agent'
    ) => {
        if (!user?.uuid) return [];

        webLogger.debug('conversations', 'Loading conversation list', {
            ownerUuid: user.uuid,
            localType,
            remoteType,
        });

        await webDatabaseManager.initialize();

        let localConversations = await webDatabaseManager.getConversationsByType(localType, user.uuid);
        webLogger.debug('conversations', 'Loaded local conversations', {
            ownerUuid: user.uuid,
            localType,
            count: localConversations.length,
        });

        // Hard fallback: if local DB is empty, populate it immediately from API before returning.
        if (localConversations.length === 0) {
            try {
                webLogger.warn('conversations', 'Local conversations empty, bootstrapping from sync', {
                    ownerUuid: user.uuid,
                    localType,
                    remoteType,
                });
                await syncConversationsByType(user.uuid, remoteType);
                localConversations = await webDatabaseManager.getConversationsByType(localType, user.uuid);
                webLogger.info('conversations', 'Reloaded local conversations after sync', {
                    ownerUuid: user.uuid,
                    localType,
                    count: localConversations.length,
                });
            } catch (error) {
                webLogger.error('conversations', `Failed to bootstrap ${remoteType} conversations from API`, {
                    ownerUuid: user.uuid,
                    localType,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Final safety net: render straight from API if local persistence failed or is still empty.
        if (localConversations.length === 0) {
            try {
                webLogger.warn('conversations', 'Local conversations still empty, using direct API fallback', {
                    ownerUuid: user.uuid,
                    localType,
                    remoteType,
                });
                const endpoint =
                    remoteType === 'private'
                        ? '/messaging/conversations/private/'
                        : remoteType === 'group'
                            ? '/messaging/conversations/groups/'
                            : '/messaging/conversations/agents/';
                const apiConversations = await fetchAllPages(endpoint);
                const normalizedApiConversations = apiConversations.map((conversation) => ({
                    ...conversation,
                    conversation_type: localType,
                }));

                try {
                    await webDatabaseManager.upsertConversations(
                        normalizedApiConversations as Record<string, unknown>[],
                        user.uuid
                    );
                } catch (persistError) {
                    webLogger.error('conversations', `Failed to persist ${remoteType} conversations locally after direct API fetch`, {
                        ownerUuid: user.uuid,
                        localType,
                        error: persistError instanceof Error ? persistError.message : String(persistError),
                    });
                }

                webLogger.info('conversations', 'Returning conversations from direct API fallback', {
                    ownerUuid: user.uuid,
                    localType,
                    count: normalizedApiConversations.length,
                });

                return normalizedApiConversations
                    .map((conv) => enrichConversation(conv as unknown as Conversation))
                    .sort(compareConversationsByMobileOrder);
            } catch (apiError) {
                webLogger.error('conversations', `Direct API fallback failed for ${remoteType} conversations`, {
                    ownerUuid: user.uuid,
                    localType,
                    error: apiError instanceof Error ? apiError.message : String(apiError),
                });
            }
        }

        webLogger.info('conversations', 'Returning conversations from local database', {
            ownerUuid: user.uuid,
            localType,
            count: localConversations.length,
        });

        return localConversations
            .map((conv) => enrichConversation(conv as unknown as Conversation))
            .sort(compareConversationsByMobileOrder);
    };

    const privateQuery = useQuery({
        queryKey: ['conversations', 'private'],
        queryFn: async () => loadConversationType('direct', 'private'),
        enabled: isLoggedIn && !!user?.uuid,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });

    const groupQuery = useQuery({
        queryKey: ['conversations', 'groups'],
        queryFn: async () => loadConversationType('group', 'group'),
        enabled: isLoggedIn && !!user?.uuid,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });

    const agentQuery = useQuery({
        queryKey: ['conversations', 'agents'],
        queryFn: async () => loadConversationType('agent', 'agent'),
        enabled: isLoggedIn && !!user?.uuid,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (!isLoggedIn || !user?.uuid) return;

        let cancelled = false;

        const syncAll = async () => {
            const existingSync = backgroundConversationSyncInFlight.get(user.uuid);
            if (existingSync) {
                webLogger.debug('conversations', 'Reusing shared background conversations sync', {
                    ownerUuid: user.uuid,
                });
                await existingSync;
                return;
            }

            const syncPromise = (async () => {
                webLogger.info('conversations', 'Starting shared background conversations sync', {
                    ownerUuid: user.uuid,
                });
                const syncJobs: Array<Promise<unknown>> = [
                    syncConversationsByType(user.uuid, 'private'),
                    syncConversationsByType(user.uuid, 'group'),
                    syncConversationsByType(user.uuid, 'agent'),
                ];

                const results = await Promise.allSettled(syncJobs);
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        const type = ['private', 'group', 'agent'][index];
                        webLogger.error('conversations', `Failed to sync ${type} conversations locally`, {
                            ownerUuid: user.uuid,
                            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                        });
                    }
                });
            })().finally(() => {
                backgroundConversationSyncInFlight.delete(user.uuid);
            });

            backgroundConversationSyncInFlight.set(user.uuid, syncPromise);
            await syncPromise;

            if (!cancelled) {
                webLogger.debug('conversations', 'Invalidating conversation queries after shared sync', {
                    ownerUuid: user.uuid,
                });
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['conversations', 'private'] }),
                    queryClient.invalidateQueries({ queryKey: ['conversations', 'groups'] }),
                    queryClient.invalidateQueries({ queryKey: ['conversations', 'agents'] }),
                ]);
            }
        };

        syncAll();

        return () => {
            cancelled = true;
        };
    }, [isLoggedIn, queryClient, user?.uuid]);

    const refreshAll = async () => {
        if (!user?.uuid) return;

        webLogger.info('conversations', 'Manual refresh requested', {
            ownerUuid: user.uuid,
        });

        await Promise.allSettled([
            syncConversationsByType(user.uuid, 'private'),
            syncConversationsByType(user.uuid, 'group'),
            syncConversationsByType(user.uuid, 'agent'),
        ]);

        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['conversations', 'private'] }),
            queryClient.invalidateQueries({ queryKey: ['conversations', 'groups'] }),
            queryClient.invalidateQueries({ queryKey: ['conversations', 'agents'] }),
        ]);
    };

    return {
        privateConversations: privateQuery.data ?? [],
        groupConversations: groupQuery.data ?? [],
        agentConversations: agentQuery.data ?? [],
        isLoading: privateQuery.isLoading || groupQuery.isLoading || agentQuery.isLoading,
        isRefetching: privateQuery.isRefetching || groupQuery.isRefetching || agentQuery.isRefetching,
        error: privateQuery.error || groupQuery.error || agentQuery.error,
        refreshAll,
    };
}
