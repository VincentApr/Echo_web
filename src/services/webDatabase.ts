import { webLogger } from '../utils/logger';
import { mergeThreadMessage, rememberThreadMessage } from './agentThreadExecution';

type ConversationType = 'direct' | 'group' | 'agent';

type StoredConversationRecord = {
    id: string;
    owner_uuid: string;
    uuid: string;
    conversation_type: ConversationType;
    raw: Record<string, unknown>;
    created_at_ms: number;
    updated_at_ms: number;
    last_activity_ms: number;
    is_archived: boolean;
};

type StoredMessageRecord = {
    id: string;
    owner_uuid: string;
    uuid: string;
    conversation_uuid: string;
    created_at_ms: number;
    raw: Record<string, unknown>;
    sync_status: 'pending' | 'failed' | 'synced';
    is_pending: boolean;
};

type StoredSyncStateRecord = {
    id: string;
    owner_uuid: string;
    conversation_uuid: string;
    next_page_url: string | null;
    updated_at_ms: number;
};

type MessagePageOptions = {
    limit: number;
    beforeCreatedAtMs?: number;
    beforeUuid?: string | null;
};

type MessagePageResult = {
    messages: Record<string, unknown>[];
    hasMoreLocal: boolean;
};

type StoreSnapshot = {
    count: number;
    approxBytes: number;
};

type DatabaseSnapshot = {
    ownerUuid?: string;
    totalCount: number;
    totalApproxBytes: number;
    conversations: StoreSnapshot;
    messages: StoreSnapshot;
    syncState: StoreSnapshot;
    browserEstimateUsageBytes?: number;
    browserEstimateQuotaBytes?: number;
};

const DB_NAME = 'echo_web_local_db';
const DB_VERSION = 1;
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';
const SYNC_STATE_STORE = 'sync_state';

