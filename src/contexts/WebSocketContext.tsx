import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { WS_BASE_URL } from '@web/config/api';
import { webDatabaseManager } from '../services/webDatabase';
import { webLogger } from '../utils/logger';

interface WebSocketContextType {
    isConnected: boolean;
    sendWsMessage: (payload: object) => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
    isConnected: false,
    sendWsMessage: () => {},
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

                if (data.type === 'chat_message') {
                    const newMsg = data.message;
                    const convUuid = newMsg?.conversation_uuid;
                    if (!convUuid || !user?.uuid) return;

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
            webLogger.debug('ws', 'Sending websocket payload', { payload });
            wsRef.current.send(JSON.stringify(payload));
        }
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
