import { useWatchTileSize } from '../hooks/useWatchTileSize';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IoArrowForward } from 'react-icons/io5';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useJarvis } from '../contexts/JarvisContext';
import { useConversations } from '../hooks/useConversations';
import { useWatchFeed } from '../hooks/useWatches';
import { CONVERSATION_PINS_EVENT, getPinnedConversationUuids } from '../services/conversationPins';
import { WatchFeedCard } from '../components/watches/WatchFeedCard';
import HomeJarvisPage from './HomeJarvisPage';
import type { CSSProperties } from 'react';
import '../components/panels/ConversationsPanel.css';
import '../components/watches/Watches.css';

export default function HomePage() {
    const { user } = useAuth();
    const { openConversation, openWatch } = useNavigation();
    const { liveTurns } = useJarvis();
    // Keep compact tiles at a fixed size; resizing only changes the column count.
    const tileSize = useWatchTileSize();
    const [pins, setPins] = useState(() => getPinnedConversationUuids(user?.uuid));
    const feed = useWatchFeed();
    const { privateConversations, groupConversations, agentConversations } = useConversations();
    const scroll = useRef<HTMLDivElement>(null);
    const scrollKey = `echo:home-scroll:${user?.uuid}`;
    useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = Number(sessionStorage.getItem(scrollKey)) || 0; }, [scrollKey, feed.isLoading]);
    useEffect(() => {
        const update = () => setPins(getPinnedConversationUuids(user?.uuid));
        window.addEventListener(CONVERSATION_PINS_EVENT, update);
        window.addEventListener('storage', update);
        return () => { window.removeEventListener(CONVERSATION_PINS_EVENT, update); window.removeEventListener('storage', update); };
    }, [user?.uuid]);
    const pinned = useMemo(() => {
        const byId = new Map([...privateConversations, ...groupConversations, ...agentConversations].map(conversation => [conversation.uuid, conversation]));
        return pins.map(uuid => byId.get(uuid)).filter(conversation => !!conversation && (user?.ai_agents_enabled !== false || conversation.conversation_type !== 'agent'));
    }, [pins, privateConversations, groupConversations, agentConversations, user?.ai_agents_enabled]);
    if (liveTurns.length > 0 && user?.ai_agents_enabled !== false) return <HomeJarvisPage />;
    const items = feed.data?.pages.flatMap(page => page.results) ?? [];
    return <section className="watch-home watch-home--covers conv-panel" ref={scroll} style={{ '--watch-tile-size': `${tileSize}px` } as CSSProperties} onScroll={event => sessionStorage.setItem(scrollKey, String(event.currentTarget.scrollTop))}>
        {feed.isError && <div className="watch-notice" role="alert"><p>{feed.error.message}</p><button onClick={() => void feed.refetch()}>Réessayer</button></div>}
        <div className="watch-grid" aria-label="Conversations épinglées et veilles">
            {pinned.map(conversation => conversation && <button key={`pin-${conversation.uuid}`} className="conv-square watch-card" onClick={() => openConversation(conversation)} aria-label={`Ouvrir ${conversation.name}`} title={`${conversation.name} · Conversation épinglée`}>
                {conversation.avatar_url ? <img src={conversation.avatar_url} alt="" className="conv-square__avatar" /> : <span className="conv-square__avatar-placeholder">{conversation.name.charAt(0).toUpperCase()}</span>}
            </button>)}
            {items.map(item => <WatchFeedCard key={item.uuid} item={item} onOpen={() => openWatch(item.uuid)} />)}
            {feed.isLoading && Array.from({ length: 3 }, (_, i) => <div key={i} className="conv-square watch-card watch-card--skeleton" aria-label="Chargement des veilles" />)}
            {feed.hasNextPage && <button className="conv-square watch-card watch-load-more" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} aria-label="Afficher la suite"><IoArrowForward size={30} /></button>}
        </div>
    </section>;
}
