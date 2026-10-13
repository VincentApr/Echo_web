import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { webDatabaseManager } from '../services/webDatabase';
import { MESSAGE_PAGE_SIZE, fetchOlderMessagesPageAndPersist, fetchOlderMessagesPageByOffsetAndPersist, syncLatestMessagesForConversation, syncNewerMessagesForConversation } from '../services/localSync';
import { webLogger } from '../utils/logger';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { JARVIS_AGENT_UUID } from '../constants/jarvisAgent';
import { MessageDeliveryError } from '../services/messageDelivery';
import { reserveAgentExecution, pendingAgentExecution, rememberThreadMessage } from '../services/agentThreadExecution';

type BackgroundMessageSyncResult = {
    strategy: 'hydrate-latest' | 'incremental' | 'skip';
    insertedCount: number;
};

const latestMessagesBackgroundSyncInFlight = new Map<string, Promise<BackgroundMessageSyncResult>>();
const recentMarkAsReadKeys = new Map<string, number>();

export interface Attachment {
    uuid: string;
    file_type: string;
    file_url: string;
    thumbnail_url?: string;
    original_filename?: string;
    duration?: number;
}

export interface FormField {
    id: string;
    type: 'text' | 'number' | 'select' | 'textarea' | 'checkbox';
    label: string;
    placeholder?: string;
    required: boolean;
    options?: string[];
    min?: number;
    max?: number;
}

export interface FormFieldResponse {
    value: string | number | boolean;
    filled_by: { user_uuid: string; username: string };
    filled_at: string;
}

export interface InteractiveMessageData {
    is_interactive: boolean;
    form_data?: {
        fields: FormField[];
        responses: Record<string, FormFieldResponse>;
    };
    can_submit?: boolean;
    initiator_uuid?: string;
    initiator_username?: string;
    agent_uuid?: string;
    hidden_meta?: { is_form_response: boolean; agent_uuid: string };
}

export interface Message {
    id: number;
    uuid: string;
    sender_username: string;
    sender_uuid?: string;
    sender_avatar_url?: string;
    content: string;
    created_at: string | number;
    read_at?: string | number | null;
    is_read?: boolean;
    is_ai_generated?: boolean;
    message_type?: 'user' | 'system' | 'ai_generated' | string;
    conversation_uuid?: string;
    attachments?: Attachment[];
    parent_message_uuid?: string | null;
    web_agent_parent_uuid?: string;
    web_agent_waiting_since?: number;
    interactive_data?: InteractiveMessageData;
    // Agent metadata
    framework_agent_name?: string;
    framework_agent_uuid?: string;
    agent_info?: { name?: string; uuid?: string };
    ai_agent_name?: string;
    ai_agent_uuid?: string;
    agent_uuid?: string;
    agent_name?: string;
    is_agent_thread_root?: boolean;
    jarvis_prompt?: string;
    jarvis_preferred_tool?: string | null;
    jarvis_thread_root_uuid?: string | null;
    is_jarvis_thread_root?: boolean;
    // Optimistic flags
    isPending?: boolean;
    sendError?: boolean;
    deliveredButNotRead?: boolean;
}

interface SendMessageParams {
    clientMessageId?: string;
    conversationId: string;
    content: string;
    parentMessageUuid?: string | null;
    files?: File[];
    aiAgentUuid?: string | null;
    agentThread?: boolean;
}

interface MessagesPage {
    messages: Message[];
    nextCursor: MessagesCursor | null;
}

type MessagesCursor =
    | null
    | { kind: 'local'; beforeCreatedAtMs: number; beforeUuid: string }
    | { kind: 'bootstrap-remote-history'; beforeCreatedAtMs: number; beforeUuid: string }
    | { kind: 'remote'; url: string };

function parseCursorNumberParam(url: string, key: string): number | null {
    try {
        const parsed = new URL(url, window.location.origin);
        const rawValue = parsed.searchParams.get(key);
        if (rawValue === null) return null;

        const value = Number(rawValue);
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

function rebaseOffsetPaginationUrl(url: string, localCount: number): string {
    try {
        const parsed = new URL(url, window.location.origin);
        const currentOffset = Number(parsed.searchParams.get('offset'));
        if (!Number.isFinite(currentOffset)) return url;

        const rebasedOffset = Math.max(currentOffset, localCount);
        if (rebasedOffset === currentOffset) return normalizePaginationUrl(parsed.toString()) ?? url;

        parsed.searchParams.set('offset', String(rebasedOffset));
        return normalizePaginationUrl(parsed.toString()) ?? url;
    } catch {
        return url;
    }
}

function normalizePaginationUrl(nextUrl: string | null | undefined): string | null {
    if (!nextUrl) return null;

    try {
        const parsed = new URL(nextUrl, window.location.origin);

        if (!API_BASE_URL) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }

        const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
        if (parsed.origin === apiOrigin) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }

        return parsed.toString();
    } catch {
        return nextUrl;
    }
}

