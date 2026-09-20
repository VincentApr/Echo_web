import React, { useState, useEffect } from 'react';
import { IoArchiveOutline, IoPersonOutline, IoPeopleOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';

interface ArchivedConv {
    uuid: string;
    conversation_type: string;
    name?: string;
    avatar_url?: string;
    other_participant?: { username: string; surnom?: string; photo_profil_url?: string | null };
    last_message?: { content: string; sender_username: string };
    group_info?: { name: string; avatar?: string | null };
}

function getConvName(c: ArchivedConv) {
    return c.name
        || c.group_info?.name
        || c.other_participant?.surnom
        || c.other_participant?.username
        || 'Conversation';
}

function getConvAvatar(c: ArchivedConv) {
    return c.avatar_url || c.group_info?.avatar || c.other_participant?.photo_profil_url || null;
}

function getLastMsg(c: ArchivedConv) {
    if (!c.last_message) return '';
    return `${c.last_message.sender_username} : ${c.last_message.content}`;
}

export default function SettingsArchivedConversations() {
    const [convs, setConvs] = useState<ArchivedConv[]>([]);
    const [loading, setLoading] = useState(true);
    const [unarchiving, setUnarchiving] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        void fetchWithAuth(`${API_BASE_URL}/messaging/conversations/archived/`)
            .then(r => r.ok ? r.json() : [])
            .then((data: unknown) => setConvs(Array.isArray(data) ? data : (data as any)?.results ?? []))
            .finally(() => setLoading(false));
    }, []);

    const unarchive = async (uuid: string) => {
        setUnarchiving(uuid);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${uuid}/archive/`, {
                method: 'POST',
            });
            if (res.ok) {
                setConvs(prev => prev.filter(c => c.uuid !== uuid));
                setMsg('Conversation désarchivée');
                setTimeout(() => setMsg(null), 2500);
            }
        } finally {
            setUnarchiving(null);
        }
    };

    const isGroup = (c: ArchivedConv) => c.conversation_type === 'group' || c.conversation_type === 'group_chat';

    if (loading) return <div className="spage-loading"><div className="spage-spinner" /></div>;

    return (
        <div className="spage-content">
            {msg && <div className="spage-toast">{msg}</div>}
            {convs.length === 0 ? (
                <div className="spage-empty">
                    <IoArchiveOutline size={40} color="rgba(10,145,104,0.4)" />
                    <p>Aucune conversation archivée</p>
                </div>
            ) : (
                <div className="spage-section">
                    <div className="spage-list">
                        {convs.map(c => {
                            const avatar = getConvAvatar(c);
                            return (
                                <div key={c.uuid} className="spage-row">
                                    <div className="spage-row-avatar">
                                        {avatar
                                            ? <img src={avatar} alt="" />
                                            : isGroup(c)
                                                ? <IoPeopleOutline size={20} />
                                                : <IoPersonOutline size={20} />}
                                    </div>
                                    <div className="spage-row-info">
                                        <span className="spage-row-name">{getConvName(c)}</span>
                                        {getLastMsg(c) && (
                                            <span className="spage-row-meta spage-row-meta--truncate">{getLastMsg(c)}</span>
                                        )}
                                    </div>
                                    <button
                                        className="spage-btn spage-btn--secondary"
                                        onClick={() => void unarchive(c.uuid)}
                                        disabled={unarchiving === c.uuid}
                                    >
                                        {unarchiving === c.uuid ? '...' : 'Désarchiver'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
