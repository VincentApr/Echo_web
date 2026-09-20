import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { webDatabaseManager } from './webDatabase';
import { webLogger } from '../utils/logger';

const MAX_PAGES = 20;

type ConversationListType = 'private' | 'group' | 'agent';

type SyncMessagesResult = {
    messages: Record<string, unknown>[];
    nextPageUrl: string | null;
};

const conversationSyncInFlight = new Map<string, Promise<void>>();
const latestMessagesSyncInFlight = new Map<string, Promise<void>>();
const incrementalMessagesSyncInFlight = new Map<string, Promise<number>>();

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

function extractResultsAndNext(payload: unknown): { results: Record<string, unknown>[]; next: string | null } {
    if (Array.isArray(payload)) {
        return { results: payload as Record<string, unknown>[], next: null };
    }

    const objectPayload = payload as Record<string, unknown>;
    return {
        results: (objectPayload.results as Record<string, unknown>[]) || [],
        next: normalizePaginationUrl(objectPayload.next as string | null | undefined),
    };
}

function normalizeConversationTypeForStore(type: ConversationListType): 'direct' | 'group' | 'agent' {
    if (type === 'group') return 'group';
    if (type === 'agent') return 'agent';
    return 'direct';
}

function toEpochMs(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? (Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value)
            : 0;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return 0;

        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) {
            return Math.abs(asNumber) < 1_000_000_000_000 ? asNumber * 1000 : asNumber;
        }

        const parsed = Date.parse(trimmed);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

function getConversationEndpoint(type: ConversationListType): string {
    if (type === 'group') return '/messaging/conversations/groups/';
    if (type === 'agent') return '/messaging/conversations/agents/';
    return '/messaging/conversations/private/';
}

async function fetchAllPages(url: string): Promise<Record<string, unknown>[]> {
    const allResults: Record<string, unknown>[] = [];
    let nextUrl: string | null = url;
    let pageCount = 0;

    webLogger.debug('sync', 'Fetching paginated resource', { url });

    while (nextUrl && pageCount < MAX_PAGES) {
        const response = await fetchWithAuth(nextUrl);
        if (!response.ok) {
            webLogger.error('sync', 'Paginated fetch failed', {
                url: nextUrl,
                status: response.status,
            });
            throw new Error(`Failed to fetch paginated resource: ${response.status}`);
        }

        const payload = await response.json();
        const { results, next } = extractResultsAndNext(payload);
        allResults.push(...results);
        webLogger.debug('sync', 'Fetched paginated page', {
            url: nextUrl,
            pageIndex: pageCount,
            count: results.length,
            nextPageUrl: next,
        });
        nextUrl = next;
        pageCount += 1;
    }

    webLogger.info('sync', 'Completed paginated fetch', {
        url,
        pageCount,
        totalCount: allResults.length,
    });

    return allResults;
}

export async function syncConversationsByType(ownerUuid: string, type: ConversationListType): Promise<void> {
    const key = `${ownerUuid}:${type}`;
    const existingSync = conversationSyncInFlight.get(key);
    if (existingSync) {
        webLogger.debug('sync', 'Reusing in-flight conversations sync', { ownerUuid, type });
        return existingSync;
    }

    const syncPromise = (async () => {
        await webDatabaseManager.initialize();
        const endpoint = `${API_BASE_URL}${getConversationEndpoint(type)}`;
        webLogger.info('sync', 'Starting conversations sync', { ownerUuid, type, endpoint });
        const conversations = await fetchAllPages(endpoint);

        conversations.forEach((conversation) => {
            conversation.conversation_type = normalizeConversationTypeForStore(type);
        });

        await webDatabaseManager.upsertConversations(conversations, ownerUuid);
        await webDatabaseManager.deleteConversationsNotInSet(
            ownerUuid,
            normalizeConversationTypeForStore(type),
            new Set(conversations.map((conversation) => String(conversation.uuid || '')))
        );
        webLogger.info('sync', 'Completed conversations sync', {
            ownerUuid,
            type,
            count: conversations.length,
        });
    })().finally(() => {
        conversationSyncInFlight.delete(key);
    });

    conversationSyncInFlight.set(key, syncPromise);
    return syncPromise;
}

async function fetchMessagesPage(url: string): Promise<SyncMessagesResult> {
    webLogger.debug('sync', 'Fetching messages page', { url });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        webLogger.error('sync', 'Messages page fetch failed', {
            url,
            status: response.status,
        });
        throw new Error(`Failed to fetch messages page: ${response.status}`);
    }

    const payload = await response.json();
    const results = Array.isArray(payload)
        ? payload as Record<string, unknown>[]
        : ((payload.results as Record<string, unknown>[]) || (payload.messages as Record<string, unknown>[]) || []);

    const result = {
        messages: results,
        nextPageUrl: normalizePaginationUrl((payload as Record<string, unknown>).next as string | null | undefined),
    };

    webLogger.debug('sync', 'Fetched messages page', {
        url,
        count: result.messages.length,
        nextPageUrl: result.nextPageUrl,
    });

    return result;
}

