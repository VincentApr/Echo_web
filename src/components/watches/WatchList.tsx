import { useState } from 'react';
import { IoSearchOutline } from 'react-icons/io5';
import { useWatchFeed, useWatch } from '../../hooks/useWatches';
import { useNavigation } from '../../contexts/NavigationContext';
import { WatchArtwork } from './WatchArtwork';
import '../panels/ConversationsPanel.css';
import './Watches.css';

export function WatchList({ onChoose, columns = 2 }: { onChoose?: () => void; columns?: number }) {
    const { watchUuid, openWatch } = useNavigation();
    const [search, setSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const feed = useWatchFeed();
    const selected = useWatch(watchUuid);
    const [order, setOrder] = useState<string[]>([]);
    const items = (feed.data?.pages.flatMap(page => page.results) ?? []).filter(item => item.uuid !== watchUuid || !selected.isError);
    if (selected.data && !selected.isError && !items.some(item => item.uuid === selected.data.uuid)) items.push(selected.data);
    const sorted = [...items].sort((a, b) => {
        const ai = order.indexOf(a.uuid), bi = order.indexOf(b.uuid);
        return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    });
    const nextIds = sorted.map(item => item.uuid);
    if (order.join(',') !== nextIds.join(',')) setOrder(nextIds);
    const visible = sorted.filter(item => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return <aside className={`conv-panel conv-panel--columns-${columns} watch-list ${searchOpen ? 'conv-panel--search-open' : ''}`} aria-label="Liste des veilles">
        <div className="conv-panel__search-wrap" onClick={() => setSearchOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setSearchOpen(false); setSearch(''); } }}>
            <IoSearchOutline size={20} className="conv-panel__search-icon" />
            <input className="conv-panel__search" placeholder="Rechercher…" aria-label="Rechercher une veille" value={search} onFocus={() => setSearchOpen(true)} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="conv-panel__grid-scroll">
            {feed.isLoading && <div className="conv-panel__loading" role="status"><span className="conv-panel__spinner" /></div>}
            {feed.isError && <button className="watch-retry" onClick={() => void feed.refetch()}>Réessayer</button>}
            <div className="conv-panel__grid conv-panel__grid--private">
                {visible.map(item => <button key={item.uuid} className={`conv-square ${item.uuid === watchUuid ? 'conv-square--selected' : ''}`} onClick={() => { openWatch(item.uuid); onChoose?.(); }} title={item.title} aria-current={item.uuid === watchUuid ? 'page' : undefined}>
                    <span className="conv-square__avatar watch-list__image"><WatchArtwork kind={item.kind} uuid={item.uuid} version={item.artwork_version} /></span>
                    <span className="conv-square__name-badge"><span className="conv-square__name">{item.title}</span></span>
                </button>)}
                {feed.hasNextPage && <button className="conv-square conv-square--add" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} aria-label="Afficher la suite">…</button>}
            </div>
        </div>
    </aside>;
}
