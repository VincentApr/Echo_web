import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { PageId } from '../components/layout/Sidebar';
import type { Conversation } from '../hooks/useConversations';

export interface ChatSendCallback {
    sendText: (text: string, parentMessageUuid?: string | null, aiAgentUuid?: string | null, agentThread?: boolean, clientMessageId?: string) => Promise<unknown>;
    sendFiles: (text: string, files: File[], parentMessageUuid?: string | null, aiAgentUuid?: string | null, agentThread?: boolean, clientMessageId?: string) => Promise<unknown>;
}

/** Minimal message info needed to display a reply preview */
export interface ReplyTarget {
    uuid: string;
    sender_username: string;
    content: string;
    attachments?: { file_type: string }[];
    isAgentThread?: boolean;
    aiAgentUuid?: string;
}

interface NavigationContextType {
    currentPage: PageId;
    watchUuid: string | null;
    openWatch: (uuid: string) => void;
    closeWatch: () => void;
    selectedConversation: Conversation | null;
    conversationView: 'thread' | 'management';
    isSidebarPanelOpen: boolean;
    navigate: (page: PageId) => void;
    toggleSidebarPanel: () => void;
    openConversation: (conv: Conversation) => void;
    closeConversation: () => void;
    openConversationManagement: () => void;
    closeConversationManagement: () => void;
    /** Registered by ConversationThread so WebBottomBar can trigger sends */
    registerSendCallback: (cb: ChatSendCallback | null) => void;
    sendCallback: React.RefObject<ChatSendCallback | null>;
    /** Reply-to state shared between ConversationThread and WebBottomBar */
    replyTo: ReplyTarget | null;
    setReplyTo: (target: ReplyTarget | null) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

const CONV_TYPE_TO_PAGE: Record<string, PageId> = {
    direct: 'conversations',
    group: 'groups',
    group_chat: 'groups',
    agent: 'agents',
    ai_agent: 'agents',
};

type ConversationPage = 'conversations' | 'groups' | 'agents';
type ConversationView = 'thread' | 'management';

interface TabMemory {
    conversation: Conversation | null;
    view: ConversationView;
    isPanelOpen: boolean;
    replyTo: ReplyTarget | null;
}

const PAGE_TO_CONVERSATION_TAB: Partial<Record<PageId, ConversationPage>> = {
    conversations: 'conversations',
    'add-friend': 'conversations',
    groups: 'groups',
    'add-group': 'groups',
    agents: 'agents',
    'add-agent': 'agents',
};

const createInitialTabMemories = (): Record<ConversationPage, TabMemory> => ({
    conversations: { conversation: null, view: 'thread', isPanelOpen: false, replyTo: null },
    groups: { conversation: null, view: 'thread', isPanelOpen: false, replyTo: null },
    agents: { conversation: null, view: 'thread', isPanelOpen: false, replyTo: null },
});

export function NavigationProvider({ children }: { children: React.ReactNode }) {
    const initialWatch = () => window.location.pathname.match(/^\/veilles\/([0-9a-f-]{36})\/?$/i)?.[1] ?? null;
    const [watchUuid, setWatchUuid] = useState<string | null>(initialWatch);
    const [currentPage, setCurrentPage] = useState<PageId>(() => initialWatch() ? 'watch' : 'home');
    const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
    const [conversationView, setConversationView] = useState<'thread' | 'management'>('thread');
    const [isSidebarPanelOpen, setIsSidebarPanelOpen] = useState(false);
    const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
    const sendCallbackRef = useRef<ChatSendCallback | null>(null);
    const currentPageRef = useRef<PageId>('home');
    const selectedConversationRef = useRef<Conversation | null>(null);
    const conversationViewRef = useRef<ConversationView>('thread');
    const sidebarPanelOpenRef = useRef(false);
    const replyToRef = useRef<ReplyTarget | null>(null);
    const tabMemoriesRef = useRef(createInitialTabMemories());

    const CONV_PAGES = new Set<PageId>(['conversations', 'groups', 'agents', 'add-friend', 'add-group', 'add-agent']);

    const applyTabMemory = useCallback((memory: TabMemory) => {
        selectedConversationRef.current = memory.conversation;
        conversationViewRef.current = memory.view;
        sidebarPanelOpenRef.current = memory.isPanelOpen;
        replyToRef.current = memory.replyTo;
        setSelectedConversation(memory.conversation);
        setConversationView(memory.view);
        setIsSidebarPanelOpen(memory.isPanelOpen);
        setReplyTo(memory.replyTo);
    }, []);

    const saveCurrentTab = useCallback(() => {
        const currentTab = PAGE_TO_CONVERSATION_TAB[currentPageRef.current];
        if (!currentTab || currentPageRef.current.startsWith('add-')) return;
        tabMemoriesRef.current[currentTab] = {
            conversation: selectedConversationRef.current,
            view: conversationViewRef.current,
            isPanelOpen: sidebarPanelOpenRef.current,
            replyTo: replyToRef.current,
        };
    }, []);

    const navigate = useCallback((page: PageId) => {
        saveCurrentTab();
        if (page !== 'watch') {
            setWatchUuid(null);
            if (window.location.pathname.startsWith('/veilles/')) window.history.pushState({}, '', '/');
        }
        const targetTab = PAGE_TO_CONVERSATION_TAB[page];
        currentPageRef.current = page;
        setCurrentPage(page);
        sendCallbackRef.current = null;

        if (targetTab) {
            const memory = tabMemoriesRef.current[targetTab];
            if (page.startsWith('add-')) memory.isPanelOpen = true;
            applyTabMemory(memory);
            return;
        }

        selectedConversationRef.current = null;
        conversationViewRef.current = 'thread';
        sidebarPanelOpenRef.current = false;
        replyToRef.current = null;
        setSelectedConversation(null);
        setConversationView('thread');
        setIsSidebarPanelOpen(false);
        setReplyTo(null);
    }, [applyTabMemory, saveCurrentTab]);

    const openWatch = useCallback((uuid: string) => {
        if (window.location.pathname !== `/veilles/${uuid}`) window.history.pushState({ echoWatch: true }, '', `/veilles/${uuid}`);
        setWatchUuid(uuid);
        navigate('watch');
    }, [navigate]);

    const closeWatch = useCallback(() => {
        if (window.history.state?.echoWatch) {
            // Return directly to the grid, even after browsing several subjects.
            window.history.replaceState({}, '', '/');
        }
        navigate('home');
    }, [navigate]);

    useEffect(() => {
        const restore = () => {
            const uuid = window.location.pathname.match(/^\/veilles\/([0-9a-f-]{36})\/?$/i)?.[1] ?? null;
            setWatchUuid(uuid);
            navigate(uuid ? 'watch' : 'home');
        };
        window.addEventListener('popstate', restore);
        return () => window.removeEventListener('popstate', restore);
    }, [navigate]);

    const openConversation = useCallback((conv: Conversation) => {
        setWatchUuid(null);
        if (window.location.pathname.startsWith('/veilles/')) window.history.pushState({}, '', '/');
        const targetPage = (CONV_TYPE_TO_PAGE[conv.conversation_type] ?? 'conversations') as ConversationPage;
        saveCurrentTab();
        const memory: TabMemory = {
            conversation: conv,
            view: 'thread',
            isPanelOpen: true,
            replyTo: null,
        };
        tabMemoriesRef.current[targetPage] = memory;
        currentPageRef.current = targetPage;
        selectedConversationRef.current = conv;
        conversationViewRef.current = 'thread';
        sidebarPanelOpenRef.current = true;
        replyToRef.current = null;
        setSelectedConversation(conv);
        setConversationView('thread');
        setCurrentPage(targetPage);
        setIsSidebarPanelOpen(true);
        setReplyTo(null);
    }, [saveCurrentTab]);

    const toggleSidebarPanel = useCallback(() => {
        setIsSidebarPanelOpen(open => {
            const next = !open;
            sidebarPanelOpenRef.current = next;
            const tab = PAGE_TO_CONVERSATION_TAB[currentPageRef.current];
            if (tab) tabMemoriesRef.current[tab].isPanelOpen = next;
            return next;
        });
    }, []);

    const closeConversation = useCallback(() => {
        sidebarPanelOpenRef.current = false;
        setIsSidebarPanelOpen(false);
        const tab = PAGE_TO_CONVERSATION_TAB[currentPageRef.current];
        selectedConversationRef.current = null;
        conversationViewRef.current = 'thread';
        replyToRef.current = null;
        if (tab) {
            tabMemoriesRef.current[tab].isPanelOpen = false;
            tabMemoriesRef.current[tab].conversation = null;
            tabMemoriesRef.current[tab].view = 'thread';
            tabMemoriesRef.current[tab].replyTo = null;
        }
        setSelectedConversation(null);
        setConversationView('thread');
        sendCallbackRef.current = null;
        setReplyTo(null);
    }, []);

    const openConversationManagement = useCallback(() => {
        conversationViewRef.current = 'management';
        const tab = PAGE_TO_CONVERSATION_TAB[currentPageRef.current];
        if (tab) tabMemoriesRef.current[tab].view = 'management';
        setConversationView('management');
    }, []);

    const closeConversationManagement = useCallback(() => {
        conversationViewRef.current = 'thread';
        const tab = PAGE_TO_CONVERSATION_TAB[currentPageRef.current];
        if (tab) tabMemoriesRef.current[tab].view = 'thread';
        setConversationView('thread');
    }, []);

    const registerSendCallback = useCallback((cb: ChatSendCallback | null) => {
        sendCallbackRef.current = cb;
    }, []);

    const updateReplyTo = useCallback((target: ReplyTarget | null) => {
        replyToRef.current = target;
        const tab = PAGE_TO_CONVERSATION_TAB[currentPageRef.current];
        if (tab) tabMemoriesRef.current[tab].replyTo = target;
        setReplyTo(target);
    }, []);

    return (
        <NavigationContext.Provider value={{
            currentPage,
            watchUuid, openWatch, closeWatch,
            selectedConversation,
            conversationView,
            isSidebarPanelOpen,
            navigate,
            toggleSidebarPanel,
            openConversation,
            closeConversation,
            openConversationManagement,
            closeConversationManagement,
            registerSendCallback,
            sendCallback: sendCallbackRef,
            replyTo,
            setReplyTo: updateReplyTo,
        }}>
            {children}
        </NavigationContext.Provider>
    );
}

export function useNavigation() {
    const ctx = useContext(NavigationContext);
    if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
    return ctx;
}