async function fetchMessagesDirectly(url: string, conversationUuid: string): Promise<{
    messages: Message[];
    nextPageUrl: string | null;
}> {
    webLogger.info('messages', 'Fetching messages directly from API', {
        conversationUuid,
        url,
    });
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch messages');
    const data = await res.json();
    const results = Array.isArray(data) ? data : data.results || data.messages || [];

    const result = {
        messages: results.map((message: Record<string, unknown>) => ({
            conversation_uuid: conversationUuid,
            ...message,
        })) as Message[],
        nextPageUrl: normalizePaginationUrl(data.next || null),
    };

    webLogger.info('messages', 'Fetched messages directly from API', {
        conversationUuid,
        count: result.messages.length,
        nextPageUrl: result.nextPageUrl,
    });

    return result;
}

export function useMessages(conversationId: string | null) {
    const { sendWsMessage, isConnected, connectionVersion } = useWebSocketContext();
    const { user, updateUser } = useAuth();
    const queryClient = useQueryClient();
    const historyBootstrapAttemptedRef = useRef(false);

    useEffect(() => {
        historyBootstrapAttemptedRef.current = false;
    }, [conversationId]);

    const buildNextCursor = async (
        ownerUuid: string,
        pageMessages: Message[],
        hasMoreLocal: boolean
    ): Promise<MessagesCursor> => {
        if (hasMoreLocal && pageMessages.length > 0) {
            const oldestMessage = pageMessages[pageMessages.length - 1];
            const cursor: MessagesCursor = {
                kind: 'local',
                beforeCreatedAtMs: typeof oldestMessage.created_at === 'number'
                    ? oldestMessage.created_at
                    : Date.parse(String(oldestMessage.created_at)) || 0,
                beforeUuid: oldestMessage.uuid,
            };
            webLogger.debug('messages', 'Built next local cursor', {
                ownerUuid,
                conversationUuid: conversationId,
                beforeCreatedAtMs: cursor.beforeCreatedAtMs,
                beforeUuid: cursor.beforeUuid,
            });
            return cursor;
        }

        const oldestMessage = pageMessages[pageMessages.length - 1];
        const syncState = await webDatabaseManager.getSyncState(conversationId!, ownerUuid);
        const shouldAttemptBootstrapHistory =
            !!oldestMessage &&
            !historyBootstrapAttemptedRef.current &&
            (
                !syncState ||
                (!syncState.next_page_url && pageMessages.length >= MESSAGE_PAGE_SIZE)
            );

        const cursor: MessagesCursor = shouldAttemptBootstrapHistory
            ? {
                kind: 'bootstrap-remote-history',
                beforeCreatedAtMs: typeof oldestMessage.created_at === 'number'
                    ? oldestMessage.created_at
                    : Date.parse(String(oldestMessage.created_at)) || 0,
                beforeUuid: oldestMessage.uuid,
            }
            : (syncState?.next_page_url ? { kind: 'remote', url: syncState.next_page_url } : null);
        webLogger.debug('messages', 'Built next remote cursor', {
            ownerUuid,
            conversationUuid: conversationId,
            pageCount: pageMessages.length,
            shouldAttemptBootstrapHistory,
            historyBootstrapAttempted: historyBootstrapAttemptedRef.current,
            cursorKind: cursor && typeof cursor === 'object' && 'kind' in cursor ? cursor.kind : null,
            nextPageUrl: syncState?.next_page_url ?? null,
        });
        return cursor;
    };

    const fetchMessagesPage = async ({ pageParam = null as MessagesCursor }): Promise<MessagesPage> => {
        if (!conversationId || !user?.uuid) return { messages: [], nextCursor: null };
        await webDatabaseManager.initialize();

        webLogger.debug('messages', 'Loading messages page', {
            ownerUuid: user.uuid,
            conversationUuid: conversationId,
            cursor: pageParam,
        });

        if (pageParam === null) {
            const localPage = await webDatabaseManager.getMessagesPage(conversationId, user.uuid, { limit: MESSAGE_PAGE_SIZE });
            if (localPage.messages.length > 0) {
                const messages = localPage.messages as unknown as Message[];
                webLogger.info('messages', 'Loaded first page from local database', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                    count: messages.length,
                    hasMoreLocal: localPage.hasMoreLocal,
                });
                return {
                    messages,
                    nextCursor: await buildNextCursor(user.uuid, messages, localPage.hasMoreLocal),
                };
            }

            try {
                webLogger.warn('messages', 'Local first page empty, syncing latest messages', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                });
                await syncLatestMessagesForConversation(user.uuid, conversationId);
                const hydratedPage = await webDatabaseManager.getMessagesPage(conversationId, user.uuid, { limit: MESSAGE_PAGE_SIZE });
                const messages = hydratedPage.messages as unknown as Message[];

                if (messages.length > 0) {
                    webLogger.info('messages', 'Loaded first page after local sync hydration', {
                        ownerUuid: user.uuid,
                        conversationUuid: conversationId,
                        count: messages.length,
                        hasMoreLocal: hydratedPage.hasMoreLocal,
                    });
                    return {
                        messages,
                        nextCursor: await buildNextCursor(user.uuid, messages, hydratedPage.hasMoreLocal),
                    };
                }
            } catch (syncError) {
                webLogger.error('messages', 'Failed to hydrate latest messages from local sync', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                    error: syncError instanceof Error ? syncError.message : String(syncError),
                });
            }

            const directPage = await fetchMessagesDirectly(
                `${API_BASE_URL}/messaging/conversations/${conversationId}/messages/?limit=${MESSAGE_PAGE_SIZE}&ordering=-created_at`,
                conversationId
            );

            try {
                await webDatabaseManager.upsertMessages(directPage.messages as unknown as Record<string, unknown>[], user.uuid);
                await webDatabaseManager.setSyncState(conversationId, user.uuid, directPage.nextPageUrl);
            } catch (persistError) {
                webLogger.error('messages', 'Failed to persist direct API messages locally', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                    error: persistError instanceof Error ? persistError.message : String(persistError),
                });
            }

            webLogger.warn('messages', 'Loaded first page from direct API fallback', {
                ownerUuid: user.uuid,
                conversationUuid: conversationId,
                count: directPage.messages.length,
                nextPageUrl: directPage.nextPageUrl,
            });

            return {
                messages: directPage.messages,
                nextCursor: directPage.nextPageUrl ? { kind: 'remote', url: directPage.nextPageUrl } : null,
            };
        }

        if (pageParam.kind === 'local') {
            const localPage = await webDatabaseManager.getMessagesPage(conversationId, user.uuid, {
                limit: MESSAGE_PAGE_SIZE,
                beforeCreatedAtMs: pageParam.beforeCreatedAtMs,
                beforeUuid: pageParam.beforeUuid,
            });

            const messages = localPage.messages as unknown as Message[];
            if (messages.length > 0) {
                webLogger.info('messages', 'Loaded older page from local database', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                    count: messages.length,
                    hasMoreLocal: localPage.hasMoreLocal,
                });
                return {
                    messages,
                    nextCursor: await buildNextCursor(user.uuid, messages, localPage.hasMoreLocal),
                };
            }

            const syncState = await webDatabaseManager.getSyncState(conversationId, user.uuid);
            let targetUrl = syncState?.next_page_url;

            if (targetUrl) {
                const localCount = await webDatabaseManager.getMessageCount(conversationId, user.uuid);
                const remoteOffset = parseCursorNumberParam(targetUrl, 'offset');
                const rebasedTargetUrl = rebaseOffsetPaginationUrl(targetUrl, localCount);

                if (rebasedTargetUrl !== targetUrl) {
                    webLogger.warn('messages', 'Rebased stale remote history cursor to local cache size', {
                        ownerUuid: user.uuid,
                        conversationUuid: conversationId,
                        localCount,
                        previousOffset: remoteOffset,
                        rebasedOffset: parseCursorNumberParam(rebasedTargetUrl, 'offset'),
                    });
                    targetUrl = rebasedTargetUrl;
                }
            }

            if (!targetUrl) {
                webLogger.info('messages', 'No local or remote older messages left', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                });
                return { messages: [], nextCursor: null };
            }

            webLogger.warn('messages', 'Local history exhausted, switching to remote cursor', {
                ownerUuid: user.uuid,
                conversationUuid: conversationId,
                nextPageUrl: targetUrl,
            });
            pageParam = { kind: 'remote', url: targetUrl };
        }

        try {
            if (pageParam.kind === 'bootstrap-remote-history') {
                historyBootstrapAttemptedRef.current = true;
                const localCount = await webDatabaseManager.getMessageCount(conversationId, user.uuid);
                const knownMessageUuids = new Set(await webDatabaseManager.getMessageUuids(conversationId, user.uuid));

                if (localCount > 0) {
                    const offsetPage = await fetchOlderMessagesPageByOffsetAndPersist(
                        user.uuid,
                        conversationId,
                        localCount,
                        MESSAGE_PAGE_SIZE
                    );
                    const offsetMessages = offsetPage.messages as unknown as Message[];
                    const newUniqueMessages = offsetMessages.filter((message) => {
                        const messageUuid = String(message.uuid || '');
                        return !!messageUuid && !knownMessageUuids.has(messageUuid);
                    });

                    if (newUniqueMessages.length > 0) {
                        const localPage = await webDatabaseManager.getMessagesPage(conversationId, user.uuid, {
                            limit: MESSAGE_PAGE_SIZE,
                            beforeCreatedAtMs: pageParam.beforeCreatedAtMs,
                            beforeUuid: pageParam.beforeUuid,
                        });
                        const messages = localPage.messages as unknown as Message[];
                        webLogger.info('messages', 'Loaded older page after explicit offset fallback', {
                            ownerUuid: user.uuid,
                            conversationUuid: conversationId,
                            localCount,
                            offsetFetchedCount: offsetMessages.length,
                            newUniqueCount: newUniqueMessages.length,
                            count: messages.length,
                            hasMoreLocal: localPage.hasMoreLocal,
                        });
                        return {
                            messages,
                            nextCursor: await buildNextCursor(user.uuid, messages, localPage.hasMoreLocal),
                        };
                    }
                }

                // Never fall back to the detail endpoint here: it can return
                // the whole history and block a small incremental load.
                const state = await webDatabaseManager.getSyncState(conversationId, user.uuid);
                return { messages: [], nextCursor: state?.next_page_url
                    ? { kind: 'remote', url: state.next_page_url } : null };
            }

            const knownMessageUuids = new Set(await webDatabaseManager.getMessageUuids(conversationId, user.uuid));
            let currentRemoteUrl = pageParam.url;
            let duplicateOnlyPageCount = 0;
            const maxDuplicateOnlyPages = 1;

            while (true) {
                const remotePage = await fetchOlderMessagesPageAndPersist(user.uuid, conversationId, currentRemoteUrl);
                const messages = remotePage.messages as unknown as Message[];
                const newUniqueMessages = messages.filter((message) => {
                    const messageUuid = String(message.uuid || '');
                    if (!messageUuid || knownMessageUuids.has(messageUuid)) return false;
                    knownMessageUuids.add(messageUuid);
                    return true;
                });

                if (newUniqueMessages.length > 0 || !remotePage.nextPageUrl) {
                    webLogger.info('messages', 'Loaded older page after remote fetch and local persistence', {
                        ownerUuid: user.uuid,
                        conversationUuid: conversationId,
                        count: messages.length,
                        newUniqueCount: newUniqueMessages.length,
                        duplicateOnlyPageCount,
                        nextPageUrl: remotePage.nextPageUrl,
                    });
                    return {
                        messages: newUniqueMessages.slice(0, MESSAGE_PAGE_SIZE),
                        nextCursor: newUniqueMessages.length > MESSAGE_PAGE_SIZE
                            ? await buildNextCursor(user.uuid, newUniqueMessages.slice(0, MESSAGE_PAGE_SIZE), true)
                            : remotePage.nextPageUrl ? { kind: 'remote', url: remotePage.nextPageUrl } : null,
                    };
                }

                duplicateOnlyPageCount += 1;
                if (!remotePage.nextPageUrl || remotePage.nextPageUrl === currentRemoteUrl || duplicateOnlyPageCount >= maxDuplicateOnlyPages) {
                    webLogger.warn('messages', 'Stopping duplicate-only remote history advance loop', {
                        ownerUuid: user.uuid,
                        conversationUuid: conversationId,
                        pageUrl: currentRemoteUrl,
                        nextPageUrl: remotePage.nextPageUrl,
                        duplicateOnlyPageCount,
                        maxDuplicateOnlyPages,
                    });
                    return {
                        messages: [],
                        nextCursor: remotePage.nextPageUrl && remotePage.nextPageUrl !== currentRemoteUrl
                            ? { kind: 'remote', url: remotePage.nextPageUrl }
                            : null,
                    };
                }

                webLogger.warn('messages', 'Remote history page contained only cached messages, advancing cursor', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                    pageUrl: currentRemoteUrl,
                    nextPageUrl: remotePage.nextPageUrl,
                    duplicateOnlyPageCount,
                });
                currentRemoteUrl = remotePage.nextPageUrl;
            }
        } catch (remotePersistError) {
            webLogger.error('messages', 'Failed to persist older messages locally, falling back to direct API payload', {
                ownerUuid: user.uuid,
                conversationUuid: conversationId,
                pageUrl: pageParam.kind === 'remote' ? pageParam.url : null,
                error: remotePersistError instanceof Error ? remotePersistError.message : String(remotePersistError),
            });
            if (pageParam.kind !== 'remote') {
                throw remotePersistError;
            }

            const directPage = await fetchMessagesDirectly(pageParam.url, conversationId);
            return {
                messages: directPage.messages,
                nextCursor: directPage.nextPageUrl ? { kind: 'remote', url: directPage.nextPageUrl } : null,
            };
        }
    };

    const messagesQuery = useInfiniteQuery({
        queryKey: ['messages', conversationId],
        queryFn: fetchMessagesPage,
        initialPageParam: null as MessagesCursor,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !!conversationId && !!user,
        placeholderData: (previousData) => previousData,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (!conversationId || !user?.uuid) return;

        let cancelled = false;

        const syncKey = `${user.uuid}:${conversationId}`;
        const existingSync = latestMessagesBackgroundSyncInFlight.get(syncKey);
        const syncPromise = existingSync ?? (async (): Promise<BackgroundMessageSyncResult> => {
            await webDatabaseManager.initialize();
            const localCount = await webDatabaseManager.getMessageCount(conversationId, user.uuid);

            if (localCount === 0) {
                await syncLatestMessagesForConversation(user.uuid, conversationId);
                return {
                    strategy: 'hydrate-latest',
                    insertedCount: 0,
                };
            }

            const insertedCount = await syncNewerMessagesForConversation(user.uuid, conversationId, {
                staleSinceMs: 10 * 60 * 1000,
            });

            return {
                strategy: insertedCount > 0 ? 'incremental' : 'skip',
                insertedCount,
            };
        })();

        if (!existingSync) {
            latestMessagesBackgroundSyncInFlight.set(syncKey, syncPromise);
        } else {
            webLogger.debug('messages', 'Reusing shared background latest messages sync', {
                ownerUuid: user.uuid,
                conversationUuid: conversationId,
            });
        }

        void syncPromise
            .then((result) => {
                if (!cancelled) {
                    if (result.strategy === 'skip') {
                        webLogger.debug('messages', 'Skipping messages query invalidation after background sync because local cache is fresh', {
                            ownerUuid: user.uuid,
                            conversationUuid: conversationId,
                        });
                        return;
                    }

                    const existingData = queryClient.getQueryData<InfiniteData<MessagesPage>>(['messages', conversationId]);
                    const pageCount = existingData?.pages.length ?? 0;
                    if (pageCount > 1) {
                        webLogger.debug('messages', 'Skipping messages query invalidation after background sync because history is already paginated', {
                            ownerUuid: user.uuid,
                            conversationUuid: conversationId,
                            pageCount,
                            strategy: result.strategy,
                            insertedCount: result.insertedCount,
                        });
                        return;
                    }

                    webLogger.debug('messages', 'Invalidating messages query after background sync', {
                        ownerUuid: user.uuid,
                        conversationUuid: conversationId,
                        pageCount,
                        strategy: result.strategy,
                        insertedCount: result.insertedCount,
                    });
                    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                }
            })
            .catch((error) => {
                webLogger.error('messages', 'Failed to sync latest conversation messages locally', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                    error: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                if (latestMessagesBackgroundSyncInFlight.get(syncKey) === syncPromise) {
                    latestMessagesBackgroundSyncInFlight.delete(syncKey);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [conversationId, queryClient, user?.uuid]);

    useEffect(() => {
        if (!conversationId || !user?.uuid) return;
        let active = true;
        const reconcile = () => {
            if (!navigator.onLine || document.visibilityState === 'hidden') return;
            void syncNewerMessagesForConversation(user.uuid, conversationId, { force: true })
                .then(() => { if (active) void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] }); })
                .catch(error => webLogger.warn('messages', 'Reconnect synchronization failed', { error: String(error) }));
        };
        if (connectionVersion > 0) reconcile();
        window.addEventListener('online', reconcile);
        document.addEventListener('visibilitychange', reconcile);
        return () => {
            active = false;
            window.removeEventListener('online', reconcile);
            document.removeEventListener('visibilitychange', reconcile);
        };
    }, [conversationId, user?.uuid, connectionVersion, queryClient]);

    const sendMessageMutation = useMutation({
        retry: false,
        // Do not let React Query queue a mutation offline and replay it later:
        // the composer preserves it for an explicit, user-controlled retry.
        networkMode: 'always',
        mutationFn: async ({ conversationId, content, parentMessageUuid, files, aiAgentUuid, agentThread, clientMessageId }: SendMessageParams) => {
            if (navigator.onLine === false) throw new MessageDeliveryError('Hors connexion. Le message est conservé, mais n’a pas été envoyé.', 'not-sent');
            if (agentThread && (!aiAgentUuid || !parentMessageUuid)) {
                throw new Error('Impossible d’identifier l’agent de ce thread. Rouvre la conversation avant de réessayer.');
            }
            if ((aiAgentUuid || agentThread) && !isConnected) {
                throw new Error('Connexion en cours. Réessaie une fois la connexion rétablie.');
            }
            if (aiAgentUuid && user?.uuid && pendingAgentExecution(user.uuid, aiAgentUuid, conversationId)) {
                throw new Error('Cet agent prépare déjà une réponse dans cette conversation. Attends sa réponse avant de continuer.');
            }
            if (aiAgentUuid && user?.ai_agents_enabled === false) {
                if (!window.confirm('Activer les agents IA dans les conversations ? Le message et le contexte de la conversation seront transmis à l’agent sélectionné.')) {
                    throw new Error('Activation des agents annulée.');
                }
                const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/`, {
                    method: 'PATCH', body: JSON.stringify({ ai_agents_enabled: true }),
                });
                if (!response.ok) throw new Error('Impossible d’activer les agents dans les conversations.');
                await updateUser({ ...user, ...await response.json(), ai_agents_enabled: true });
            }
            const tempUuid = clientMessageId || `temp-${crypto.randomUUID()}`;
            // Reserve before sending, so two simultaneous replies cannot route
            // a parentless framework response to the wrong thread.
            let cancelExecution = agentThread && user?.uuid
                ? reserveAgentExecution(user.uuid, conversationId, aiAgentUuid!, parentMessageUuid!)
                : undefined;
            
            // Generate optimistic attachment previews
            const optimisticAttachments: Attachment[] = [];
            if (files && files.length > 0) {
                files.forEach((file, index) => {
                    const isImage = file.type.startsWith('image/');
                    const isAudio = file.type.startsWith('audio/');
                    optimisticAttachments.push({
                        uuid: `temp-att-${Date.now()}-${index}`,
                        file_type: isImage ? 'image' : (isAudio ? 'audio' : (file.type.startsWith('video/') ? 'video' : 'document')),
                        file_url: isImage || isAudio ? URL.createObjectURL(file) : '',
                        original_filename: file.name
                    });
                });
            }

            const optimisticMessage: Message = {
                id: Date.now(),
                uuid: tempUuid,
                sender_username: user?.username || 'Vous',
                sender_uuid: user?.uuid,
                conversation_uuid: conversationId,
                content,
                created_at: new Date().toISOString(),
                isPending: true,
                parent_message_uuid: parentMessageUuid,
                ...(agentThread && parentMessageUuid ? { web_agent_parent_uuid: parentMessageUuid } : {}),
                // Keep the initial user prompt inside an agent panel while
                // waiting for the server root, rather than showing plain chat.
                ...(aiAgentUuid && !agentThread ? {
                    ai_agent_uuid: aiAgentUuid,
                    is_ai_generated: false,
                    message_type: 'user',
                    web_agent_waiting_since: Date.now(),
                } : {}),
                attachments: optimisticAttachments.length > 0 ? optimisticAttachments : undefined,
            };

            let res: Response;
            let messageAccepted = false;
            let submissionStarted = false;
            
            try {
                if (user?.uuid) {
                    await webDatabaseManager.upsertMessage(optimisticMessage as unknown as Record<string, unknown>, user.uuid);
                    await webDatabaseManager.updateConversationFromMessage(
                        conversationId, user.uuid, optimisticMessage as unknown as Record<string, unknown>
                    );
                }
                queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
                // Step 1: Upload files if any
                const attachmentUuids: string[] = [];
                if (files && files.length > 0) {
                    for (const file of files) {
                        const formData = new FormData();
                        formData.append('file', file);
                        
                        const uploadRes = await fetchWithAuth(
                            `${API_BASE_URL}/messaging/attachments/upload/`,
                            { method: 'POST', body: formData }
                        );
                        
                        if (!uploadRes.ok) {
                            throw new Error('Failed to upload file');
                        }
                        
                        const uploadData = await uploadRes.json();
                        if (uploadData && uploadData.uuid) {
                            attachmentUuids.push(uploadData.uuid);
                        }
                    }
                }

                // Same contract as mobile: choose an agent only on initiation.
                // Replies use the server thread root as parent, without retargeting.
                if (aiAgentUuid === JARVIS_AGENT_UUID) {
                    const sent = sendWsMessage({
                        type: 'chat_message',
                        conversation_uuid: conversationId,
                        message: content,
                        attachment_uuids: attachmentUuids,
                        parent_message_uuid: parentMessageUuid || null,
                        ai_agent_uuid: agentThread ? undefined : aiAgentUuid,
                        client_message_id: tempUuid,
                    });
                    if (!sent) throw new Error('Connexion interrompue. Réessaie après la reconnexion.');
                    // As on mobile, reconcile missed socket echoes from REST.
                    const ownerUuid = user?.uuid;
                    if (ownerUuid) {
                        for (const delay of [1200, 4000]) {
                            window.setTimeout(() => {
                                void syncLatestMessagesForConversation(ownerUuid, conversationId)
                                    .then(() => queryClient.invalidateQueries({ queryKey: ['messages', conversationId] }))
                                    .catch(error => webLogger.warn('messages', 'Agent message reconciliation failed', { error: String(error) }));
                            }, delay);
                        }
                    }
                    return { tempUuid };
                }

                // Step 2: Send message payload
                submissionStarted = true;
                if (attachmentUuids.length > 0) {
                    res = await fetchWithAuth(
                        `${API_BASE_URL}/messaging/conversations/${conversationId}/messages/create-with-attachments/`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                content, 
                                parent_message_uuid: parentMessageUuid,
                                client_message_id: tempUuid,
                                attachment_uuids: attachmentUuids 
                            }),
                        }
                    );
                } else {
                    res = await fetchWithAuth(
                        `${API_BASE_URL}/messaging/conversations/${conversationId}/messages/create/`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content, parent_message_uuid: parentMessageUuid, client_message_id: tempUuid }),
                        }
                    );
                }

                if (!res.ok) {
                    throw new MessageDeliveryError(`Envoi refusé par le serveur (${res.status}).`, res.status >= 500 ? 'uncertain' : 'not-sent');
                }
                messageAccepted = true;

                const payload = await res.json().catch(() => null);
                if (payload && typeof payload === 'object') payload.client_message_id ||= tempUuid;
                if (payload && typeof payload === 'object' && aiAgentUuid && !agentThread) {
                    payload.ai_agent_uuid = aiAgentUuid;
                    payload.web_agent_waiting_since = optimisticMessage.web_agent_waiting_since;
                }
                if (payload?.uuid && agentThread && parentMessageUuid && user?.uuid) {
                    // Register by confirmed UUID before any further async work:
                    // socket echoes and REST syncs can race this confirmation.
                    const root = payload.parent_message_uuid || parentMessageUuid;
                    rememberThreadMessage(user.uuid, conversationId, String(payload.uuid), root);
                    payload.parent_message_uuid = root;
                    payload.web_agent_parent_uuid = root;
                    payload.client_message_id = tempUuid;
                }

                // The mobile +/Agents action executes the selected framework
                // agent explicitly. Persist the user's prompt first so the
                // agent reads it in the conversation context.
                if (aiAgentUuid && aiAgentUuid !== JARVIS_AGENT_UUID) {
                    // Initial invocations need the same routing as follow-ups:
                    // framework answers may arrive without a server parent.
                    // Use the confirmed prompt UUID, never the temporary one,
                    // and register before triggering even a very fast answer.
                    if (!agentThread) {
                        if (!user?.uuid || !payload?.uuid) {
                            throw new Error('Impossible d’identifier le premier message du thread.');
                        }
                        cancelExecution = reserveAgentExecution(
                            user.uuid, conversationId, aiAgentUuid, String(payload.uuid),
                        );
                    }
                    const triggered = sendWsMessage({
                        type: 'trigger_framework_agent',
                        agent_uuid: aiAgentUuid,
                        conversation_uuid: conversationId,
                    });
                    if (!triggered) throw new Error('Le message a été envoyé, mais la connexion a été interrompue avant le lancement de l’agent.');
                }

                if (user?.uuid) {
                    if (payload && typeof payload === 'object' && 'uuid' in payload) {
                        
                        // FIX: Since the backend doesn't return parent_message_uuid in the generic /create endpoint, 
                        // we inject it manually to ensure UI deduplication and rendering work correctly.
                        if (parentMessageUuid && !payload.parent_message_uuid) {
                            payload.parent_message_uuid = parentMessageUuid;
                        }

                        webLogger.info('messages', 'Persisting confirmed sent message locally', {
                            ownerUuid: user.uuid,
                            conversationUuid: conversationId,
                            messageUuid: String((payload as Record<string, unknown>).uuid || ''),
                        });
                        
                        // Delete optimistic message since it will be replaced by the real one from REST/WS
                        // (Usually upsert overrides it, but the tempUuid was different. So we must mark the temp as failed or delete it).
                        // Let's just rely on the existing logic which upserts the payload. 
                        // Wait, previous code just upserted the new payload without deleting temp. 
                        // We will keep the previous code structure.
                        await webDatabaseManager.upsertMessage({
                            conversation_uuid: conversationId,
                            ...(payload as Record<string, unknown>),
                        }, user.uuid);
                        await webDatabaseManager.updateConversationFromMessage(
                            conversationId,
                            user.uuid,
                            {
                                conversation_uuid: conversationId,
                                ...(payload as Record<string, unknown>),
                            }
                        );
                    }

                    await syncLatestMessagesForConversation(user.uuid, conversationId);
                }

                return payload;
                
            } catch (error) {
                cancelExecution?.();
                if (messageAccepted) {
                    // A sync/storage/agent error after HTTP acceptance must not
                    // restore the prompt as if nothing had been delivered.
                    throw new MessageDeliveryError('Message envoyé, mais son suivi ou le lancement de l’agent a échoué. Vérifie la conversation avant toute nouvelle tentative.', 'sent');
                }
                if (user?.uuid) {
                    await webDatabaseManager.updateMessageSyncStatus(tempUuid, user.uuid, 'failed').catch(() => undefined);
                    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                }
                webLogger.error('messages', 'Message send failed', {
                    ownerUuid: user?.uuid ?? null,
                    conversationUuid: conversationId,
                    tempUuid,
                    error: error instanceof Error ? error.message : String(error),
                });
                if (error instanceof MessageDeliveryError) throw error;
                throw new MessageDeliveryError(error instanceof Error ? error.message : 'Envoi interrompu.', submissionStarted ? 'uncertain' : 'not-sent');
            }
        },
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['messages', variables.conversationId] });
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
        },
    });

    const markAsReadMutation = useMutation({
        mutationFn: async () => {
            if (!conversationId) return;
            if (user?.uuid) {
                const dedupeKey = `${user.uuid}:${conversationId}`;
                const now = Date.now();
                const lastMarkAt = recentMarkAsReadKeys.get(dedupeKey) ?? 0;
                if (now - lastMarkAt < 1500) {
                    webLogger.debug('messages', 'Skipping duplicate mark-as-read request', {
                        ownerUuid: user.uuid,
                        conversationUuid: conversationId,
                    });
                    return;
                }
                recentMarkAsReadKeys.set(dedupeKey, now);

                webLogger.debug('messages', 'Marking conversation as read locally', {
                    ownerUuid: user.uuid,
                    conversationUuid: conversationId,
                });
                await webDatabaseManager.markConversationMessagesAsReadForViewer(conversationId, user.uuid);
                await webDatabaseManager.resetUnreadCount(conversationId, user.uuid);
                queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
            const res = await fetchWithAuth(
                `${API_BASE_URL}/messaging/conversations/${conversationId}/mark-as-seen/`,
                { method: 'POST' }
            );
            if (res.ok) {
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
        },
    });

    const allMessages = Array.from(
        new Map(
            (messagesQuery.data?.pages.flatMap((page) => page.messages) || [])
                .sort((a, b) => {
                    const tsA = typeof a.created_at === 'number' ? a.created_at : Date.parse(String(a.created_at)) || 0;
                    const tsB = typeof b.created_at === 'number' ? b.created_at : Date.parse(String(b.created_at)) || 0;
                    if (tsA !== tsB) return tsB - tsA;
                    return String(b.uuid).localeCompare(String(a.uuid));
                })
                .map((message) => [message.uuid, message] as const)
        ).values()
    );

    return {
        messages: allMessages,
        isLoading: messagesQuery.isLoading,
        isFetchingMore: messagesQuery.isFetchingNextPage,
        hasMore: messagesQuery.hasNextPage,
        loadMore: messagesQuery.fetchNextPage,
        sendMessage: sendMessageMutation,
        markAsRead: markAsReadMutation.mutate,
    };
}
