import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeAgentExecutions, isThreadExecuting } from '../../services/agentThreadExecution';
import { useMessages, type Message } from '../../hooks/useMessages';
import { useWebSocketMessages } from '../../hooks/useWebSocketMessages';
import { useNavigation, type ReplyTarget } from '../../contexts/NavigationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useJarvis } from '../../contexts/JarvisContext';
import { MessageBubble, USER_COLORS } from './MessageBubble';
import { AgentContentRenderer } from './AgentContentRenderer';
import { normalizeAgentRenderPayload, normalizeRawAgentContentText } from '../../utils/agentRenderPayload';
import { buildMessageReactionContent, extractReactionMapFromMessages, isReactionEventMessage } from '../../utils/messageReactions';
import { isSystemMessage } from '../../utils/messageHelpers';
import { JARVIS_AGENT_UUID } from '../../constants/jarvisAgent';
import { isAgentMessage, isEmbeddedAgentRoot, findEmbeddedAgentRoot } from '../../utils/agentThreadDisplay';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../services/apiClient';
import { API_BASE_URL } from '../../config/api';
import { IoArrowForward, IoChevronBack, IoChevronForward, IoChevronDown, IoChevronUp } from 'react-icons/io5';
import './ConversationThread.css';

interface ConversationThreadProps {
    conversationId: string;
    conversationName: string;
    conversationAvatar?: string;
    conversationType?: 'direct' | 'group' | 'agent' | 'group_chat' | 'ai_agent';
}

// Prepending can change the first message's grouping margin or sender label.
// Anchor the visible content, not the outer row whose internal offset changes.
function messageAnchorElement(element: HTMLElement): Element {
    return element.querySelector('.message-text, .attachment-stack, .agent-card') || element;
}

// ── Helper: is this message from an AI agent? ──────────────────────────────
function isJarvisLocalMessage(msg: Message): boolean {
    return msg.framework_agent_uuid === 'jarvis-local' || msg.agent_info?.uuid === 'jarvis-local';
}

function isJarvisThreadRoot(msg: Message): boolean {
    if (!isJarvisLocalMessage(msg)) return false;
    return msg.is_jarvis_thread_root !== false && (!msg.jarvis_thread_root_uuid || msg.jarvis_thread_root_uuid === msg.uuid);
}

function isJarvisThreadChild(msg: Message): boolean {
    return isJarvisLocalMessage(msg) && !!msg.jarvis_thread_root_uuid && msg.jarvis_thread_root_uuid !== msg.uuid;
}

function resolveAgentName(msg: Message): string {
    return (
        msg.agent_info?.name ||
        msg.framework_agent_name ||
        msg.ai_agent_name ||
        msg.agent_name ||
        ((msg.agent_info?.uuid || msg.framework_agent_uuid || msg.ai_agent_uuid || msg.agent_uuid) === JARVIS_AGENT_UUID ? 'Jarvis' : '') ||
        'Agent IA'
    );
}

function getDayKey(value: string | number): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

function formatDaySeparator(value: string | number): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

/** Extract first non-empty text line for collapsed preview */
function getContentPreview(content: string): string {
    if (!content?.trim()) return '';
    const cleaned = normalizeRawAgentContentText(content);
    const parsed = normalizeAgentRenderPayload(content, cleaned);
    if (parsed?.mode === 'structured' && parsed?.data && typeof parsed.data === 'object' && parsed.data !== null) {
        const data = parsed.data as { nodes?: Array<Record<string, unknown>>; blocks?: Array<Record<string, unknown>> };
        const nodes = Array.isArray(data.nodes) ? data.nodes : (Array.isArray(data.blocks) ? data.blocks : []);
        for (const node of nodes) {
            const text = typeof node.text === 'string' ? node.text.trim() : '';
            if (text) return text;
            const title = typeof node.title === 'string' ? node.title.trim() : '';
            if (title) return title;
        }
        if (parsed.fallback_text) return parsed.fallback_text;
    }
    if (parsed?.mode === 'text' && parsed.text) return parsed.text;
    const firstLine = content.split('\n').find(l => l.trim());
    return firstLine?.trim() ?? '';
}

// ── Agent message card ─────────────────────────────────────────────────────
interface AgentCardProps {
    msg: Message;
    threadMessages: Message[];
    isAutoExpanded: boolean;
    isAgentConversation: boolean;
    onReply: (target: ReplyTarget) => void;
}

