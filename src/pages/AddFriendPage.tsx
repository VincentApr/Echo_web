import React, { useEffect, useRef, useState } from 'react';
import { IoChevronBack, IoPersonAddOutline, IoSearchOutline, IoSend } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useNavigation } from '../contexts/NavigationContext';
import './AddPage.css';

interface User {
    uuid: string;
    username: string;
    surnom?: string;
    photo_profil_url?: string;
}

export default function AddFriendPage() {
    const { navigate } = useNavigation();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [message, setMessage] = useState('');
    const [step, setStep] = useState<'search' | 'message'>('search');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        const q = query.trim();
        if (!q) { setResults([]); return; }
        const timer = setTimeout(async () => {
            abortRef.current?.abort();
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            setIsSearching(true);
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/api/users/?search=${encodeURIComponent(q)}`, { signal: ctrl.signal });
                if (!res.ok) return;
                const data = await res.json();
                setResults(Array.isArray(data) ? data : (data.results || []));
            } catch (e: any) {
                if (e?.name !== 'AbortError') setResults([]);
            } finally { setIsSearching(false); }
        }, 300);
        return () => { clearTimeout(timer); abortRef.current?.abort(); };
    }, [query]);

    const toggle = (uuid: string) => {
        setSelected(prev => {
            const s = new Set(prev);
            s.has(uuid) ? s.delete(uuid) : s.add(uuid);
            return s;
        });
    };

    const handleSend = async () => {
        if (!message.trim() || selected.size === 0) return;
        setSending(true);
        try {
            await Promise.all(Array.from(selected).map(uuid =>
                fetchWithAuth(`${API_BASE_URL}/relations/connections/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinataire_uuid: uuid, message: message.trim() }),
                })
            ));
            setSent(true);
            setTimeout(() => navigate('conversations'), 1200);
        } catch { /* silent */ }
        finally { setSending(false); }
    };

    return (
        <div className="add-page">
            <div className="add-page__top-vignette" aria-hidden="true" />
            <div className="add-page__header">
                <button className="add-page__back-btn" onClick={() => navigate('conversations')}>
                    <IoChevronBack size={22} />
                </button>
                <div className="add-page__title-bubble">
                    <IoPersonAddOutline size={18} className="add-page__header-icon" />
                    <span className="add-page__header-title">Ajouter des amis</span>
                </div>
            </div>

            <div className="add-page__content">
                {step === 'search' ? (
                    <>
                        <p className="add-page__subtitle">Recherchez des utilisateurs par nom ou pseudo</p>

                        <div className="add-page__search-wrap">
                            <IoSearchOutline size={16} className="add-page__search-icon" />
                            <input
                                ref={inputRef}
                                className="add-page__search"
                                placeholder="Rechercher un utilisateur..."
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                            />
                        </div>

                        <div className="add-page__grid-wrap">
                            {query.trim().length === 0 ? (
                                <div className="add-page__empty">
                                    <IoPersonAddOutline size={56} className="add-page__empty-icon" />
                                    <p>Tapez un nom ou un pseudo pour commencer</p>
                                </div>
                            ) : isSearching ? (
                                <div className="add-page__empty"><div className="add-page__spinner" /></div>
                            ) : results.length === 0 ? (
                                <div className="add-page__empty"><p>Aucun résultat pour « {query} »</p></div>
                            ) : (
                                <div className="add-page__grid">
                                    {results.map(user => {
                                        const isSelected = selected.has(user.uuid);
                                        const displayName = user.surnom || user.username;
                                        return (
                                            <button
                                                key={user.uuid}
                                                className={`add-page__square ${isSelected ? 'add-page__square--selected' : ''}`}
                                                onClick={() => toggle(user.uuid)}
                                            >
                                                <div className="add-page__square-visual">
                                                    {user.photo_profil_url ? (
                                                        <img src={user.photo_profil_url} alt="" className="add-page__square-avatar" />
                                                    ) : (
                                                        <div className="add-page__square-placeholder">
                                                            {displayName.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    {isSelected && <span className="add-page__check">✓</span>}
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

                        {selected.size > 0 && (
                            <div className="add-page__footer">
                                <button className="add-page__cta" onClick={() => setStep('message')}>
                                    Continuer — {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="add-page__message-step">
                        <p className="add-page__subtitle">
                            Écrivez un message d'accompagnement pour {selected.size} utilisateur{selected.size > 1 ? 's' : ''}
                        </p>
                        <textarea
                            className="add-page__msg-input"
                            placeholder="Bonjour, je souhaite vous ajouter..."
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            maxLength={300}
                            rows={5}
                            autoFocus
                        />
                        <span className="add-page__char-count">{message.length}/300</span>

                        {sent && <p className="add-page__done">Demandes envoyées ✓</p>}

                        <div className="add-page__btn-row">
                            <button className="add-page__btn-cancel" onClick={() => setStep('search')}>Retour</button>
                            <button
                                className="add-page__btn-send"
                                onClick={handleSend}
                                disabled={!message.trim() || sending || sent}
                            >
                                {sending ? '...' : <><IoSend size={14} /> Envoyer</>}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