function toEpochMs(value: unknown): number {
    if (value === null || value === undefined) return 0;

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 0;
        return Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
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

function normalizeConversationType(type: unknown): ConversationType {
    if (type === 'group' || type === 'group_chat') return 'group';
    if (type === 'agent' || type === 'ai_agent') return 'agent';
    return 'direct';
}

function buildScopedId(ownerUuid: string, entityUuid: string): string {
    return `${ownerUuid}::${entityUuid}`;
}

function compareMessagesDescending(a: StoredMessageRecord, b: StoredMessageRecord): number {
    if (a.created_at_ms !== b.created_at_ms) {
        return b.created_at_ms - a.created_at_ms;
    }

    return b.uuid.localeCompare(a.uuid);
}

export class WebDatabaseManager {
    private static instance: WebDatabaseManager | null = null;
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    static getInstance(): WebDatabaseManager {
        if (!WebDatabaseManager.instance) {
            WebDatabaseManager.instance = new WebDatabaseManager();
        }

        return WebDatabaseManager.instance;
    }

    async initialize(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        webLogger.debug('db', 'Opening IndexedDB', { dbName: DB_NAME, version: DB_VERSION });

        this.initPromise = new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
                    const conversations = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
                    conversations.createIndex('owner_uuid', 'owner_uuid', { unique: false });
                    conversations.createIndex('owner_type', ['owner_uuid', 'conversation_type'], { unique: false });
                }

                if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
                    const messages = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
                    messages.createIndex('owner_uuid', 'owner_uuid', { unique: false });
                    messages.createIndex('owner_conversation', ['owner_uuid', 'conversation_uuid'], { unique: false });
                }

                if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
                    const syncState = db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'id' });
                    syncState.createIndex('owner_uuid', 'owner_uuid', { unique: false });
                    syncState.createIndex('owner_conversation', ['owner_uuid', 'conversation_uuid'], { unique: true });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                webLogger.debug('db', 'IndexedDB ready', {
                    stores: Array.from(this.db.objectStoreNames),
                });
                resolve();
            };

            request.onerror = () => {
                webLogger.error('db', 'Failed to open IndexedDB', {
                    error: request.error?.message ?? 'unknown error',
                });
                reject(request.error ?? new Error('Failed to open IndexedDB'));
            };
        });

        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    private async getDb(): Promise<IDBDatabase> {
        await this.initialize();
        if (!this.db) throw new Error('IndexedDB is not initialized');
        return this.db;
    }

    private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        });
    }

    private async getAllByIndex<T>(storeName: string, indexName: string, key: IDBValidKey | IDBKeyRange): Promise<T[]> {
        const db = await this.getDb();
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        return this.requestToPromise(index.getAll(key)) as Promise<T[]>;
    }

    private async getAllRecords<T>(storeName: string): Promise<T[]> {
        const db = await this.getDb();
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        return this.requestToPromise(store.getAll()) as Promise<T[]>;
    }

    private async getRecord<T>(storeName: string, id: string): Promise<T | null> {
        const db = await this.getDb();
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const result = await this.requestToPromise(store.get(id));
        return (result as T | undefined) ?? null;
    }

    async clearAllData(): Promise<void> {
        const db = await this.getDb();
        const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE, SYNC_STATE_STORE], 'readwrite');
        await Promise.all([
            this.requestToPromise(tx.objectStore(CONVERSATIONS_STORE).clear()),
            this.requestToPromise(tx.objectStore(MESSAGES_STORE).clear()),
            this.requestToPromise(tx.objectStore(SYNC_STATE_STORE).clear()),
        ]);
        webLogger.info('db', 'Cleared all local data');
    }

    private measureApproxBytes(records: unknown[]): number {
        const encoder = new TextEncoder();
        return records.reduce<number>((total, record) => {
            try {
                return total + encoder.encode(JSON.stringify(record)).length;
            } catch {
                return total;
            }
        }, 0);
    }

    async getSnapshot(ownerUuid?: string): Promise<DatabaseSnapshot> {
        const [conversations, messages, syncState] = ownerUuid
            ? await Promise.all([
                this.getAllByIndex<StoredConversationRecord>(CONVERSATIONS_STORE, 'owner_uuid', ownerUuid),
                this.getAllByIndex<StoredMessageRecord>(MESSAGES_STORE, 'owner_uuid', ownerUuid),
                this.getAllByIndex<StoredSyncStateRecord>(SYNC_STATE_STORE, 'owner_uuid', ownerUuid),
            ])
            : await Promise.all([
                this.getAllRecords<StoredConversationRecord>(CONVERSATIONS_STORE),
                this.getAllRecords<StoredMessageRecord>(MESSAGES_STORE),
                this.getAllRecords<StoredSyncStateRecord>(SYNC_STATE_STORE),
            ]);

        const snapshot: DatabaseSnapshot = {
            ...(ownerUuid ? { ownerUuid } : {}),
            conversations: {
                count: conversations.length,
                approxBytes: this.measureApproxBytes(conversations),
            },
            messages: {
                count: messages.length,
                approxBytes: this.measureApproxBytes(messages),
            },
            syncState: {
                count: syncState.length,
                approxBytes: this.measureApproxBytes(syncState),
            },
            totalCount: 0,
            totalApproxBytes: 0,
        };

        snapshot.totalCount =
            snapshot.conversations.count +
            snapshot.messages.count +
            snapshot.syncState.count;
        snapshot.totalApproxBytes =
            snapshot.conversations.approxBytes +
            snapshot.messages.approxBytes +
            snapshot.syncState.approxBytes;

        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                snapshot.browserEstimateUsageBytes = estimate.usage;
                snapshot.browserEstimateQuotaBytes = estimate.quota;
            } catch {
                // Best effort only.
            }
        }

        return snapshot;
    }

    async logSnapshot(ownerUuid?: string): Promise<void> {
        const snapshot = await this.getSnapshot(ownerUuid);
        webLogger.info('db', 'Local database snapshot', {
            scope: ownerUuid ? 'user' : 'global',
            ownerUuid: ownerUuid ?? null,
            totalCount: snapshot.totalCount,
            totalApproxBytes: snapshot.totalApproxBytes,
            totalApproxKB: Number((snapshot.totalApproxBytes / 1024).toFixed(1)),
            conversationsCount: snapshot.conversations.count,
            conversationsKB: Number((snapshot.conversations.approxBytes / 1024).toFixed(1)),
            messagesCount: snapshot.messages.count,
            messagesKB: Number((snapshot.messages.approxBytes / 1024).toFixed(1)),
            syncStateCount: snapshot.syncState.count,
            syncStateKB: Number((snapshot.syncState.approxBytes / 1024).toFixed(1)),
            browserUsageKB: snapshot.browserEstimateUsageBytes
                ? Number((snapshot.browserEstimateUsageBytes / 1024).toFixed(1))
                : null,
            browserQuotaMB: snapshot.browserEstimateQuotaBytes
                ? Number((snapshot.browserEstimateQuotaBytes / (1024 * 1024)).toFixed(1))
                : null,
        });
    }

    async getConversation(uuid: string, ownerUuid: string): Promise<Record<string, unknown> | null> {
        const record = await this.getRecord<StoredConversationRecord>(CONVERSATIONS_STORE, buildScopedId(ownerUuid, uuid));
        return record?.raw ?? null;
    }

    async getConversationsByType(type: ConversationType, ownerUuid: string): Promise<Record<string, unknown>[]> {
        const records = await this.getAllByIndex<StoredConversationRecord>(
            CONVERSATIONS_STORE,
            'owner_type',
            [ownerUuid, type]
        );

        webLogger.debug('db', 'Loaded conversations by type', {
            ownerUuid,
            type,
            count: records.length,
        });

        return records
            .filter((record) => !record.is_archived)
            .sort((a, b) => b.last_activity_ms - a.last_activity_ms)
            .map((record) => record.raw);
    }

    async deleteConversation(uuid: string, ownerUuid: string): Promise<void> {
        const db = await this.getDb();
        const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        await this.requestToPromise(tx.objectStore(CONVERSATIONS_STORE).delete(buildScopedId(ownerUuid, uuid)));
    }

    async deleteConversationsNotInSet(ownerUuid: string, type: ConversationType, uuids: Set<string>): Promise<void> {
        const records = await this.getAllByIndex<StoredConversationRecord>(
            CONVERSATIONS_STORE,
            'owner_type',
            [ownerUuid, type]
        );

        const staleIds = records
            .filter((record) => !uuids.has(record.uuid))
            .map((record) => record.id);

        if (staleIds.length === 0) return;

        const db = await this.getDb();
        const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        const store = tx.objectStore(CONVERSATIONS_STORE);

        await Promise.all(staleIds.map((id) => this.requestToPromise(store.delete(id))));
        webLogger.info('db', 'Deleted stale conversations', {
            ownerUuid,
            type,
            deletedCount: staleIds.length,
        });
    }

    private buildConversationRecord(
        conversation: Record<string, unknown>,
        ownerUuid: string
    ): StoredConversationRecord {
        const uuid = String(conversation.uuid || '');
        const normalizedType = normalizeConversationType(conversation.conversation_type);
        const raw: Record<string, unknown> = {
            ...conversation,
            conversation_type: normalizedType,
        };

        const createdAtMs = toEpochMs(raw.created_at) || Date.now();
        const updatedAtMs = toEpochMs(raw.updated_at) || createdAtMs;
        const lastActivityMs =
            toEpochMs((raw.last_message as Record<string, unknown> | undefined)?.created_at) ||
            updatedAtMs ||
            createdAtMs;

        return {
            id: buildScopedId(ownerUuid, uuid),
            owner_uuid: ownerUuid,
            uuid,
            conversation_type: normalizedType,
            raw,
            created_at_ms: createdAtMs,
            updated_at_ms: updatedAtMs,
            last_activity_ms: lastActivityMs,
            is_archived: Boolean(raw.is_archived),
        };
    }

    async upsertConversation(conversation: Record<string, unknown>, ownerUuid: string): Promise<void> {
        const record = this.buildConversationRecord(conversation, ownerUuid);
        const db = await this.getDb();
        const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        await this.requestToPromise(tx.objectStore(CONVERSATIONS_STORE).put(record));
        webLogger.debug('db', 'Upserted conversation', {
            ownerUuid,
            conversationUuid: record.uuid,
            type: record.conversation_type,
        });
    }

    async upsertConversations(conversations: Record<string, unknown>[], ownerUuid: string): Promise<void> {
        if (conversations.length === 0) return;

        const db = await this.getDb();
        const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        const store = tx.objectStore(CONVERSATIONS_STORE);

        for (const conversation of conversations) {
            const record = this.buildConversationRecord(conversation, ownerUuid);
            await this.requestToPromise(store.put(record));
        }

        webLogger.info('db', 'Upserted conversations batch', {
            ownerUuid,
            count: conversations.length,
        });
    }

    private buildMessageRecord(message: Record<string, unknown>, ownerUuid: string): StoredMessageRecord {
        const uuid = String(message.uuid || '');
        const createdAtMs = toEpochMs(message.created_at) || Date.now();
        const isPending = Boolean(message.isPending);
        const syncStatus = (message.sendError ? 'failed' : (isPending ? 'pending' : 'synced')) as StoredMessageRecord['sync_status'];

        return {
            id: buildScopedId(ownerUuid, uuid),
            owner_uuid: ownerUuid,
            uuid,
            conversation_uuid: String(message.conversation_uuid || ''),
            created_at_ms: createdAtMs,
            raw: {
                ...message,
                created_at: typeof message.created_at === 'string'
                    ? message.created_at
                    : new Date(createdAtMs).toISOString(),
            },
            sync_status: syncStatus,
            is_pending: isPending,
        };
    }

    private async findMatchingPendingMessageId(
        ownerUuid: string,
        message: StoredMessageRecord
    ): Promise<string | null> {
        if (message.is_pending || !message.conversation_uuid) return null;

        const existingMessages = await this.getAllByIndex<StoredMessageRecord>(
            MESSAGES_STORE,
            'owner_conversation',
            [ownerUuid, message.conversation_uuid]
        );

        const match = existingMessages.find((candidate) => {
            if (!candidate.is_pending) return false;

            // The server may reparent the prompt into its newly-created thread.
            // Prefer the echoed client ID over the original parent comparison.
            if (message.raw.client_message_id === candidate.uuid && candidate.raw.sender_uuid === message.raw.sender_uuid) return true;

            const sameSender = candidate.raw.sender_uuid === message.raw.sender_uuid;
            const sameContent = candidate.raw.content === message.raw.content;
            const sameParent = (candidate.raw.parent_message_uuid ?? null) === (message.raw.parent_message_uuid ?? null);
            const closeInTime = Math.abs(candidate.created_at_ms - message.created_at_ms) < 5 * 60 * 1000;

            return sameSender && sameContent && sameParent && closeInTime;
        });

        if (match) return match.id;
        // Some REST-created socket echoes arrive before the HTTP confirmation,
        // without either the client ID or parent. Only reconcile an unambiguous
        // pending thread reply; never guess between two identical submissions.
        if (message.raw.sender_uuid && !message.raw.parent_message_uuid && !message.raw.is_ai_generated) {
            const candidates = existingMessages.filter(candidate => candidate.is_pending
                && candidate.raw.web_agent_parent_uuid
                && candidate.raw.sender_uuid === message.raw.sender_uuid
                && candidate.raw.content === message.raw.content
                && Math.abs(candidate.created_at_ms - message.created_at_ms) < 5 * 60 * 1000);
            if (candidates.length === 1) return candidates[0].id;
        }
        return null;
    }

    async upsertMessage(message: Record<string, unknown>, ownerUuid: string): Promise<void> {
        // Mobile message_updated events can contain only a parent or content.
        // Preserve the rest of the stored message when applying those patches.
        const readDb = await this.getDb();
        const existing = await this.requestToPromise<StoredMessageRecord | undefined>(
            readDb.transaction(MESSAGES_STORE, 'readonly').objectStore(MESSAGES_STORE).get(buildScopedId(ownerUuid, String(message.uuid || '')))
        );
        const merged = mergeThreadMessage(existing?.raw, message, ownerUuid);
        const record = this.buildMessageRecord(merged, ownerUuid);
        if (!record.conversation_uuid) return;

        const pendingMatchId = await this.findMatchingPendingMessageId(ownerUuid, record);
        const pending = pendingMatchId
            ? await this.requestToPromise<StoredMessageRecord | undefined>(
                readDb.transaction(MESSAGES_STORE, 'readonly').objectStore(MESSAGES_STORE).get(pendingMatchId)
            ) : undefined;
        // The HTTP/WS confirmation need not repeat the selected agent. Keep
        // that local routing metadata across confirmation and later syncs.
        const targetAgent = message.ai_agent_uuid || existing?.raw.ai_agent_uuid || pending?.raw.ai_agent_uuid;
        if (targetAgent && !record.raw.is_ai_generated) record.raw.ai_agent_uuid = targetAgent;
        if (!record.raw.is_ai_generated && pending?.raw.web_agent_waiting_since) {
            record.raw.web_agent_waiting_since ??= pending.raw.web_agent_waiting_since;
        }
        if (pending?.raw.web_agent_parent_uuid) {
            record.raw = mergeThreadMessage(pending.raw, record.raw, ownerUuid);
            rememberThreadMessage(ownerUuid, record.conversation_uuid, record.uuid, String(record.raw.parent_message_uuid));
        }
        const db = await this.getDb();
        const tx = db.transaction(MESSAGES_STORE, 'readwrite');
        const store = tx.objectStore(MESSAGES_STORE);

        if (pendingMatchId) {
            await this.requestToPromise(store.delete(pendingMatchId));
        }
        await this.requestToPromise(store.put(record));
        webLogger.debug('db', 'Upserted message', {
            ownerUuid,
            conversationUuid: record.conversation_uuid,
            messageUuid: record.uuid,
            syncStatus: record.sync_status,
            replacedPending: Boolean(pendingMatchId),
        });
    }

    async upsertMessages(messages: Record<string, unknown>[], ownerUuid: string): Promise<void> {
        if (messages.length === 0) return;

        for (const message of messages) {
            await this.upsertMessage(message, ownerUuid);
        }

        webLogger.info('db', 'Upserted messages batch', {
            ownerUuid,
            count: messages.length,
            conversationUuid: String(messages[0]?.conversation_uuid || ''),
        });
    }

    async getMessagesPage(
        conversationUuid: string,
        ownerUuid: string,
        options: MessagePageOptions
    ): Promise<MessagePageResult> {
        const records = await this.getAllByIndex<StoredMessageRecord>(
            MESSAGES_STORE,
            'owner_conversation',
            [ownerUuid, conversationUuid]
        );

        const sorted = records.sort(compareMessagesDescending);
        const filtered = sorted.filter((record) => {
            if (options.beforeCreatedAtMs === undefined) return true;
            if (record.created_at_ms < options.beforeCreatedAtMs) return true;
            if (record.created_at_ms > options.beforeCreatedAtMs) return false;

            if (!options.beforeUuid) return false;
            return record.uuid.localeCompare(options.beforeUuid) < 0;
        });

        const page = filtered.slice(0, options.limit);

        webLogger.debug('db', 'Loaded messages page', {
            ownerUuid,
            conversationUuid,
            limit: options.limit,
            beforeCreatedAtMs: options.beforeCreatedAtMs ?? null,
            beforeUuid: options.beforeUuid ?? null,
            returnedCount: page.length,
            hasMoreLocal: filtered.length > options.limit,
            totalInConversation: records.length,
        });

        return {
            messages: page.map((record) => record.raw),
            hasMoreLocal: filtered.length > options.limit,
        };
    }

    async getMessageCount(conversationUuid: string, ownerUuid: string): Promise<number> {
        const records = await this.getAllByIndex<StoredMessageRecord>(
            MESSAGES_STORE,
            'owner_conversation',
            [ownerUuid, conversationUuid]
        );
        return records.length;
    }

    async getNewestMessageTimestamp(conversationUuid: string, ownerUuid: string): Promise<number | null> {
        const records = await this.getAllByIndex<StoredMessageRecord>(
            MESSAGES_STORE,
            'owner_conversation',
            [ownerUuid, conversationUuid]
        );
        if (records.length === 0) return null;

        const newest = records.sort(compareMessagesDescending)[0];
        return newest?.created_at_ms ?? null;
    }

    async getMessageUuids(conversationUuid: string, ownerUuid: string): Promise<string[]> {
        const records = await this.getAllByIndex<StoredMessageRecord>(
            MESSAGES_STORE,
            'owner_conversation',
            [ownerUuid, conversationUuid]
        );
        return records.map((record) => record.uuid);
    }

    async updateMessageSyncStatus(
        messageUuid: string,
        ownerUuid: string,
        syncStatus: StoredMessageRecord['sync_status']
    ): Promise<void> {
        const existing = await this.getRecord<StoredMessageRecord>(MESSAGES_STORE, buildScopedId(ownerUuid, messageUuid));
        if (!existing) return;

        const nextRaw = {
            ...existing.raw,
            isPending: syncStatus === 'pending',
            sendError: syncStatus === 'failed',
        };

        const db = await this.getDb();
        const tx = db.transaction(MESSAGES_STORE, 'readwrite');
        await this.requestToPromise(tx.objectStore(MESSAGES_STORE).put({
            ...existing,
            raw: nextRaw,
            sync_status: syncStatus,
            is_pending: syncStatus === 'pending',
        }));
        webLogger.info('db', 'Updated message sync status', {
            ownerUuid,
            messageUuid,
            syncStatus,
        });
    }

    async markConversationMessagesAsReadForViewer(conversationUuid: string, ownerUuid: string): Promise<void> {
        const records = await this.getAllByIndex<StoredMessageRecord>(
            MESSAGES_STORE,
            'owner_conversation',
            [ownerUuid, conversationUuid]
        );

        if (records.length === 0) return;

        const db = await this.getDb();
        const tx = db.transaction(MESSAGES_STORE, 'readwrite');
        const store = tx.objectStore(MESSAGES_STORE);
        let updatedCount = 0;

        for (const record of records) {
            if (record.raw.sender_uuid === ownerUuid || record.raw.is_read === true) continue;
            await this.requestToPromise(store.put({
                ...record,
                raw: {
                    ...record.raw,
                    is_read: true,
                },
            }));
            updatedCount += 1;
        }

        webLogger.debug('db', 'Marked conversation messages as read locally', {
            ownerUuid,
            conversationUuid,
            updatedCount,
        });
    }

    async resetUnreadCount(conversationUuid: string, ownerUuid: string): Promise<void> {
        const existing = await this.getRecord<StoredConversationRecord>(CONVERSATIONS_STORE, buildScopedId(ownerUuid, conversationUuid));
        if (!existing) return;

        const db = await this.getDb();
        const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        await this.requestToPromise(tx.objectStore(CONVERSATIONS_STORE).put({
            ...existing,
            raw: {
                ...existing.raw,
                unread_count: 0,
            },
        }));
        webLogger.debug('db', 'Reset unread count locally', {
            ownerUuid,
            conversationUuid,
        });
    }

    async updateConversationFromMessage(
        conversationUuid: string,
        ownerUuid: string,
        message: Record<string, unknown>
    ): Promise<void> {
        const existing = await this.getRecord<StoredConversationRecord>(CONVERSATIONS_STORE, buildScopedId(ownerUuid, conversationUuid));
        if (!existing) {
            webLogger.warn('db', 'Skipped conversation update from message because conversation is missing', {
                ownerUuid,
                conversationUuid,
                messageUuid: String(message.uuid || ''),
            });
            return;
        }

        const createdAt = toEpochMs(message.created_at) || Date.now();
        const previousUnread = typeof existing.raw.unread_count === 'number' ? existing.raw.unread_count : 0;
        const isOwnMessage = message.sender_uuid === ownerUuid;
        const nextUnread = isOwnMessage ? previousUnread : previousUnread + 1;

        const updatedRaw = {
            ...existing.raw,
            updated_at: new Date(createdAt).toISOString(),
            unread_count: nextUnread,
            last_message: {
                content: message.content || '',
                created_at: typeof message.created_at === 'string'
                    ? message.created_at
                    : new Date(createdAt).toISOString(),
                sender_username: message.sender_username || '',
            },
        };

        const db = await this.getDb();
        const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        await this.requestToPromise(tx.objectStore(CONVERSATIONS_STORE).put({
            ...existing,
            raw: updatedRaw,
            updated_at_ms: createdAt,
            last_activity_ms: createdAt,
        }));
        webLogger.debug('db', 'Updated conversation from message', {
            ownerUuid,
            conversationUuid,
            messageUuid: String(message.uuid || ''),
            unreadCount: nextUnread,
        });
    }

    async getSyncState(conversationUuid: string, ownerUuid: string): Promise<StoredSyncStateRecord | null> {
        const syncState = await this.getRecord<StoredSyncStateRecord>(SYNC_STATE_STORE, buildScopedId(ownerUuid, conversationUuid));
        webLogger.debug('db', 'Loaded sync state', {
            ownerUuid,
            conversationUuid,
            nextPageUrl: syncState?.next_page_url ?? null,
        });
        return syncState;
    }

    async setSyncState(
        conversationUuid: string,
        ownerUuid: string,
        nextPageUrl: string | null
    ): Promise<void> {
        const db = await this.getDb();
        const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
        await this.requestToPromise(tx.objectStore(SYNC_STATE_STORE).put({
            id: buildScopedId(ownerUuid, conversationUuid),
            owner_uuid: ownerUuid,
            conversation_uuid: conversationUuid,
            next_page_url: nextPageUrl,
            updated_at_ms: Date.now(),
        } satisfies StoredSyncStateRecord));
        webLogger.debug('db', 'Updated sync state', {
            ownerUuid,
            conversationUuid,
            nextPageUrl,
        });
    }
}

export const webDatabaseManager = WebDatabaseManager.getInstance();
