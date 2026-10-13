import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { WS_BASE_URL } from '@web/config/api';
import { webDatabaseManager } from '../services/webDatabase';
import { webLogger } from '../utils/logger';
import { normalizeIncomingMessage } from '../utils/incomingMessage';
import { syncLatestMessagesForConversation, syncConversationsByType } from '../services/localSync';
import { getValidAccessToken } from '../services/apiClient';
import { pendingAgentExecution, cancelAgentExecution } from '../services/agentThreadExecution';

interface WebSocketContextType {
    isConnected: boolean;
    isOnline: boolean;
    connectionVersion: number;
    sendWsMessage: (payload: object) => boolean;
}

const WebSocketContext = createContext<WebSocketContextType>({
    isConnected: false,
    isOnline: true,
    connectionVersion: 0,
    sendWsMessage: () => false,
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
    const { user, accessToken } = useAuth();
    const queryClient = useQueryClient();
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [connectionVersion, setConnectionVersion] = useState(0);
    const generationRef = useRef(0);
    const connectingRef = useRef(false);
    const retryAttemptRef = useRef(0);

    const connect = useCallback(async () => {
        if (!user || !accessToken || !navigator.onLine || connectingRef.current) return;
        // Already open or connecting
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        const wsUrl = `${WS_BASE_URL}/ws/chat/`;
        webLogger.info('ws', 'Connecting websocket', {
            wsUrl,
            userUuid: user.uuid,
        });

        const generation = generationRef.current;
        connectingRef.current = true;
        let token: string | null;
        try { token = await getValidAccessToken(); }
        catch {
            if (generation === generationRef.current) {
                connectingRef.current = false;
                reconnectTimeoutRef.current = window.setTimeout(() => void connect(), 5000);
            }
            return;
        }
        if (generation !== generationRef.current) return;
        connectingRef.current = false;
        if (!token || !navigator.onLine) return;
        const ws = new WebSocket(wsUrl, ['access_token', token]);
        wsRef.current = ws;

        ws.onopen = () => {
            if (wsRef.current !== ws) return;
            webLogger.info('ws', 'Websocket connected', {
                userUuid: user.uuid,
            });
            setIsConnected(true);
            retryAttemptRef.current = 0;
            setConnectionVersion(version => version + 1);
            // Reload sidebar data from the server, not only from IndexedDB.
            void Promise.allSettled((['private', 'group', 'agent'] as const).map(type => syncConversationsByType(user.uuid, type)))
                .then(() => { if (wsRef.current === ws) void queryClient.invalidateQueries({ queryKey: ['conversations'] }); });
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
        };

        ws.onmessage = (event) => {
            if (wsRef.current !== ws) return;
            try {
                const data = JSON.parse(event.data);
                // Development trace: identifiers and shape only, never tokens or
                // message text. Vite forwards warnings to the preview terminal.
                if (import.meta.env.DEV) {
                    const message = data.message && typeof data.message === 'object' ? data.message : data;
                    console.warn('[EchoWeb:agent-trace] received', JSON.stringify({
                        type: data.type,
                        fields: Object.keys(data),
                        conversation: data.conversation_uuid || message.conversation_uuid,
                        uuid: message.uuid || data.message_uuid,
                        parent: message.parent_message_uuid || data.parent_message_uuid,
                        agent: message.framework_agent_uuid || message.ai_agent_uuid || data.agent_uuid,
                        generated: message.is_ai_generated,
                        contentLength: typeof message.content === 'string' ? message.content.length : undefined,
                        success: data.success,
                        error: data.error || data.detail,
                    }));
                }

                if (data.type === 'framework_agent_triggered' && user?.uuid) {
                    const invocation = pendingAgentExecution(user.uuid, data.agent_uuid, data.conversation_uuid);
                    const conversationUuid = data.conversation_uuid || invocation?.conversation;
                    if (!conversationUuid) return;
                    const ownerUuid = user.uuid;
                    void (async () => {
                        try {
                            if (data.success === false) {
                                cancelAgentExecution(ownerUuid, conversationUuid, data.agent_uuid);
                                await webDatabaseManager.upsertMessage({
                                    uuid: `agent-error-${crypto.randomUUID()}`,
                                    conversation_uuid: conversationUuid,
                                    content: `${data.agent_name || 'Agent'} : ${data.error || 'Impossible de générer une réponse.'}`,
                                    message_type: 'system',
                                    parent_message_uuid: invocation?.root,
                                    created_at: new Date().toISOString(),
                                }, ownerUuid);
                                webLogger.warn('ws', 'Agent execution failed', { conversationUuid, error: data.error });
                            } else {
                                await syncLatestMessagesForConversation(ownerUuid, conversationUuid);
                            }
                        } catch (error) {
                            webLogger.warn('ws', 'Agent execution synchronization failed', { error: String(error) });
                        } finally {
                            queryClient.invalidateQueries({ queryKey: ['messages', conversationUuid] });
                        }
                    })();
                    return;
                }

                if (['chat_message', 'agent_message', 'message_updated'].includes(data.type)) {
                    const newMsg = normalizeIncomingMessage(data);
                    const convUuid = newMsg?.conversation_uuid;
                    if (!convUuid || !user?.uuid) {
                        webLogger.warn('ws', 'Incomplete message event', { eventType: data.type, fields: Object.keys(data) });
                        return;
                    }

                    webLogger.info('ws', 'Received chat message event', {
                        userUuid: user.uuid,
                        conversationUuid: convUuid,
                        messageUuid: String(newMsg?.uuid || ''),
                    });

                    void (async () => {
                        try {
                            await webDatabaseManager.upsertMessage(newMsg, user.uuid);
                            await webDatabaseManager.updateConversationFromMessage(convUuid, user.uuid, newMsg);
                        } catch (storageError) {
                            webLogger.error('ws', 'Failed to persist incoming message locally', {
                                userUuid: user.uuid,
                                conversationUuid: convUuid,
                                error: storageError instanceof Error ? storageError.message : String(storageError),
                            });
                        } finally {
                            queryClient.invalidateQueries({ queryKey: ['messages', convUuid] });
                            queryClient.invalidateQueries({ queryKey: ['conversations'] });
                        }
                    })();
            }
        } catch (err) {
                webLogger.error('ws', 'Websocket payload parse error', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        };

        ws.onclose = () => {
            if (wsRef.current !== ws) return;
            webLogger.warn('ws', 'Websocket closed, scheduling reconnect', {
                userUuid: user.uuid,
                retryInMs: 3000,
            });
            setIsConnected(false);
            if (navigator.onLine) {
                const delay = Math.min(30_000, 1000 * 2 ** retryAttemptRef.current++);
                reconnectTimeoutRef.current = window.setTimeout(() => void connect(), delay);
            }
        };

        ws.onerror = () => {
            webLogger.error('ws', 'Websocket error', {
                userUuid: user.uuid,
            });
        };
    }, [user, accessToken, queryClient]);

    useEffect(() => {
        const online = () => { setIsOnline(true); void connect(); };
        const offline = () => {
            setIsOnline(false); setIsConnected(false);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            wsRef.current?.close();
        };
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        if (user && accessToken) {
            connect();
        }
        return () => {
            generationRef.current++;
            connectingRef.current = false;
            window.removeEventListener('online', online);
            window.removeEventListener('offline', offline);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            const ws = wsRef.current;
            wsRef.current = null;
            ws?.close();
            setIsConnected(false);
        };
    }, [user, accessToken, connect]);

    const sendWsMessage = useCallback((payload: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            if (import.meta.env.DEV) {
                const message = payload as Record<string, unknown>;
                if (message.type === 'chat_message') console.warn('[EchoWeb:agent-trace] sent', JSON.stringify({
                    conversation: message.conversation_uuid,
                    agent: message.ai_agent_uuid,
                    parent: message.parent_message_uuid,
                    clientId: message.client_message_id,
                }));
            }
            webLogger.debug('ws', 'Sending websocket payload', { payload });
            try { wsRef.current.send(JSON.stringify(payload)); return true; }
            catch { return false; }
        }
        return false;
    }, []);

    return (
        <WebSocketContext.Provider value={{ isConnected, isOnline, connectionVersion, sendWsMessage }}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function useWebSocketContext() {
    return useContext(WebSocketContext);
}