export async function syncLatestMessagesForConversation(
    ownerUuid: string,
    conversationUuid: string,
    pageLimit: number = 50
): Promise<void> {
    const key = `${ownerUuid}:${conversationUuid}`;
    const existingSync = latestMessagesSyncInFlight.get(key);
    if (existingSync) {
        webLogger.debug('sync', 'Reusing in-flight latest messages sync', {
            ownerUuid,
            conversationUuid,
        });
        return existingSync;
    }

    const syncPromise = (async () => {
        await webDatabaseManager.initialize();

        const url = `${API_BASE_URL}/messaging/conversations/${conversationUuid}/messages/?limit=${pageLimit}&ordering=-created_at`;
        webLogger.info('sync', 'Starting latest messages sync', {
            ownerUuid,
            conversationUuid,
            url,
            pageLimit,
        });
        const { messages, nextPageUrl } = await fetchMessagesPage(url);
        const withConversationUuid = messages.map((message) => ({
            conversation_uuid: conversationUuid,
            ...message,
        }));

        await webDatabaseManager.upsertMessages(withConversationUuid, ownerUuid);
        
        // Fix: Only update the pagination 'next_page_url' if this is effectively the first page
        // of messages we've ever grabbed, otherwise we destroy the older history cursor!
        const checkPage = await webDatabaseManager.getMessagesPage(conversationUuid, ownerUuid, { limit: pageLimit + 1 });
        if (checkPage.messages.length <= pageLimit) {
            await webDatabaseManager.setSyncState(conversationUuid, ownerUuid, nextPageUrl);
        }
        
        webLogger.info('sync', 'Completed latest messages sync', {
            ownerUuid,
            conversationUuid,
            count: withConversationUuid.length,
            nextPageUrl,
            didOverwriteCursor: checkPage.messages.length <= pageLimit
        });
    })().finally(() => {
        latestMessagesSyncInFlight.delete(key);
    });

    latestMessagesSyncInFlight.set(key, syncPromise);
    return syncPromise;
}

export async function syncNewerMessagesForConversation(
    ownerUuid: string,
    conversationUuid: string,
    options?: {
        pageLimit?: number;
        staleSinceMs?: number;
        force?: boolean;
    }
): Promise<number> {
    const pageLimit = options?.pageLimit ?? 100;
    const staleSinceMs = options?.staleSinceMs ?? 10 * 60 * 1000;
    const force = options?.force ?? false;
    const key = `${ownerUuid}:${conversationUuid}`;

    const existingSync = incrementalMessagesSyncInFlight.get(key);
    if (existingSync) {
        webLogger.debug('sync', 'Reusing in-flight incremental messages sync', {
            ownerUuid,
            conversationUuid,
        });
        return existingSync;
    }

    const syncPromise = (async () => {
        await webDatabaseManager.initialize();

        const localCount = await webDatabaseManager.getMessageCount(conversationUuid, ownerUuid);
        const syncState = await webDatabaseManager.getSyncState(conversationUuid, ownerUuid);
        const lastSyncedAt = syncState?.updated_at_ms ?? 0;
        const newestLocalTimestamp = await webDatabaseManager.getNewestMessageTimestamp(conversationUuid, ownerUuid);
        const isFreshEnough = !force && lastSyncedAt > 0 && (Date.now() - lastSyncedAt) < staleSinceMs;

        if (localCount === 0 && !force) {
            webLogger.debug('sync', 'Skipping incremental messages sync because local cache is empty', {
                ownerUuid,
                conversationUuid,
            });
            return 0;
        }

        if (isFreshEnough) {
            webLogger.debug('sync', 'Skipping incremental messages sync because local cache is fresh', {
                ownerUuid,
                conversationUuid,
                lastSyncedAt,
                staleSinceMs,
            });
            return 0;
        }

        let url = `${API_BASE_URL}/messaging/conversations/${conversationUuid}/messages/?limit=${pageLimit}&ordering=-created_at`;
        if (newestLocalTimestamp) {
            const afterDate = new Date(newestLocalTimestamp + 1).toISOString();
            url += `&created_after=${encodeURIComponent(afterDate)}&created_at__gt=${encodeURIComponent(afterDate)}`;
        }

        webLogger.info('sync', 'Starting incremental messages sync', {
            ownerUuid,
            conversationUuid,
            url,
            pageLimit,
            newestLocalTimestamp,
            localCount,
        });

        const { messages } = await fetchMessagesPage(url);
        const knownMessageUuids = new Set(await webDatabaseManager.getMessageUuids(conversationUuid, ownerUuid));
        const trulyNewMessages = messages
            .filter((message) => {
                const uuid = String(message.uuid || '');
                if (!uuid || knownMessageUuids.has(uuid)) return false;
                if (newestLocalTimestamp) {
                    const createdAtMs = toEpochMs(message.created_at);
                    if (createdAtMs <= newestLocalTimestamp) return false;
                }
                return true;
            })
            .map((message) => ({
                conversation_uuid: conversationUuid,
                ...message,
            }));

        if (trulyNewMessages.length > 0) {
            await webDatabaseManager.upsertMessages(trulyNewMessages, ownerUuid);
        }

        await webDatabaseManager.setSyncState(
            conversationUuid,
            ownerUuid,
            syncState?.next_page_url ?? null
        );

        webLogger.info('sync', 'Completed incremental messages sync', {
            ownerUuid,
            conversationUuid,
            insertedCount: trulyNewMessages.length,
            localCountBeforeSync: localCount,
        });

        return trulyNewMessages.length;
    })().finally(() => {
        incrementalMessagesSyncInFlight.delete(key);
    });

    incrementalMessagesSyncInFlight.set(key, syncPromise);
    return syncPromise;
}

