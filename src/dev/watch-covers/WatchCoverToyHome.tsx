// Loaded only by scripts/preview-watch-covers.mjs. No production entry imports this module.
import { useState, type CSSProperties } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useConversations } from '../../hooks/useConversations';
import { useWatchFeed } from '../../hooks/useWatches';
import type { WatchItem } from '../../services/watches';
import lucas from './assets/lucas.png';
import career from './assets/career.png';
import github from './assets/github.png';
import weekend from './assets/weekend.png';
import group from './assets/group.png';
import friend from './assets/friend.png';
import '../../components/panels/ConversationsPanel.css';
import '../../components/watches/Watches.css';
import './WatchCoverToy.css';

// A restrained series, not a fixed layout: short exact copy + shared direction + subject-specific motif.
const covers: { id: string; title: string; subtitle: string; image: string; matches: (item: WatchItem) => boolean }[] = [
    { id:'career', title:'Une porte s’ouvre', subtitle:'Votre candidature', image:career, matches:item => /candidature|stage/i.test(item.title) },
    { id:'github', title:'À vous de jouer', subtitle:'Revue GitHub', image:github, matches:item => item.kind === 'github_notification' },
    { id:'weekend', title:'Prendre le large', subtitle:'Sortie du week-end', image:weekend, matches:item => /organiser votre sortie/i.test(item.title) },
    { id:'group', title:'On vous attend', subtitle:'Invitation au groupe', image:group, matches:item => item.kind === 'group_invitation' },
    { id:'friend', title:'Un nouveau lien', subtitle:'Léa vous ajoute', image:friend, matches:item => item.kind === 'friend_request' && /Léa/.test(item.title) },
];

export default function WatchCoverToyHome() {
    const { user } = useAuth();
    const { openConversation, openWatch } = useNavigation();
    const feed = useWatchFeed();
    const { privateConversations } = useConversations();
    const [tileSize] = useState(() => Math.max(125, Math.round(Math.floor((window.screen.availWidth - 60 - 48 - 5 * 16) / 6) * 0.6)));
    const pinned = privateConversations.find(item => item.name === 'Lucas');
    const items = feed.data?.pages.flatMap(page => page.results) ?? [];
    // The prototype is a fixed set of fictional examples. Existing detail pages and navigation remain usable.
    const displayed = user?.ai_agents_enabled === false ? [] : covers.flatMap(cover => {
        const item = items.find(cover.matches);
        return item ? [{ ...cover, item }] : [];
    });
    return <section className="watch-home watch-home--covers conv-panel" style={{'--watch-tile-size':`${tileSize}px`} as CSSProperties}>
        {feed.isError && <div className="watch-notice" role="alert"><p>{feed.error.message}</p><button onClick={() => void feed.refetch()}>Réessayer</button></div>}
        <div className="watch-grid" aria-label="Conversations épinglées et veilles — pochettes d’essai">
            {pinned && <button className="conv-square watch-card" onClick={() => openConversation(pinned)} aria-label="Ouvrir Lucas — conversation épinglée" title="Lucas · Conversation épinglée">
                <img className="watch-card__cover" src={lucas} alt="" draggable={false} />
            </button>}
            {displayed.map(cover => <button key={cover.id} className="conv-square watch-card" onClick={() => openWatch(cover.item.uuid)} aria-label={`${cover.title} — ${cover.subtitle}`} title={`${cover.item.title} · ${cover.subtitle}`}>
                <img className="watch-card__cover" src={cover.image} alt="" draggable={false} />
            </button>)}
            {feed.isLoading && Array.from({length:5}, (_, index) => <div key={index} className="conv-square watch-card watch-card--skeleton" aria-label="Chargement des pochettes" />)}
        </div>
    </section>;
}
