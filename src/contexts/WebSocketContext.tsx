import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { WS_BASE_URL } from '@web/config/api';
import { webDatabaseManager } from '../services/webDatabase';
import { webLogger } from '../utils/logger';
import { normalizeIncomingMessage } from '../utils/incomingMessage';
import { syncLatestMessagesForConversation } from '../services/localSync';
import { pendingAgentExecution, cancelAgentExecution } from '../services/agentThreadExecution';

interface WebSocketContextType {
    isConnected: boolean;
    sendWsMessage: (payload: object) => boolean;
}

const WebSocketContext = createContext<WebSocketContextType>({
    isConnected: false,
    sendWsMessage: () => false,
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
    const { user, accessToken } = useAuth();
    const queryClient = useQueryClient();
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    const connect = useCallback(() => {
        if (!user || !accessToken) return;
        // Already open or connecting
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        const wsUrl = `${WS_BASE_URL}/ws/chat/`;
        webLogger.info('ws', 'Connecting websocket', {
            wsUrl,
            userUuid: user.uuid,
        });

        const ws = new WebSocket(wsUrl, ['access_token', accessToken]);
        wsRef.current = ws;

        ws.onopen = () => {
            webLogger.info('ws', 'Websocket connected', {
                userUuid: user.uuid,
            });
            setIsConnected(true);
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
        };

        ws.onmessage = (event) => {
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
            webLogger.warn('ws', 'Websocket closed, scheduling reconnect', {
                userUuid: user.uuid,
                retryInMs: 3000,
            });
            setIsConnected(false);
            if (wsRef.current === ws) {
                reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
            }
        };

        ws.onerror = () => {
            webLogger.error('ws', 'Websocket error', {
                userUuid: user.uuid,
            });
        };
    }, [user, accessToken, queryClient]);

    useEffect(() => {
        if (user && accessToken) {
            connect();
        }
        return () => {
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
            wsRef.current.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }, []);

    return (
        <WebSocketContext.Provider value={{ isConnected, sendWsMessage }}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function useWebSocketContext() {
    return useContext(WebSocketContext);
}
