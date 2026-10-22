import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IoArrowForward } from 'react-icons/io5';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useJarvis } from '../contexts/JarvisContext';
import { useConversations } from '../hooks/useConversations';
import { useWatchFeed } from '../hooks/useWatches';
import { CONVERSATION_PINS_EVENT, getPinnedConversationUuids } from '../services/conversationPins';
import { WatchArtwork } from '../components/watches/WatchArtwork';
import { watchSourceLabel } from '../services/watches';
import HomeJarvisPage from './HomeJarvisPage';
import type { CSSProperties } from 'react';
import '../components/panels/ConversationsPanel.css';
import '../components/watches/Watches.css';

export default function HomePage() {
    const { user } = useAuth();
    const { openConversation, openWatch } = useNavigation();
    const { liveTurns } = useJarvis();
    // Keep compact tiles at a fixed size; resizing only changes the column count.
    const [tileSize] = useState(() => Math.max(125, Math.round(Math.floor((window.screen.availWidth - 60 - 48 - 5 * 16) / 6) * 0.6)));
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
    return <section className="watch-home conv-panel" ref={scroll} style={{ '--watch-tile-size': `${tileSize}px` } as CSSProperties} onScroll={event => sessionStorage.setItem(scrollKey, String(event.currentTarget.scrollTop))}>
        {feed.isError && <div className="watch-notice" role="alert"><p>{feed.error.message}</p><button onClick={() => void feed.refetch()}>Réessayer</button></div>}
        <div className="watch-grid" aria-label="Conversations épinglées et veilles">
            {pinned.map(conversation => conversation && <button key={`pin-${conversation.uuid}`} className="conv-square watch-card" onClick={() => openConversation(conversation)} aria-label={`Ouvrir ${conversation.name}`}>
                {conversation.avatar_url ? <img src={conversation.avatar_url} alt="" className="conv-square__avatar" /> : <span className="conv-square__avatar-placeholder">{conversation.name.charAt(0).toUpperCase()}</span>}
                <span className="watch-card__shade" aria-hidden="true" />
                <span className="conv-square__name-badge watch-card__caption"><strong className="conv-square__name" title={conversation.name}>{conversation.name}</strong><small>Conversation épinglée</small></span>
            </button>)}
            {items.map(item => <button key={item.uuid} className="conv-square watch-card" onClick={() => openWatch(item.uuid)}>
                <span className="conv-square__avatar watch-card__image"><WatchArtwork kind={item.kind} uuid={item.uuid} version={item.artwork_version} /></span>
                <span className="watch-card__shade" aria-hidden="true" />
                <span className="conv-square__name-badge watch-card__caption"><strong className="conv-square__name" title={item.title}>{item.title}</strong><small>{watchSourceLabel(item)}</small></span>
            </button>)}
            {feed.isLoading && Array.from({ length: 3 }, (_, i) => <div key={i} className="conv-square watch-card watch-card--skeleton" aria-label="Chargement des veilles" />)}
            {feed.hasNextPage && <button className="conv-square watch-card watch-load-more" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} aria-label="Afficher la suite"><IoArrowForward size={30} /></button>}
        </div>
    </section>;
}
