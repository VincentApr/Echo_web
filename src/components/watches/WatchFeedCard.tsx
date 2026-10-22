import { useState } from 'react';
import { useWatchArtworkImage } from './WatchArtwork';
import { watchSourceLabel, type WatchItem } from '../../services/watches';

export function WatchFeedCard({ item, onOpen }: { item: WatchItem; onOpen: () => void }) {
    const native = item.kind === 'friend_request' || item.kind === 'group_invitation';
    const album = !native && item.cover?.layout === 'album_v1';
    const image = useWatchArtworkImage(album ? item.uuid : undefined, album ? item.artwork_version : undefined);
    const [failedImage, setFailedImage] = useState<string | null>(null);
    const ready = !!image && image !== failedImage;
    const nativeTitle = item.kind === 'friend_request' ? item.payload.actor : item.payload.group_name;
    const title = native ? nativeTitle || item.title : item.cover?.title || item.title;
    const subtitle = native ? (item.kind === 'friend_request' ? 'Demande d’ami' : 'Invitation de groupe') : item.cover?.subtitle || watchSourceLabel(item);
    return <button className={`conv-square watch-card ${native ? `watch-card--${item.kind}` : ready ? 'watch-card--album' : 'watch-card--pending'}`}
        onClick={onOpen} aria-label={`${item.title} — ${subtitle}`} title={item.title}>
        {ready ? <img className="watch-card__cover" src={image} alt="" draggable={false} onError={() => setFailedImage(image)} /> : <>
            {native && <img className="watch-card__cover" src={`/watch-covers/${item.kind === 'friend_request' ? 'friend' : 'group'}.webp`} alt="" draggable={false} />}
            <span className="watch-card__fixed-copy" aria-hidden="true"><strong>{title}</strong><small>{subtitle}</small></span>
        </>}
    </button>;
}
