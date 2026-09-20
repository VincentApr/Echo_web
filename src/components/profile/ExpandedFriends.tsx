import React, { useState, useCallback, useEffect } from 'react';
import { IoPeopleCircleOutline, IoMailOutline, IoPeopleOutline, IoTrashOutline, IoCheckmarkOutline, IoCloseOutline } from 'react-icons/io5';
import { useAuth } from '../../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useFriendRequests } from '../../hooks/useFriendRequests';

interface Connection {
    id: number;
    uuid: string;
    username: string;
    surnom: string;
    photo_profil_url?: string;
}

interface GroupInvitation {
    id: number;
    uuid: string;
    group: { uuid: string; name: string; member_count?: number };
    created_by: { uuid: string; username: string; surnom?: string };
    message?: string;
    is_expired?: boolean;
}

export default function ExpandedFriends() {
    const { accessToken, reloadUser } = useAuth();
    const [connections, setConnections] = useState<Connection[]>([]);
    const { friendRequests: invitations, refetch: refetchInvitations, updateFriendRequest } = useFriendRequests();
    const [groupInvitations, setGroupInvitations] = useState<GroupInvitation[]>([]);

    const [activeTab, setActiveTab] = useState<'friends' | 'invitations' | 'groupInvitations'>('friends');
    const [processingIds, setProcessingIds] = useState<Set<number | string>>(new Set());
    const [loading, setLoading] = useState(false);

    const fetchConnections = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/relations/connections/my-connections/`);
            if (res.ok) setConnections((await res.json()).connexions || []);
        } catch (e) {
            console.error(e);
        }
    }, []);

    const fetchGroupInvitations = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/invitations/received/`);
            if (res.ok) {
                const data = await res.json();
                setGroupInvitations(data.filter((inv: any) => !inv.is_expired));
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        if (!accessToken) return;
        setLoading(true);
        Promise.all([fetchConnections(), refetchInvitations(), fetchGroupInvitations()]).finally(() => setLoading(false));
    }, [accessToken, fetchConnections, refetchInvitations, fetchGroupInvitations]);

    const handleFriendResponse = async (invId: number, action: 'acceptee' | 'refusee') => {
        setProcessingIds(prev => new Set(prev).add(invId));
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/relations/connections/${invId}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statut: action })
            });
            if (res.ok) {
                updateFriendRequest(invId, action === 'acceptee' ? 'accept' : 'reject');
                if (action === 'acceptee') {
                    await fetchConnections();
                    await reloadUser();
                }
            }
        } finally {
            setProcessingIds(prev => { const n = new Set(prev); n.delete(invId); return n; });
        }
    };

    const handleGroupResponse = async (invUuid: string, action: 'accept' | 'decline') => {
        setProcessingIds(prev => new Set(prev).add(invUuid));
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/invitations/${invUuid}/respond/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            if (res.ok) {
                setGroupInvitations(prev => prev.filter(inv => inv.uuid !== invUuid));
            }
        } finally {
            setProcessingIds(prev => { const n = new Set(prev); n.delete(invUuid); return n; });
        }
    };

    const removeFriend = async (connId: number) => {
        if (!window.confirm("Voulez-vous vraiment supprimer cet ami ?")) return;
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/relations/connections/${connId}/`, { method: 'DELETE' });
            if (res.ok) setConnections(prev => prev.filter(c => c.id !== connId));
        } catch (e) {}
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
                <TabButton active={activeTab === 'friends'} onClick={() => setActiveTab('friends')} icon={<IoPeopleOutline />} label={`Amis (${connections.length})`} />
                <TabButton active={activeTab === 'invitations'} onClick={() => setActiveTab('invitations')} icon={<IoMailOutline />} label={`Invitations (${invitations.length})`} badge={invitations.length} />
                <TabButton active={activeTab === 'groupInvitations'} onClick={() => setActiveTab('groupInvitations')} icon={<IoPeopleCircleOutline />} label={`Groupes (${groupInvitations.length})`} badge={groupInvitations.length} />
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? <p>Chargement...</p> : (
                    activeTab === 'friends' ? (
                        connections.length === 0 ? <EmptyState icon={<IoPeopleOutline size={48} />} title="Aucun ami" text="Vous n'avez pas encore d'amis." /> :
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {connections.map(c => (
                                <UserProfileCard key={c.uuid} photo={c.photo_profil_url} name={c.surnom || c.username} username={c.username}
                                    rightAction={<button onClick={() => removeFriend(c.id)} className="prof-btn--delete" style={{ padding: '8px' }}><IoTrashOutline size={20} /></button>} />
                            ))}
                        </div>
                    ) : activeTab === 'invitations' ? (
                        invitations.length === 0 ? <EmptyState icon={<IoMailOutline size={48} />} title="Aucune invitation" text="Vous n'avez pas d'invitations en attente." /> :
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {invitations.map(inv => {
                                const sender = inv.demandeur_info;
                                return <UserProfileCard key={inv.id} photo={sender.photo_profil_url} name={sender.surnom || sender.username} username={sender.username} subtitle={inv.message}
                                    rightAction={processingIds.has(inv.id) ? <span>...</span> : (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleFriendResponse(inv.id, 'acceptee')} style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: '12px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><IoCheckmarkOutline /> Accepter</button>
                                            <button onClick={() => handleFriendResponse(inv.id, 'refusee')} style={{ background: 'rgba(0,0,0,0.05)', color: '#6b7280', border: 'none', borderRadius: '12px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><IoCloseOutline /> Refuser</button>
                                        </div>
                                    )} />
                            })}
                        </div>
                    ) : (
                        groupInvitations.length === 0 ? <EmptyState icon={<IoPeopleCircleOutline size={48} />} title="Aucune invitation de groupe" text="Vous n'avez pas d'invitations de groupe." /> :
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {groupInvitations.map(inv => (
                                <UserProfileCard key={inv.uuid} iconFallback={<IoPeopleOutline size={24} />} name={inv.group.name} subtitle={inv.message || `Invité par ${inv.created_by.surnom || inv.created_by.username}`}
                                    rightAction={processingIds.has(inv.uuid) ? <span>...</span> : (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleGroupResponse(inv.uuid, 'accept')} style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: '12px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><IoCheckmarkOutline /> Accepter</button>
                                            <button onClick={() => handleGroupResponse(inv.uuid, 'decline')} style={{ background: 'rgba(0,0,0,0.05)', color: '#6b7280', border: 'none', borderRadius: '12px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><IoCloseOutline /> Refuser</button>
                                        </div>
                                    )} />
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

function TabButton({ active, onClick, icon, label, badge }: any) {
    return (
        <button onClick={onClick} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '12px', borderRadius: '16px', border: 'none', cursor: 'pointer',
            background: active ? 'rgba(10, 145, 104, 1)' : 'rgba(10, 145, 104, 0.05)',
            color: active ? '#fff' : 'rgba(10, 145, 104, 1)', fontWeight: 650, position: 'relative'
        }}>
            {icon} {label}
            {badge > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#ef4444', color: '#fff', fontSize: '11px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '10px' }}>{badge}</span>}
        </button>
    );
}

function EmptyState({ icon, title, text }: any) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', color: '#9ca3af', textAlign: 'center' }}>
            <div style={{ opacity: 0.5, marginBottom: '16px' }}>{icon}</div>
            <h3 style={{ fontSize: '18px', color: '#4b5563', margin: '0 0 8px' }}>{title}</h3>
            <p style={{ fontSize: '14px', maxWidth: '300px' }}>{text}</p>
        </div>
    );
}

function UserProfileCard({ photo, iconFallback, name, username, subtitle, rightAction }: any) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px', background: 'rgba(255,255,255,0.8)', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', overflow: 'hidden', flexShrink: 0, marginRight: '16px', background: 'rgba(10,145,104,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {photo ? <img src={photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (iconFallback || <span style={{ fontWeight: 'bold', color: 'rgba(10,145,104,0.8)' }}>{name.charAt(0).toUpperCase()}</span>)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1a2620' }}>{name}</h4>
                {username && <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#6b7a72' }}>@{username}</p>}
                {subtitle && <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#4b5563' }}>{subtitle}</p>}
            </div>
            <div style={{ flexShrink: 0 }}>{rightAction}</div>
        </div>
    );
}