function AgentCard({ msg, threadMessages, isAutoExpanded, isAgentConversation, onReply }: AgentCardProps) {
    const { user } = useAuth();
    const isWaitingForAgent = useSyncExternalStore(subscribeAgentExecutions,
        () => isThreadExecuting(user?.uuid || '', msg.conversation_uuid || '', msg.uuid));
    const [expanded, setExpanded] = useState(isAutoExpanded);
    const agentUuid = msg.agent_info?.uuid || msg.framework_agent_uuid || msg.ai_agent_uuid || msg.agent_uuid;
    // A thread belongs to its root's target agent. Replies may mention other
    // agents; those must never rename the panel.
    const knownAgentName = [msg, ...threadMessages.filter(message =>
        (message.agent_info?.uuid || message.framework_agent_uuid || message.ai_agent_uuid || message.agent_uuid) === agentUuid
    )].map(resolveAgentName).find(name => name !== 'Agent IA');
    const { data: agentDetail } = useQuery({
        queryKey: ['agent-thread-name', agentUuid],
        enabled: !!agentUuid && !knownAgentName && agentUuid !== 'jarvis-local',
        queryFn: async () => {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agentUuid}/`);
            if (!response.ok) throw new Error('Nom de l’agent indisponible');
            return response.json() as Promise<{ name?: string }>;
        },
        staleTime: 300_000,
    });
    const agentName = knownAgentName || agentDetail?.name || 'Agent IA';
    const preview = getContentPreview(msg.content ?? '');
    const firstVisibleThreadMessage = threadMessages[0] ?? null;
    const firstThreadPrompt = firstVisibleThreadMessage?.content;
    const headerPrompt = (!msg.is_ai_generated && !msg.is_agent_thread_root ? msg.content : firstThreadPrompt) || msg.jarvis_prompt || preview;
    const isConversationMarker = msg.content?.trim().startsWith('💬 Conversation avec');
    const rootIsPrompt = !msg.is_ai_generated && !isConversationMarker && !!msg.content?.trim();
    const leadingThreadMessage = rootIsPrompt ? msg : threadMessages.find(message => !message.is_ai_generated && !message.is_agent_thread_root) || null;
    const trailingThreadMessages = leadingThreadMessage
        ? threadMessages.filter(message => message.uuid !== leadingThreadMessage.uuid)
        : threadMessages;
    const waitingSince = leadingThreadMessage?.web_agent_waiting_since;
    const [expiredWaitSince, setExpiredWaitSince] = useState<number | undefined>();
    const hasAgentAnswer = [msg, ...threadMessages].some(message => message.is_ai_generated
        && !message.is_agent_thread_root && !message.content?.trim().startsWith('💬 Conversation avec'));
    const hasFailed = leadingThreadMessage?.sendError || threadMessages.some(message => message.message_type === 'system');
    const waitingForFirstAnswer = !!waitingSince && !hasAgentAnswer && !hasFailed
        && expiredWaitSince !== waitingSince && Date.now() < waitingSince + 5 * 60_000;
    useEffect(() => {
        if (!waitingSince || hasAgentAnswer || hasFailed) return;
        const timer = window.setTimeout(() => setExpiredWaitSince(waitingSince), Math.max(0, waitingSince + 5 * 60_000 - Date.now()));
        return () => window.clearTimeout(timer);
    }, [waitingSince, hasAgentAnswer, hasFailed]);

    const renderThreadMessage = (tmsg: Message) => {
        const isAgentMsg = !!tmsg.is_ai_generated;
        const isMe = !isAgentMsg && ((tmsg.sender_uuid && user?.uuid)
            ? tmsg.sender_uuid === user.uuid
            : tmsg.sender_username === user?.username);
        const tTime = tmsg.created_at
            ? new Date(tmsg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            : '';
        return (
            <div
                key={tmsg.uuid}
                className={`agent-card__thread-msg ${isAgentMsg ? 'agent-card__thread-msg--agent' : isMe ? 'agent-card__thread-msg--mine' : 'agent-card__thread-msg--theirs'}`}
            >
                {!isAgentMsg && !isMe && (
                    <span className="agent-card__thread-sender">{tmsg.sender_username}</span>
                )}
                <div className={`agent-card__thread-bubble ${isAgentMsg ? 'agent-card__thread-bubble--agent' : isMe ? 'agent-card__thread-bubble--mine' : 'agent-card__thread-bubble--theirs'}`}>
                    <AgentContentRenderer content={tmsg.content} />
                    <span className="agent-card__thread-time">{tTime}</span>
                </div>
            </div>
        );
    };

    if (isAgentConversation) {
        return (
            <div className="agent-conversation-message">
                {msg.isPending ? (
                    <div className="agent-conversation-message__thinking">
                        <span className="agent-conversation-message__spinner" />
                        <span>Agent en cours de réflexion...</span>
                    </div>
                ) : (
                    <AgentContentRenderer content={msg.content} />
                )}
            </div>
        );
    }

    return (
        <div className={`agent-card agent-card--mobile ${expanded ? 'agent-card--expanded' : ''}`}>

            {/* ── Header (always visible) ──────────────────────────────── */}
            <div className="agent-card__topline">
                <span className="agent-card__agent-name">{agentName}</span>
                {expanded && <button
                    type="button"
                    className="agent-card__mobile-toggle"
                    onClick={() => setExpanded(v => !v)}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Replier le panneau agent' : 'Déplier le panneau agent'}
                >
                    <IoChevronUp size={24} />
                </button>}
            </div>

            {!expanded && (
                <button type="button" className="agent-card__mobile-preview" onClick={() => setExpanded(true)}>
                    {headerPrompt || `Discussion avec ${agentName}`}
                </button>
            )}

            {/* ── Expandable body ──────────────────────────────────────── */}
            {expanded && (
            <div className="agent-card__body">

                {/* The user's prompt comes first so the Jarvis answer has its context. */}
                {leadingThreadMessage && (
                    <div className="agent-card__leading-message">
                        {renderThreadMessage(leadingThreadMessage)}
                    </div>
                )}

                {/* Divider */}
                <div className="agent-card__body-divider" />

                {/* Agent response content */}
                {!msg.isPending && msg.content && !isConversationMarker && !rootIsPrompt ? (
                    <div className="agent-card__content">
                        <AgentContentRenderer content={msg.content} />
                    </div>
                ) : threadMessages.length === 0 && !leadingThreadMessage ? (
                    <p className="agent-card__empty">Aucun contenu</p>
                ) : null}

                {/* Thread replies */}
                {trailingThreadMessages.length > 0 && (
                    <div className="agent-card__thread">
                        <div className="agent-card__thread-messages">
                            {trailingThreadMessages.map(renderThreadMessage)}
                        </div>
                    </div>
                )}

                {(isWaitingForAgent || waitingForFirstAnswer) && <div className="agent-card__processing" role="status">
                    <span className="agent-card__processing-dot" aria-hidden="true" /> Analyse en cours…
                </div>}

                <button
                    type="button"
                    className="agent-card__mobile-reply"
                    disabled={msg.isPending || msg.uuid.startsWith('local-')}
                    onClick={() => onReply({
                        uuid: msg.uuid,
                        sender_username: agentName,
                        content: 'Discussion avec agent IA',
                        isAgentThread: true,
                        aiAgentUuid: agentUuid,
                    })}
                    aria-label="Répondre dans le thread"
                >
                    <IoArrowForward size={17} aria-hidden="true" />
                </button>

            </div>
            )}
        </div>
    );
}

// ── Main ConversationThread ──────────────────────────────────────────────────
export function ConversationThread({
    conversationId,
    conversationName,
    conversationAvatar,
    conversationType,
}: ConversationThreadProps) {
    const { user } = useAuth();
    const { messages, isLoading, isFetchingMore, hasMore, loadMore, sendMessage, markAsRead } = useMessages(conversationId);
    const { getLocalConversationMessages } = useJarvis();
    const localJarvisMessages = getLocalConversationMessages(conversationId);
    const { isConnected } = useWebSocketMessages(conversationId);
    const {
        registerSendCallback,
        openConversationManagement,
        replyTo,
        setReplyTo,
        isSidebarPanelOpen,
        toggleSidebarPanel,
    } = useNavigation();
    const replyToRef = useRef(replyTo);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const topHistorySentinelRef = useRef<HTMLDivElement>(null);
    const scrollEndRef = useRef<HTMLDivElement>(null);
    const initialScrollDoneRef = useRef(false);
    const shouldStickToBottomRef = useRef(true);
    const pendingHistoryAnchorRef = useRef<{ anchorUuid: string; offsetTop: number } | null>(null);
    const postHistoryResizeAnchorRef = useRef<{ anchorUuid: string; offsetTop: number; expiresAt: number } | null>(null);
    const historyLoadInFlightRef = useRef(false);
    const historyResizeObserverRef = useRef<ResizeObserver | null>(null);
    const [historyError, setHistoryError] = useState(false);
    const historyTopTriggerArmedRef = useRef(true);
    const lastHistoryLoadAtRef = useRef(0);
    const lastHistoryOldestUuidRef = useRef<string | null>(null);
    const lastHistoryMessageCountRef = useRef(-1);
    const messageElementByUuidRef = useRef(new Map<string, HTMLDivElement>());
    const daySeparatorElementByKeyRef = useRef(new Map<string, HTMLSpanElement>());
    const stickyDayLabelRef = useRef<HTMLSpanElement>(null);
    const dayBubbleAnimationTimeoutRef = useRef<number | null>(null);
    const [expandedReplyMessages, setExpandedReplyMessages] = useState<Set<string>>(new Set());
    const [stickyDayKey, setStickyDayKey] = useState<string>('');
    const [stickyDayLabel, setStickyDayLabel] = useState<string>('');
    const [stickyDayAnimating, setStickyDayAnimating] = useState(false);
    const [stickyDayDocked, setStickyDayDocked] = useState(false);

    const sendMutateRef = useRef(sendMessage.mutateAsync);

    useEffect(() => {
        replyToRef.current = replyTo;
    }, [replyTo]);

    useEffect(() => {
        sendMutateRef.current = sendMessage.mutateAsync;
    }, [sendMessage.mutateAsync]);

    const isGroupConversation = conversationType === 'group';
    const isAgentConversation = conversationType === 'agent' || conversationType === 'ai_agent';


    useEffect(() => {
        registerSendCallback({
            sendText: (text, parentMessageUuid, aiAgentUuid, agentThread, clientMessageId) => {
                return sendMutateRef.current({
                    aiAgentUuid,
                    agentThread,
                    conversationId,
                    content: text,
                    clientMessageId,
                    parentMessageUuid: parentMessageUuid ?? replyToRef.current?.uuid,
                });
            },
            sendFiles: (text, files, parentMessageUuid, aiAgentUuid, agentThread, clientMessageId) => {
                return sendMutateRef.current({
                    aiAgentUuid,
                    agentThread,
                    conversationId,
                    content: text,
                    files,
                    clientMessageId,
                    parentMessageUuid: parentMessageUuid ?? replyToRef.current?.uuid,
                });
            },
        });
        return () => registerSendCallback(null);
    }, [conversationId, registerSendCallback, setReplyTo]);

    useEffect(() => {
        if (conversationId) markAsRead();
    }, [conversationId, markAsRead]);

    useEffect(() => {
        initialScrollDoneRef.current = false;
        shouldStickToBottomRef.current = true;
        pendingHistoryAnchorRef.current = null;
        setHistoryError(false);
        postHistoryResizeAnchorRef.current = null;
        historyLoadInFlightRef.current = false;
        historyTopTriggerArmedRef.current = true;
        lastHistoryLoadAtRef.current = 0;
        lastHistoryOldestUuidRef.current = null;
        lastHistoryMessageCountRef.current = -1;
        setExpandedReplyMessages(new Set());
        setStickyDayKey('');
        setStickyDayLabel('');
        setStickyDayAnimating(false);
        setStickyDayDocked(false);
    }, [conversationId]);

    useEffect(() => {
        return () => {
            if (dayBubbleAnimationTimeoutRef.current) {
                window.clearTimeout(dayBubbleAnimationTimeoutRef.current);
            }
        };
    }, []);

    const mergedMessages = useMemo(() => {
        const byUuid = new Map<string, Message>();
        messages.forEach((message) => {
            if (user?.ai_agents_enabled === false && (isAgentMessage(message) || message.is_agent_thread_root)) return;
            // Attachment sends can briefly produce a server/optimistic record
            // with neither text nor attachment metadata. Do not render that
            // transport placeholder as an empty chat bubble.
            if (
                !isAgentMessage(message) &&
                !isSystemMessage(message) &&
                !message.content?.trim() &&
                !(message.attachments && message.attachments.length > 0)
            ) return;
            byUuid.set(message.uuid, message);
        });
        localJarvisMessages.forEach((message) => byUuid.set(message.uuid, message));
        return Array.from(byUuid.values()).filter(message => user?.ai_agents_enabled !== false || (!isAgentMessage(message) && !message.is_agent_thread_root));
    }, [messages, localJarvisMessages, user?.ai_agents_enabled]);

    const orderedMessages = useMemo(() => mergedMessages.slice().reverse(), [mergedMessages]);
    const oldestRenderedMessageUuid = orderedMessages[0]?.uuid ?? null;

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        const container = messagesContainerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
    }, []);

    const captureVisibleAnchor = useCallback((): { anchorUuid: string; offsetTop: number } | null => {
        const container = messagesContainerRef.current;
        if (!container) return null;

        const containerRect = container.getBoundingClientRect();
        let best: { anchorUuid: string; offsetTop: number } | null = null;

        for (const message of orderedMessages) {
            const element = messageElementByUuidRef.current.get(message.uuid);
            if (!element) continue;

            const rect = messageAnchorElement(element).getBoundingClientRect();
            if (rect.bottom <= containerRect.top) continue;
            if (rect.top >= containerRect.bottom) continue;

            best = {
                anchorUuid: message.uuid,
                offsetTop: rect.top - containerRect.top,
            };
            break;
        }

        return best;
    }, [orderedMessages]);

    const updateStickyDayLabel = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container || orderedMessages.length === 0) return;

        const containerRect = container.getBoundingClientRect();
        const scanTop = containerRect.top + 6;
        let nextDayKey = getDayKey(orderedMessages[0].created_at);
        let nextDayLabel = formatDaySeparator(orderedMessages[0].created_at);

        for (const message of orderedMessages) {
            const element = messageElementByUuidRef.current.get(message.uuid);
            if (!element) continue;

            const rect = element.getBoundingClientRect();
            if (rect.bottom <= scanTop) continue;

            nextDayKey = getDayKey(message.created_at);
            nextDayLabel = formatDaySeparator(message.created_at);
            break;
        }

        const activeSeparator = daySeparatorElementByKeyRef.current.get(nextDayKey);
        const activeSeparatorRect = activeSeparator?.getBoundingClientRect();
        const stickyRect = stickyDayLabelRef.current?.getBoundingClientRect();
        const stickyDockBottom = stickyRect?.bottom ?? (containerRect.top + 18);
        const nextDocked = !!activeSeparatorRect && activeSeparatorRect.bottom <= stickyDockBottom;

        if (stickyDayKey === nextDayKey && stickyDayLabel === nextDayLabel) {
            setStickyDayDocked(nextDocked);
            return;
        }

        setStickyDayAnimating(true);
        if (dayBubbleAnimationTimeoutRef.current) {
            window.clearTimeout(dayBubbleAnimationTimeoutRef.current);
        }
        dayBubbleAnimationTimeoutRef.current = window.setTimeout(() => {
            setStickyDayAnimating(false);
        }, 360);

        setStickyDayKey(nextDayKey);
        setStickyDayLabel(nextDayLabel);
        setStickyDayDocked(nextDocked);
    }, [orderedMessages, stickyDayKey, stickyDayLabel]);

    const triggerLoadOlderMessages = useCallback((reason: 'nearTop') => {
        void reason;
        const container = messagesContainerRef.current;
        if (!container) return;
        if (!hasMore || isFetchingMore || historyError) return;
        if (historyLoadInFlightRef.current) return;
        if (!historyTopTriggerArmedRef.current) return;

        const now = Date.now();
        if (now - lastHistoryLoadAtRef.current < 500) return;

        const currentMessageCount = orderedMessages.length;
        const repeatedSameCursorTooSoon =
            !!oldestRenderedMessageUuid &&
            oldestRenderedMessageUuid === lastHistoryOldestUuidRef.current &&
            now - lastHistoryLoadAtRef.current < 1500;
        if (repeatedSameCursorTooSoon) return;

        pendingHistoryAnchorRef.current = captureVisibleAnchor();
        historyLoadInFlightRef.current = true;
        historyTopTriggerArmedRef.current = false;
        lastHistoryLoadAtRef.current = now;
        lastHistoryOldestUuidRef.current = oldestRenderedMessageUuid;
        lastHistoryMessageCountRef.current = currentMessageCount;

        loadMore({ cancelRefetch: false, throwOnError: true })
            .then(result => {
                if (!result.data?.pages.at(-1)?.messages.length) {
                    pendingHistoryAnchorRef.current = null;
                }
            })
            .catch((error) => {
                console.warn('Failed to load older messages:', error);
                setHistoryError(true);
                pendingHistoryAnchorRef.current = null;
                historyTopTriggerArmedRef.current = true;
                lastHistoryOldestUuidRef.current = null;
                lastHistoryMessageCountRef.current = -1;
            })
            .finally(() => {
                historyLoadInFlightRef.current = false;
                window.setTimeout(() => {
                    const currentContainer = messagesContainerRef.current;
                    if (!currentContainer) return;
                    if (currentContainer.scrollTop <= 120) {
                        historyTopTriggerArmedRef.current = true;
                    }
                }, 80);
            });
    }, [captureVisibleAnchor, hasMore, isFetchingMore, historyError, loadMore, oldestRenderedMessageUuid, orderedMessages.length]);

    const maybeLoadOlderMessages = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        if (!hasMore || isFetchingMore) return;

        const isNearTop = container.scrollTop <= 120;
        const doesNotOverflowEnough = container.scrollHeight <= container.clientHeight + 160;

        if (isNearTop || doesNotOverflowEnough) {
            triggerLoadOlderMessages('nearTop');
        }
    }, [hasMore, isFetchingMore, triggerLoadOlderMessages]);

    const handleMessagesScroll = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        if (historyLoadInFlightRef.current && pendingHistoryAnchorRef.current) {
            pendingHistoryAnchorRef.current = captureVisibleAnchor();
        }

        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        shouldStickToBottomRef.current = distanceToBottom < 96;

        if (container.scrollTop > 220) {
            historyTopTriggerArmedRef.current = true;
        }

        if (container.scrollTop <= 120) {
            triggerLoadOlderMessages('nearTop');
        }
        updateStickyDayLabel();
    }, [captureVisibleAnchor, triggerLoadOlderMessages, updateStickyDayLabel]);

    useLayoutEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        if (pendingHistoryAnchorRef.current) {
            // A loading-state render must not consume the anchor before the
            // older page is actually inserted.
            if (orderedMessages.length === lastHistoryMessageCountRef.current) return;
            const { anchorUuid, offsetTop } = pendingHistoryAnchorRef.current;
            const anchorElement = messageElementByUuidRef.current.get(anchorUuid);
            if (anchorElement) {
                const containerRect = container.getBoundingClientRect();
                const rect = messageAnchorElement(anchorElement).getBoundingClientRect();
                container.scrollTop += (rect.top - containerRect.top) - offsetTop;
            }
            pendingHistoryAnchorRef.current = null;
            postHistoryResizeAnchorRef.current = {
                anchorUuid,
                offsetTop,
                expiresAt: Date.now() + 1800,
            };
            historyTopTriggerArmedRef.current = true;
            return;
        }

        if (!initialScrollDoneRef.current && orderedMessages.length > 0) {
            scrollToBottom('auto');
            initialScrollDoneRef.current = true;
            shouldStickToBottomRef.current = true;
            return;
        }

        if (shouldStickToBottomRef.current) {
            scrollToBottom('auto');
        }
        updateStickyDayLabel();
    }, [orderedMessages.length, scrollToBottom, updateStickyDayLabel]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            maybeLoadOlderMessages();
        });

        return () => window.cancelAnimationFrame(frame);
    }, [maybeLoadOlderMessages, orderedMessages.length]);

    useEffect(() => {
        if (isFetchingMore || !hasMore) return;
        const container = messagesContainerRef.current;
        if (!container) return;

        if (container.scrollTop <= 120) {
            const timeout = window.setTimeout(() => {
                maybeLoadOlderMessages();
            }, 120);
            return () => window.clearTimeout(timeout);
        }
        return undefined;
    }, [hasMore, isFetchingMore, maybeLoadOlderMessages, orderedMessages.length]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        const sentinel = topHistorySentinelRef.current;
        if (!container || !sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting) {
                    triggerLoadOlderMessages('nearTop');
                }
            },
            {
                root: container,
                threshold: 0.1,
                rootMargin: '120px 0px 0px 0px',
            }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [triggerLoadOlderMessages]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            const anchor = postHistoryResizeAnchorRef.current;
            if (!anchor) return;

            if (Date.now() > anchor.expiresAt) {
                postHistoryResizeAnchorRef.current = null;
                return;
            }

            const anchorElement = messageElementByUuidRef.current.get(anchor.anchorUuid);
            if (!anchorElement) return;

            const containerRect = container.getBoundingClientRect();
            const rect = messageAnchorElement(anchorElement).getBoundingClientRect();
            const delta = (rect.top - containerRect.top) - anchor.offsetTop;
            if (delta === 0) return;

            container.scrollTop += delta;
            postHistoryResizeAnchorRef.current = {
                anchorUuid: anchor.anchorUuid,
                offsetTop: anchor.offsetTop,
                expiresAt: anchor.expiresAt,
            };
        });

        historyResizeObserverRef.current = observer;
        observer.observe(container);
        messageElementByUuidRef.current.forEach(element => observer.observe(element));
        return () => { observer.disconnect(); historyResizeObserverRef.current = null; };
    }, []);

    const registerMessageElement = useCallback((uuid: string, element: HTMLDivElement | null) => {
        if (element) {
            const previous = messageElementByUuidRef.current.get(uuid);
            if (previous && previous !== element) historyResizeObserverRef.current?.unobserve(previous);
            messageElementByUuidRef.current.set(uuid, element);
            historyResizeObserverRef.current?.observe(element);
            return;
        }
        const previous = messageElementByUuidRef.current.get(uuid);
        if (previous) historyResizeObserverRef.current?.unobserve(previous);
        messageElementByUuidRef.current.delete(uuid);
    }, []);

    const registerDaySeparatorElement = useCallback((dayKey: string, element: HTMLSpanElement | null) => {
        if (element) {
            daySeparatorElementByKeyRef.current.set(dayKey, element);
            return;
        }
        daySeparatorElementByKeyRef.current.delete(dayKey);
    }, []);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || !stickyDayKey) return;

        const updateDockState = () => {
            const containerRect = container.getBoundingClientRect();
            const activeSeparator = daySeparatorElementByKeyRef.current.get(stickyDayKey);
            const activeSeparatorRect = activeSeparator?.getBoundingClientRect();
            const stickyRect = stickyDayLabelRef.current?.getBoundingClientRect();
            const stickyDockBottom = stickyRect?.bottom ?? (containerRect.top + 18);
            setStickyDayDocked(!!activeSeparatorRect && activeSeparatorRect.bottom <= stickyDockBottom);
        };

        updateDockState();
        const raf = window.requestAnimationFrame(updateDockState);
        return () => window.cancelAnimationFrame(raf);
    }, [orderedMessages.length, stickyDayKey]);

    const childrenByParent = useMemo(() => {
        const map = new Map<string, Message[]>();
        for (const msg of orderedMessages) {
            if (!msg.parent_message_uuid) continue;
            const list = map.get(msg.parent_message_uuid) || [];
            list.push(msg);
            map.set(msg.parent_message_uuid, list);
        }
        map.forEach((list) => {
            list.sort((left, right) => {
                const leftTs = typeof left.created_at === 'number' ? left.created_at : Date.parse(String(left.created_at)) || 0;
                const rightTs = typeof right.created_at === 'number' ? right.created_at : Date.parse(String(right.created_at)) || 0;
                if (leftTs !== rightTs) return leftTs - rightTs;
                return String(left.uuid).localeCompare(String(right.uuid));
            });
        });
        return map;
    }, [orderedMessages]);

    const embeddedThreads = useMemo(() => {
        const byUuid = new Map(orderedMessages.map(message => [message.uuid, message]));
        const threads = new Map<string, Message[]>();
        const replyUuids = new Set<string>();
        for (const message of orderedMessages) {
            const root = findEmbeddedAgentRoot(message, byUuid, isAgentConversation);
            if (root) {
                threads.set(root.uuid, [...(threads.get(root.uuid) || []), message]);
                replyUuids.add(message.uuid);
            }
        }
        // Mobile compatibility: older manual invocations stored the initial
        // user prompt immediately before the agent root, without a parent.
        for (const root of orderedMessages) {
            if (!isEmbeddedAgentRoot(root, isAgentConversation) || replyUuids.has(root.uuid)) continue;
            const children = threads.get(root.uuid) || [];
            const rootTime = new Date(root.created_at).getTime();
            // Only an initial prompt already attached to the root replaces the
            // legacy pairing. Later human replies must not detach that prompt.
            const hasInitialPrompt = children.some(child =>
                !child.is_ai_generated && !child.is_agent_thread_root
                && new Date(child.created_at).getTime() <= rootTime
            );
            if ((!root.is_ai_generated && !root.is_agent_thread_root) || hasInitialPrompt) continue;
            const index = orderedMessages.indexOf(root);
            const prompt = orderedMessages.slice(0, index).reverse().find(candidate => {
                const elapsed = new Date(root.created_at).getTime() - new Date(candidate.created_at).getTime();
                const targetUuid = candidate.ai_agent_uuid;
                const rootAgentUuid = root.agent_info?.uuid || root.framework_agent_uuid || root.ai_agent_uuid || root.agent_uuid;
                const isUserPrompt = !candidate.is_ai_generated && !candidate.is_agent_thread_root
                    && (!isAgentMessage(candidate) || (!!targetUuid && targetUuid === rootAgentUuid))
                    && (!isAgentConversation || isEmbeddedAgentRoot(candidate, true));
                return isUserPrompt && !candidate.parent_message_uuid && !replyUuids.has(candidate.uuid)
                    && !!candidate.content?.trim() && elapsed >= 0 && elapsed <= 30_000;
            });
            if (prompt) {
                threads.set(root.uuid, [prompt, ...children]);
                replyUuids.add(prompt.uuid);
            }
        }
        return { threads, replyUuids };
    }, [orderedMessages, isAgentConversation]);
    const agentReplyUuids = embeddedThreads.replyUuids;

    // Build reaction map and set of reaction event UUIDs
    const { reactionByMessageUuid } = useMemo(
        () => extractReactionMapFromMessages(orderedMessages),
        [orderedMessages]
    );

    // Fast uuid → message lookup (for reply quotes)
    const messageByUuid = useMemo(() => {
        const map = new Map<string, Message>();
        for (const msg of orderedMessages) map.set(msg.uuid, msg);
        return map;
    }, [orderedMessages]);

    const buildReplyAncestry = useCallback((message: Message): Message[] => {
        const ancestry: Message[] = [];
        let parentUuid = message.parent_message_uuid || null;
        const visited = new Set<string>();

        while (parentUuid && !visited.has(parentUuid)) {
            visited.add(parentUuid);
            const parentMessage = messageByUuid.get(parentUuid);
            if (!parentMessage) break;
            ancestry.unshift(parentMessage);
            parentUuid = parentMessage.parent_message_uuid || null;
        }

        return ancestry;
    }, [messageByUuid]);

    const toggleReplyExpansion = useCallback((messageUuid: string) => {
        setExpandedReplyMessages((previous) => {
            const next = new Set(previous);
            if (next.has(messageUuid)) {
                next.delete(messageUuid);
            } else {
                next.add(messageUuid);
            }
            return next;
        });
    }, []);

    // Compute stable sequential colors for participants seen in messages
    const senderColorMap = useMemo(() => {
        const map = new Map<string, string>();
        let colorIndex = 0;
        
        for (const msg of orderedMessages) {
            const key = msg.sender_uuid || msg.sender_username;
            if (key && key !== user?.uuid && key !== user?.username && !msg.is_ai_generated) {
                if (!map.has(key)) {
                    map.set(key, USER_COLORS[colorIndex % USER_COLORS.length]);
                    colorIndex++;
                }
            }
        }
        
        return map;
    }, [orderedMessages, user]);

    // Send a reaction
    const handleReact = useCallback((targetMessageUuid: string, emoji: string) => {
        const content = buildMessageReactionContent(targetMessageUuid, emoji);
        void sendMutateRef.current({ conversationId, content }).catch(() => undefined);
    }, [conversationId]);

    const handleReply = useCallback((msg: Message) => {
        setReplyTo({ uuid: msg.uuid, sender_username: msg.sender_username, content: msg.content, attachments: msg.attachments });
    }, [setReplyTo]);

    const showStatusDot = isConnected && (isAgentConversation || conversationType === 'direct');

    return (
        <div className="conversation-thread">
            {/* Mobile-style split header bubbles */}
            <div className="thread-header">
                <button
                    type="button"
                    className="thread-back-btn"
                    onClick={toggleSidebarPanel}
                    title={isSidebarPanelOpen ? 'Fermer la liste' : 'Ouvrir la liste'}
                    aria-label={isSidebarPanelOpen ? 'Fermer la liste des conversations' : 'Ouvrir la liste des conversations'}
                >
                    {isSidebarPanelOpen
                        ? <IoChevronBack size={22} />
                        : <IoChevronForward size={22} />}
                </button>
                <button type="button" className="thread-header-info" onClick={openConversationManagement}>
                    {conversationAvatar ? (
                        <img src={conversationAvatar} alt={conversationName} className="thread-header-avatar" />
                    ) : (
                        <div className="thread-header-avatar-placeholder">
                            {conversationName.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <span className="thread-header-name" title={conversationName}>
                        {conversationName}
                    </span>
                    {showStatusDot && <span className="thread-status-dot" />}
                </button>
            </div>

            {!!stickyDayLabel && (
                <div className={`thread-sticky-day${stickyDayDocked ? ' thread-sticky-day--docked' : ''}${stickyDayAnimating ? ' thread-sticky-day--animate' : ''}`}>
                    <span ref={stickyDayLabelRef} className="thread-sticky-day__label">{stickyDayLabel}</span>
                </div>
            )}

            {/* Messages area */}
            <div
                ref={messagesContainerRef}
                className="thread-messages"
                onScroll={handleMessagesScroll}
                onWheel={() => { postHistoryResizeAnchorRef.current = null; }}
                onTouchMove={() => { postHistoryResizeAnchorRef.current = null; }}
            >
                <div ref={topHistorySentinelRef} className="thread-history-sentinel" aria-hidden="true" />
                {isLoading && orderedMessages.length === 0 ? (
                    <div className="thread-loading">Chargement des messages...</div>
                ) : (
                    <>
                        <div className="thread-history-slot">
                        {isFetchingMore && (
                            <div className="thread-history-loading" role="status" aria-label="Chargement des messages précédents">
                                <span className="thread-history-spinner" aria-hidden="true" />
                            </div>
                        )}
                        {historyError && <button className="thread-history-retry" onClick={() => {
                            historyTopTriggerArmedRef.current = true;
                            lastHistoryLoadAtRef.current = 0;
                            setHistoryError(false);
                        }}>Réessayer le chargement</button>}
                        </div>
                        {orderedMessages.map((msg, index, arr) => {
                        if (agentReplyUuids.has(msg.uuid)) return null;

                        // Skip reaction event messages (they're virtual, not displayed)
                        if (isReactionEventMessage(msg.content)) return null;

                        // Agent message → expandable card
                        if (isAgentMessage(msg) && (!isJarvisLocalMessage(msg) || isJarvisThreadRoot(msg))) {
                            const directChildren = embeddedThreads.threads.get(msg.uuid) || [];
                            const localJarvisChildren = orderedMessages.filter((candidate) =>
                                candidate.uuid !== msg.uuid &&
                                candidate.jarvis_thread_root_uuid === msg.uuid
                            );
                            const threadMessages = Array.from(
                                new Map([...directChildren, ...localJarvisChildren].map((message) => [message.uuid, message]))
                                    .values()
                            ).sort((left, right) => {
                                const leftTs = typeof left.created_at === 'number' ? left.created_at : Date.parse(String(left.created_at)) || 0;
                                const rightTs = typeof right.created_at === 'number' ? right.created_at : Date.parse(String(right.created_at)) || 0;
                                return leftTs - rightTs;
                            });
                            return (
                                <div key={msg.uuid} ref={(element) => registerMessageElement(msg.uuid, element)} className="thread-message-item">
                                    <AgentCard
                                        msg={msg}
                                        threadMessages={threadMessages}
                                        isAutoExpanded={isAgentConversation && !isEmbeddedAgentRoot(msg, true)}
                                        isAgentConversation={isAgentConversation && !isEmbeddedAgentRoot(msg, true)}
                                        onReply={setReplyTo}
                                    />
                                </div>
                            );
                        }

                        // System message
                        if (isSystemMessage(msg)) {
                            return (
                                <div key={msg.uuid} ref={(element) => registerMessageElement(msg.uuid, element)} className="thread-message-item">
                                    <div className="system-message-container">
                                        <span className="system-message-text">{msg.content}</span>
                                        <span className="system-message-time">
                                            {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            );
                        }

                        // Normal message — grouping
                        const prevMsg = arr[index - 1] ?? null;
                        const nextMsg = arr[index + 1] ?? null;
                        const dayKey = getDayKey(msg.created_at);
                        const showDaySeparator = !prevMsg || getDayKey(prevMsg.created_at) !== dayKey;

                        const prevNormal = prevMsg && !agentReplyUuids.has(prevMsg.uuid) && !isAgentMessage(prevMsg) ? prevMsg : null;
                        const nextNormal = nextMsg && !agentReplyUuids.has(nextMsg.uuid) && !isAgentMessage(nextMsg) ? nextMsg : null;

                        const sameSender = (a: Message | null, b: Message) =>
                            !!a && ((a.sender_uuid && b.sender_uuid)
                                ? a.sender_uuid === b.sender_uuid
                                : a.sender_username === b.sender_username);

                        const canVisuallyGroup = (a: Message | null, b: Message) => {
                            if (!a) return false;
                            if (!sameSender(a, b)) return false;

                            const aParent = a.parent_message_uuid || null;
                            const bParent = b.parent_message_uuid || null;

                            if (aParent !== bParent) return false;
                            if (!!aParent !== !!bParent) return false;

                            const aHasReplyQuote = !!a.parent_message_uuid;
                            const bHasReplyQuote = !!b.parent_message_uuid;
                            if (aHasReplyQuote !== bHasReplyQuote) return false;

                            if (Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) > 5 * 60 * 1000) return false;

                            return true;
                        };

                        const replyAncestry = msg.parent_message_uuid ? buildReplyAncestry(msg) : [];
                        const replyDirectParent = replyAncestry.length > 0 ? replyAncestry[replyAncestry.length - 1] : null;
                        const siblingReplies = replyDirectParent
                            ? (childrenByParent.get(replyDirectParent.uuid) || []).filter((candidate) => candidate.uuid !== msg.uuid)
                            : [];

                        return (
                            <React.Fragment key={msg.uuid || msg.id}>
                                {showDaySeparator && (
                                    <div className="thread-day-separator">
                                        <span
                                            ref={(element) => registerDaySeparatorElement(dayKey, element)}
                                            className="thread-day-separator__label"
                                        >
                                            {formatDaySeparator(msg.created_at)}
                                        </span>
                                    </div>
                                )}
                                <div ref={(element) => registerMessageElement(msg.uuid, element)} className="thread-message-item">
                                    <MessageBubble
                                        message={msg}
                                        isFirstInGroup={!canVisuallyGroup(prevNormal, msg)}
                                        isLastInGroup={!canVisuallyGroup(nextNormal, msg)}
                                        isSameSenderAsNext={canVisuallyGroup(nextNormal, msg)}
                                        isSameSenderAsPrev={canVisuallyGroup(prevNormal, msg)}
                                        isGroupConversation={isGroupConversation}
                                        senderColor={senderColorMap.get(msg.sender_uuid || '') || senderColorMap.get(msg.sender_username || '')}
                                        reactionEmojis={reactionByMessageUuid[msg.uuid] || []}
                                        replyParent={replyDirectParent}
                                        replyAncestry={replyAncestry}
                                        replySiblingMessages={siblingReplies}
                                        isReplyExpanded={expandedReplyMessages.has(msg.uuid)}
                                        onToggleReplyExpanded={toggleReplyExpansion}
                                        onReact={handleReact}
                                        onReply={handleReply}
                                    />
                                </div>
                            </React.Fragment>
                        );
                        })}
                    </>
                )}
                <div ref={scrollEndRef} />
            </div>

        </div>
    );
}
