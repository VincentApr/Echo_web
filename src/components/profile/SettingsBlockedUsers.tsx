import React, { useState, useEffect } from 'react';
import { IoBanOutline, IoPersonOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';

interface BlockedUser {
    id?: number;
    blocked_user?: { uuid: string; username: string; surnom?: string; photo_profil_url?: string | null };
    blocked_uuid?: string;
    username?: string;
    created_at?: string;
}

function getUserUuid(u: BlockedUser) {
    return u.blocked_user?.uuid || u.blocked_uuid || String(u.id ?? '');
}
function getUsername(u: BlockedUser) {
    return u.blocked_user?.surnom || u.blocked_user?.username || u.username || 'Utilisateur';
}
function getAvatar(u: BlockedUser) {
    return u.blocked_user?.photo_profil_url || null;
}

export default function SettingsBlockedUsers() {
    const [users, setUsers] = useState<BlockedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [unblocking, setUnblocking] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        void fetchWithAuth(`${API_BASE_URL}/messaging/blocked-users/`)
            .then(r => r.ok ? r.json() : [])
            .then((data: unknown) => setUsers(Array.isArray(data) ? data : (data as any)?.results ?? []))
            .finally(() => setLoading(false));
    }, []);

    const unblock = async (userUuid: string) => {
        setUnblocking(userUuid);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/messaging/unblock-user/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_uuid: userUuid }),
            });
            if (res.ok) {
                setUsers(prev => prev.filter(u => getUserUuid(u) !== userUuid));
                setMsg('Utilisateur débloqué');
                setTimeout(() => setMsg(null), 2500);
            }
        } finally {
            setUnblocking(null);
        }
    };

    if (loading) return <div className="spage-loading"><div className="spage-spinner" /></div>;

    return (
        <div className="spage-content">
            {msg && <div className="spage-toast">{msg}</div>}
            {users.length === 0 ? (
                <div className="spage-empty">
                    <IoBanOutline size={40} color="rgba(10,145,104,0.4)" />
                    <p>Aucun utilisateur bloqué</p>
                </div>
            ) : (
                <div className="spage-section">
                    <div className="spage-list">
                        {users.map(u => (
                            <div key={getUserUuid(u)} className="spage-row">
                                <div className="spage-row-avatar">
                                    {getAvatar(u)
                                        ? <img src={getAvatar(u)!} alt="" />
                                        : <IoPersonOutline size={20} />}
                                </div>
                                <div className="spage-row-info">
                                    <span className="spage-row-name">{getUsername(u)}</span>
                                    {u.created_at && (
                                        <span className="spage-row-meta">
                                            Bloqué le {new Date(u.created_at).toLocaleDateString('fr-FR')}
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="spage-btn spage-btn--secondary"
                                    onClick={() => void unblock(getUserUuid(u))}
                                    disabled={unblocking === getUserUuid(u)}
                                >
                                    {unblocking === getUserUuid(u) ? '...' : 'Débloquer'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
