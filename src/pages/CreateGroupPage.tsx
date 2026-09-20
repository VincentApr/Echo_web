import React, { useEffect, useMemo, useState } from 'react';
import { IoChevronBack, IoPeopleOutline, IoCreateOutline, IoKeyOutline, IoAddCircle, IoEnterOutline, IoSearchOutline, IoCheckmarkOutline } from 'react-icons/io5';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '../contexts/NavigationContext';
import { useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { createGroupAndSync, joinGroupByCodeAndSync } from '../services/groupCreation';
import './AddPage.css';

type Mode = 'create' | 'join' | null;

interface Connection {
    id: number;
    uuid: string;
    username: string;
    surnom?: string;
    photo_profil_url?: string | null;
}

export default function CreateGroupPage() {
    const { navigate, openConversation } = useNavigation();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [mode, setMode] = useState<Mode>(null);

    const [groupName, setGroupName] = useState('');
    const [description, setDescription] = useState('');
    const [memberSearch, setMemberSearch] = useState('');
    const [connections, setConnections] = useState<Connection[]>([]);
    const [selectedMemberUuids, setSelectedMemberUuids] = useState<string[]>([]);
    const [loadingConnections, setLoadingConnections] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createDone, setCreateDone] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const [inviteCode, setInviteCode] = useState('');
    const [joining, setJoining] = useState(false);
    const [joinDone, setJoinDone] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);

    useEffect(() => {
        if (mode !== 'create' || connections.length > 0 || loadingConnections) return;

        let cancelled = false;
        setLoadingConnections(true);
        void fetchWithAuth(`${API_BASE_URL}/relations/connections/my-connections/`)
            .then(async (res) => {
                if (!res.ok) return [];
                const data = await res.json();
                return (data.connexions || []) as Connection[];
            })
            .then((items) => {
                if (!cancelled) setConnections(items);
            })
            .catch(() => {
                if (!cancelled) setConnections([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingConnections(false);
            });

        return () => {
            cancelled = true;
        };
    }, [mode, connections.length, loadingConnections]);

    const filteredConnections = useMemo(() => {
        const q = memberSearch.trim().toLowerCase();
        if (!q) return connections;
        return connections.filter((connection) => {
            const name = `${connection.surnom || ''} ${connection.username}`.toLowerCase();
            return name.includes(q);
        });
    }, [connections, memberSearch]);

    const resetCreateState = () => {
        setGroupName('');
        setDescription('');
        setMemberSearch('');
        setSelectedMemberUuids([]);
        setCreateDone(false);
        setCreateError(null);
    };

    const resetJoinState = () => {
        setInviteCode('');
        setJoinDone(false);
        setJoinError(null);
    };

    const toggleMember = (memberUuid: string) => {
        setSelectedMemberUuids((current) => (
            current.includes(memberUuid)
                ? current.filter((uuid) => uuid !== memberUuid)
                : [...current, memberUuid]
        ));
    };

    const handleCreate = async () => {
        if (!groupName.trim()) return;
        setCreating(true);
        setCreateError(null);
        try {
            const result = await createGroupAndSync({
                ownerUuid: user?.uuid,
                queryClient,
                name: groupName,
                description,
                inviteeUuids: selectedMemberUuids,
            });
            setCreateDone(true);
            setTimeout(() => {
                if (result.group.conversation_uuid) {
                    openConversation({
                        uuid: result.group.conversation_uuid,
                        unread_count: 0,
                        conversation_type: 'group',
                        name: result.group.name || groupName.trim(),
                        avatar_url: result.group.avatar || '',
                        group_info: {
                            uuid: result.group.uuid,
                            name: result.group.name || groupName.trim(),
                            avatar: result.group.avatar || null,
                            member_count: result.group.member_count,
                        },
                    });
                    return;
                }
                navigate('groups');
            }, 900);
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Impossible de créer le groupe.');
        }
        finally { setCreating(false); }
    };

    const handleJoin = async () => {
        if (!inviteCode.trim()) return;
        setJoining(true);
        setJoinError(null);
        try {
            await joinGroupByCodeAndSync({
                ownerUuid: user?.uuid,
                queryClient,
                inviteCode,
            });
            setJoinDone(true);
            setTimeout(() => navigate('groups'), 900);
        } catch (error) {
            setJoinError(error instanceof Error ? error.message : 'Impossible de rejoindre le groupe.');
        }
        finally { setJoining(false); }
    };

    return (
        <div className="add-page">
            <div className="add-page__top-vignette" aria-hidden="true" />
            <div className="add-page__header">
                <button className="add-page__back-btn" onClick={() => navigate('groups')}>
                    <IoChevronBack size={22} />
                </button>
                <div className="add-page__title-bubble">
                    <IoPeopleOutline size={18} className="add-page__header-icon" />
                    <span className="add-page__header-title">Gestion de groupe</span>
                </div>
            </div>

            <div className="add-page__content add-page__content--cards">
                <p className="add-page__subtitle">Créez un nouveau groupe ou rejoignez-en un avec un code d'invitation</p>

                {/* Card: Create */}
                <button
                    className={`add-page__card ${mode === 'create' ? 'add-page__card--active' : ''}`}
                    onClick={() => {
                        setMode(m => {
                            const nextMode = m === 'create' ? null : 'create';
                            if (nextMode === 'create') resetJoinState();
                            return nextMode;
                        });
                    }}
                >
                    <div className="add-page__card-icon"><IoCreateOutline size={36} /></div>
                    <div className="add-page__card-text">
                        <span className="add-page__card-title">Créer un groupe</span>
                        <span className="add-page__card-desc">Créez un nouveau groupe et invitez vos amis</span>
                    </div>
                </button>

                <div className={`add-page__form-wrap ${mode === 'create' ? 'add-page__form-wrap--open' : ''}`}>
                    <div className="add-page__form">
                        <label className="add-page__label">Nom du groupe *</label>
                        <input className="add-page__input" placeholder="Ex: Projet Echo, Club Running..." value={groupName}
                            onChange={e => setGroupName(e.target.value)} maxLength={50} />
                        <span className="add-page__char-count">{groupName.length}/50</span>

                        <label className="add-page__label">Description (optionnel)</label>
                        <textarea className="add-page__textarea" placeholder="Décrivez l'objectif de ce groupe..."
                            value={description} onChange={e => setDescription(e.target.value)} maxLength={200} rows={3} />
                        <span className="add-page__char-count">{description.length}/200</span>

                        <label className="add-page__label">Inviter des amis (optionnel)</label>
                        <div className="add-page__search-wrap" style={{ marginBottom: 10 }}>
                            <IoSearchOutline size={16} className="add-page__search-icon" />
                            <input
                                className="add-page__search"
                                placeholder="Rechercher parmi vos amis..."
                                value={memberSearch}
                                onChange={(e) => setMemberSearch(e.target.value)}
                            />
                        </div>

                        <div className="add-page__selection-hint">
                            {selectedMemberUuids.length > 0
                                ? `${selectedMemberUuids.length} invitation${selectedMemberUuids.length > 1 ? 's' : ''} sera envoyée`
                                : 'Vous pourrez aussi inviter des membres plus tard'}
                        </div>

                        <div className="add-page__grid-wrap add-page__grid-wrap--members">
                            {loadingConnections ? (
                                <div className="add-page__empty">
                                    <div className="add-page__spinner" />
                                    <span>Chargement de vos amis...</span>
                                </div>
                            ) : filteredConnections.length === 0 ? (
                                <div className="add-page__empty add-page__empty--compact">
                                    <IoPeopleOutline size={28} className="add-page__empty-icon" />
                                    <span>{connections.length === 0 ? 'Aucun ami disponible pour invitation.' : 'Aucun ami ne correspond à la recherche.'}</span>
                                </div>
                            ) : (
                                <div className="add-page__grid">
                                    {filteredConnections.map((connection) => {
                                        const isSelected = selectedMemberUuids.includes(connection.uuid);
                                        const displayName = connection.surnom || connection.username;
                                        return (
                                            <button
                                                key={connection.uuid}
                                                type="button"
                                                className={`add-page__square ${isSelected ? 'add-page__square--selected' : ''}`}
                                                onClick={() => toggleMember(connection.uuid)}
                                                title={displayName}
                                            >
                                                <div className="add-page__square-visual">
                                                    {connection.photo_profil_url ? (
                                                        <img src={connection.photo_profil_url} alt={displayName} className="add-page__square-avatar" />
                                                    ) : (
                                                        <div className="add-page__square-placeholder">
                                                            {displayName.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    {isSelected && (
                                                        <div className="add-page__check">
                                                            <IoCheckmarkOutline size={12} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="add-page__name-badge">
                                                    <span>{displayName}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {createDone && <p className="add-page__done">Groupe créé ✓</p>}
                        {createError && <p className="add-page__error">{createError}</p>}
                        <div className="add-page__btn-row">
                            <button className="add-page__btn-cancel" onClick={() => { setMode(null); resetCreateState(); }}>Annuler</button>
                            <button className="add-page__btn-send" onClick={handleCreate}
                                disabled={!groupName.trim() || creating || createDone}>
                                {creating ? '...' : <><IoAddCircle size={16} /> Créer</>}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Card: Join */}
                <button
                    className={`add-page__card ${mode === 'join' ? 'add-page__card--active' : ''}`}
                    onClick={() => {
                        setMode(m => {
                            const nextMode = m === 'join' ? null : 'join';
                            if (nextMode === 'join') resetCreateState();
                            return nextMode;
                        });
                    }}
                >
                    <div className="add-page__card-icon"><IoKeyOutline size={36} /></div>
                    <div className="add-page__card-text">
                        <span className="add-page__card-title">Rejoindre avec un code</span>
                        <span className="add-page__card-desc">Entrez un code d'invitation pour rejoindre un groupe</span>
                    </div>
                </button>

                <div className={`add-page__form-wrap ${mode === 'join' ? 'add-page__form-wrap--open' : ''}`}>
                    <div className="add-page__form">
                        <label className="add-page__label">Code d'invitation *</label>
                        <input className="add-page__input" placeholder="Ex: ABC123XYZ" value={inviteCode}
                            onChange={e => setInviteCode(e.target.value.toUpperCase())}
                            style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }} />
                        <div className="add-page__info-box">
                            Le code d'invitation vous a été fourni par un membre du groupe.
                        </div>
                        {joinDone && <p className="add-page__done">Demande envoyée ✓</p>}
                        {joinError && <p className="add-page__error">{joinError}</p>}
                        <div className="add-page__btn-row">
                            <button className="add-page__btn-cancel" onClick={() => { setMode(null); resetJoinState(); }}>Annuler</button>
                            <button className="add-page__btn-send" onClick={handleJoin}
                                disabled={!inviteCode.trim() || joining || joinDone}>
                                {joining ? '...' : <><IoEnterOutline size={16} /> Rejoindre</>}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
