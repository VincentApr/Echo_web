import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { sendTemporaryJarvisAgentMessage } from '@web/services/jarvisAgentConversation';
import { useAuth } from './AuthContext';
import {
    sendJarvisInteraction as sendJarvisInteractionRequest,
    type JarvisInteractionRequest,
} from '../services/jarvisInteractionService';
import type { Message } from '../hooks/useMessages';

export interface JarvisLiveTurn {
    id: string;
    inputType: 'text' | 'voice';
    userMessage: string;
    jarvisResponse: string;
    isProcessing: boolean;
    conversationUuid?: string;
}

interface JarvisContextType {
    liveTurns: JarvisLiveTurn[];
    composerText: string;
    composerFocusKey: number;
    setComposerText: (text: string) => void;
    focusComposer: () => void;
    sendJarvisMessage: (message: string) => Promise<void>;
    sendJarvisInteraction: (request: JarvisInteractionRequest) => Promise<void>;
    getLocalConversationMessages: (conversationUuid: string | null) => Message[];
    clearLiveTurns: () => void;
    removeLiveTurn: (id: string) => void;
    upsertLiveTurn: (turn: JarvisLiveTurn) => void;
}

const JarvisContext = createContext<JarvisContextType | undefined>(undefined);

export function JarvisProvider({ children }: { children: React.ReactNode }) {
    const { isLoggedIn, user } = useAuth();
    const [liveTurns, setLiveTurns] = useState<JarvisLiveTurn[]>([]);
    const [composerText, setComposerText] = useState('');
    const [composerFocusKey, setComposerFocusKey] = useState(0);
    const [localMessagesByConversation, setLocalMessagesByConversation] = useState<Record<string, Message[]>>({});
    const temporaryConversationUuidRef = useRef<string | null>(null);

    const upsertLiveTurn = useCallback((turn: JarvisLiveTurn) => {
        setLiveTurns(prev => {
            const idx = prev.findIndex(t => t.id === turn.id);
            if (idx === -1) return [...prev, turn];
            const next = [...prev];
            next[idx] = turn;
            return next;
        });
    }, []);

    const clearLiveTurns = useCallback(() => {
        setLiveTurns([]);
        temporaryConversationUuidRef.current = null;
    }, []);

    const removeLiveTurn = useCallback((id: string) => {
        setLiveTurns(prev => prev.filter(turn => turn.id !== id));
    }, []);

    const focusComposer = useCallback(() => {
        setComposerFocusKey(key => key + 1);
    }, []);

    const sendJarvisMessage = useCallback(async (message: string) => {
        if (!message.trim() || !isLoggedIn) return;

        const turnId = Date.now().toString();
        const newTurn: JarvisLiveTurn = {
            id: turnId,
            inputType: 'text',
            userMessage: message.trim(),
            jarvisResponse: '',
            isProcessing: true,
        };

        upsertLiveTurn(newTurn);

        try {
            const result = await sendTemporaryJarvisAgentMessage(message.trim(), temporaryConversationUuidRef.current);
            temporaryConversationUuidRef.current = result.conversationUuid;
            upsertLiveTurn({ ...newTurn, conversationUuid: result.conversationUuid, jarvisResponse: result.response || 'Aucune réponse', isProcessing: false });
        } catch (error) {
            upsertLiveTurn({
                ...newTurn,
                jarvisResponse: error instanceof Error ? error.message : 'Erreur réseau',
                isProcessing: false,
            });
        }
    }, [upsertLiveTurn, isLoggedIn]);

    const getLocalConversationMessages = useCallback((conversationUuid: string | null): Message[] => {
        if (!conversationUuid) return [];
        return localMessagesByConversation[conversationUuid] ?? [];
    }, [localMessagesByConversation]);

    const upsertLocalConversationMessage = useCallback((conversationUuid: string, message: Message) => {
        setLocalMessagesByConversation(prev => {
            const current = prev[conversationUuid] ?? [];
            const index = current.findIndex(item => item.uuid === message.uuid);
            const next = index === -1 ? [...current, message] : current.map(item => item.uuid === message.uuid ? message : item);
            return {
                ...prev,
                [conversationUuid]: next,
            };
        });
    }, []);

    const sendJarvisInteraction = useCallback(async (request: JarvisInteractionRequest) => {
        if (!request.message.trim() || !isLoggedIn) return;

        if (!request.conversationUuid) {
            await sendJarvisMessage(request.message);
            return;
        }

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const parentMessageUuid = request.parentMessageUuid ?? null;
        const threadRootUuid = request.jarvisThreadRootUuid ?? `local-jarvis-${nowMs + 1}`;

        if (request.includeLocalUserMessage) {
            upsertLocalConversationMessage(request.conversationUuid, {
                id: nowMs,
                uuid: `local-user-${nowMs}`,
                sender_username: user?.username || 'Vous',
                sender_uuid: user?.uuid,
                conversation_uuid: request.conversationUuid,
                content: request.message.trim(),
                created_at: now,
                parent_message_uuid: threadRootUuid,
                jarvis_thread_root_uuid: threadRootUuid,
            });
        }

        const messageUuid = request.jarvisThreadRootUuid ? `local-jarvis-reply-${nowMs + 1}` : threadRootUuid;
        const pendingMessage: Message = {
            id: nowMs + 1,
            uuid: messageUuid,
            sender_username: 'Jarvis',
            conversation_uuid: request.conversationUuid,
            content: 'Jarvis reflechit...',
            created_at: new Date(nowMs + 1).toISOString(),
            is_ai_generated: true,
            message_type: 'ai_generated',
            parent_message_uuid: request.jarvisThreadRootUuid ? threadRootUuid : parentMessageUuid,
            isPending: true,
            agent_info: { name: 'Jarvis', uuid: 'jarvis-local' },
            framework_agent_name: 'Jarvis',
            framework_agent_uuid: 'jarvis-local',
            jarvis_prompt: request.message.trim(),
            jarvis_preferred_tool: request.preferredToolId ?? null,
            jarvis_thread_root_uuid: threadRootUuid,
            is_jarvis_thread_root: !request.jarvisThreadRootUuid,
        };

        upsertLocalConversationMessage(request.conversationUuid, pendingMessage);

        try {
            const result = await sendJarvisInteractionRequest(request);
            upsertLocalConversationMessage(request.conversationUuid, {
                ...pendingMessage,
                content: result.response,
                isPending: false,
            });
        } catch (error) {
            upsertLocalConversationMessage(request.conversationUuid, {
                ...pendingMessage,
                content: error instanceof Error ? error.message : 'Erreur Jarvis',
                isPending: false,
                sendError: true,
            });
        }
    }, [isLoggedIn, sendJarvisMessage, upsertLocalConversationMessage, user?.username, user?.uuid]);

    return (
        <JarvisContext.Provider value={{
            liveTurns,
            composerText,
            composerFocusKey,
            setComposerText,
            focusComposer,
            sendJarvisMessage,
            sendJarvisInteraction,
            getLocalConversationMessages,
            clearLiveTurns,
            removeLiveTurn,
            upsertLiveTurn,
        }}>
            {children}
        </JarvisContext.Provider>
    );
}

export function useJarvis() {
    const context = useContext(JarvisContext);
    if (!context) throw new Error('useJarvis must be used within a JarvisProvider');
    return context;
}