export async function fetchOlderMessagesPageAndPersist(
    ownerUuid: string,
    conversationUuid: string,
    pageUrl: string
): Promise<SyncMessagesResult> {
    await webDatabaseManager.initialize();
    webLogger.info('sync', 'Fetching older messages page', {
        ownerUuid,
        conversationUuid,
        pageUrl,
    });

    const { messages, nextPageUrl } = await fetchMessagesPage(pageUrl);
    const withConversationUuid = messages.map((message) => ({
        conversation_uuid: conversationUuid,
        ...message,
    }));

    await webDatabaseManager.upsertMessages(withConversationUuid, ownerUuid);
    await webDatabaseManager.setSyncState(conversationUuid, ownerUuid, nextPageUrl);

    webLogger.info('sync', 'Persisted older messages page', {
        ownerUuid,
        conversationUuid,
        count: withConversationUuid.length,
        nextPageUrl,
    });

    return {
        messages: withConversationUuid,
        nextPageUrl,
    };
}

export async function fetchOlderMessagesPageByOffsetAndPersist(
    ownerUuid: string,
    conversationUuid: string,
    offset: number,
    pageLimit: number = 50
): Promise<SyncMessagesResult> {
    await webDatabaseManager.initialize();

    const pageUrl = `${API_BASE_URL}/messaging/conversations/${conversationUuid}/messages/?limit=${pageLimit}&ordering=-created_at&offset=${Math.max(0, offset)}`;
    webLogger.info('sync', 'Fetching older messages page via explicit offset fallback', {
        ownerUuid,
        conversationUuid,
        pageUrl,
        offset,
        pageLimit,
    });

    const { messages, nextPageUrl } = await fetchMessagesPage(pageUrl);
    const withConversationUuid = messages.map((message) => ({
        conversation_uuid: conversationUuid,
        ...message,
    }));

    await webDatabaseManager.upsertMessages(withConversationUuid, ownerUuid);

    const computedNextPageUrl = nextPageUrl ?? (
        withConversationUuid.length === pageLimit
            ? `${API_BASE_URL}/messaging/conversations/${conversationUuid}/messages/?limit=${pageLimit}&ordering=-created_at&offset=${Math.max(0, offset) + withConversationUuid.length}`
            : null
    );

    await webDatabaseManager.setSyncState(conversationUuid, ownerUuid, normalizePaginationUrl(computedNextPageUrl));

    webLogger.info('sync', 'Persisted older messages page via explicit offset fallback', {
        ownerUuid,
        conversationUuid,
        count: withConversationUuid.length,
        nextPageUrl: normalizePaginationUrl(computedNextPageUrl),
    });

    return {
        messages: withConversationUuid,
        nextPageUrl: normalizePaginationUrl(computedNextPageUrl),
    };
}

export async function hydrateConversationHistoryFromDetail(
    ownerUuid: string,
    conversationUuid: string
): Promise<number> {
    await webDatabaseManager.initialize();

    const url = `${API_BASE_URL}/messaging/conversations/${conversationUuid}/`;
    webLogger.info('sync', 'Hydrating conversation history from conversation detail endpoint', {
        ownerUuid,
        conversationUuid,
        url,
    });

    const response = await fetchWithAuth(url);
    if (!response.ok) {
        webLogger.error('sync', 'Conversation detail hydration failed', {
            ownerUuid,
            conversationUuid,
            url,
            status: response.status,
        });
        throw new Error(`Failed to hydrate conversation history: ${response.status}`);
    }

    const payload = await response.json();
    const rawMessages = Array.isArray((payload as Record<string, unknown>).messages)
        ? ((payload as Record<string, unknown>).messages as Record<string, unknown>[])
        : [];

    const messages = rawMessages.map((message) => ({
        conversation_uuid: conversationUuid,
        ...message,
    }));

    if (messages.length > 0) {
        await webDatabaseManager.upsertMessages(messages, ownerUuid);
    }

    // Persist an explicit sync_state row so future loads know history completeness was checked.
    await webDatabaseManager.setSyncState(conversationUuid, ownerUuid, null);

    webLogger.info('sync', 'Completed conversation detail hydration', {
        ownerUuid,
        conversationUuid,
        count: messages.length,
    });

    return messages.length;
}
