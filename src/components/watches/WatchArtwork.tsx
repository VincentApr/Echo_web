import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { fetchWithAuth } from '../../services/apiClient';
import { API_BASE_URL } from '../../config/api';
import { preferences } from '../../services/watchNotifications';

export function useWatchArtworkImage(uuid?: string, version?: string | null) {
    const { user, isLoggedIn } = useAuth();
    // Observe a locally changed preference immediately, including when an old
    // feed is still in cache. The feed API is authoritative after a reload.
    const policy = useQuery({queryKey:['watch-preferences',user?.uuid],queryFn:()=>preferences(),enabled:false});
    const enabled = !!uuid && !!version && isLoggedIn && user?.ai_agents_enabled !== false && policy.data?.images_enabled !== false;
    const image = useQuery({
        queryKey: ['watch-artwork', user?.uuid, uuid, version],
        enabled, retry: false, staleTime: 60_000, gcTime: 60_000,
        queryFn: async () => {
            const response = await fetchWithAuth(`${API_BASE_URL}/watches/${encodeURIComponent(uuid!)}/artwork/`);
            if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== 'image/webp') throw new Error('Illustration indisponible');
            const blob = await response.blob();
            if (blob.size > 200_000) throw new Error('Illustration trop volumineuse');
            return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('Illustration indisponible'));
                reader.readAsDataURL(blob);
            });
        },
    });
    return enabled && image.data && !image.isError ? image.data : undefined;
}

export function WatchArtwork({ kind, uuid, version }: { kind: string; uuid?: string; version?: string | null }) {
    const image = useWatchArtworkImage(uuid, version);
    if (image) return <img className="watch-art" src={image} alt="" loading="lazy" />;
    const group = kind === 'group_invitation';
    return <svg className="watch-art" viewBox="0 0 320 320" fill="none" aria-hidden="true">
        <rect width="320" height="320" fill={group ? '#d5d7e4' : '#d5e2d3'} />
        <circle cx="270" cy="54" r="94" fill={group ? '#e9e5ee' : '#e9eddb'} />
        <path d="M-30 215Q85 115 190 182T350 154V340H-30Z" fill={group ? '#b9bfd2' : '#aac3b4'} />
        <circle cx="148" cy="112" r="29" fill={group ? '#667597' : '#42695e'} />
        <path d="M99 193V175C99 144 197 144 197 175V193Z" fill={group ? '#667597' : '#42695e'} />
        <circle cx="213" cy="137" r="23" fill={group ? '#f5f0e6' : '#f0dfc5'} />
        <path d="M175 204V184C175 158 252 158 252 184V204Z" fill={group ? '#f5f0e6' : '#f0dfc5'} />
        {group ? <><circle cx="79" cy="142" r="21" fill="#9699b9" /><path d="M44 203V188C44 161 114 161 114 188V203Z" fill="#9699b9" /></> : <g transform="translate(54 80) rotate(-12)"><rect width="44" height="34" rx="8" fill="#f8f5e9" /><path d="m6 9 16 12L38 9" stroke="#8fa897" strokeWidth="3" strokeLinecap="round" /></g>}
        <path d="m258 109 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2Z" fill={group ? '#f5f0e6' : '#fff8e6'} />
    </svg>;
}
