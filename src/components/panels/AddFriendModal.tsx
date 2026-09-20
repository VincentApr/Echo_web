import React, { useEffect, useRef, useState } from 'react';
import { IoClose, IoPersonAddOutline, IoSearchOutline, IoSend } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import './AddFriendModal.css';

interface User {
    uuid: string;
    username: string;
    surnom?: string;
    photo_profil_url?: string;
}

interface AddFriendModalProps {
    onClose: () => void;
}

export function AddFriendModal({ onClose }: AddFriendModalProps) {
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
                setResults(Array.isArray(data) ? data : data.results || []);
            } catch (e: any) {
                if (e?.name !== 'AbortError') setResults([]);
            } finally {
                setIsSearching(false);
            }
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
            setTimeout(onClose, 1200);
        } catch {
            // silently fail
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="afm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="afm-modal">
                {/* Header */}
                <div className="afm-header">
                    <IoPersonAddOutline size={20} />
                    <span className="afm-title">Ajouter des amis</span>
                    <button className="afm-close" onClick={onClose}><IoClose size={20} /></button>
                </div>

                {step === 'search' ? (
                    <>
                        {/* Search input */}
                        <div className="afm-search-wrap">
                            <IoSearchOutline size={16} className="afm-search-icon" />
                            <input
                                ref={inputRef}
                                className="afm-search"
                                placeholder="Rechercher un utilisateur..."
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                            />
                        </div>

                        {/* Results */}
                        <div className="afm-results">
                            {query.trim().length === 0 ? (
                                <div className="afm-empty">
                                    <IoPersonAddOutline size={48} color="rgba(10,145,104,0.25)" />
                                    <p>Recherchez des utilisateurs par nom ou pseudo</p>
                                </div>
                            ) : isSearching ? (
                                <div className="afm-empty"><div className="afm-spinner" /></div>
                            ) : results.length === 0 ? (
                                <div className="afm-empty"><p>Aucun résultat pour « {query} »</p></div>
                            ) : (
                                <div className="afm-grid">
                                    {results.map(user => {
                                        const isSelected = selected.has(user.uuid);
                                        return (
                                            <button
                                                key={user.uuid}
                                                className={`afm-user-square ${isSelected ? 'afm-user-square--selected' : ''}`}
                                                onClick={() => toggle(user.uuid)}
                                            >
                                                {user.photo_profil_url ? (
                                                    <img src={user.photo_profil_url} alt="" className="afm-avatar" />
                                                ) : (
                                                    <div className="afm-avatar-placeholder">
                                                        {(user.surnom || user.username).charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                {isSelected && <span className="afm-check">✓</span>}
                                                <div className="afm-name-badge">
                                                    <span>{user.surnom || user.username}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Next button */}
                        {selected.size > 0 && (
                            <button className="afm-cta" onClick={() => setStep('message')}>
                                Continuer — {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        {/* Message step */}
                        <div className="afm-msg-step">
                            <p className="afm-msg-hint">
                                Écrivez un message pour {selected.size} utilisateur{selected.size > 1 ? 's' : ''}
                            </p>
                            <textarea
                                className="afm-msg-input"
                                placeholder="Bonjour, je voudrais vous ajouter..."
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                maxLength={300}
                                rows={4}
                                autoFocus
                            />
                            <span className="afm-char-count">{message.length}/300</span>
                        </div>

                        {sent && <p className="afm-sent">Demandes envoyées ✓</p>}

                        <div className="afm-buttons">
                            <button className="afm-btn-cancel" onClick={() => setStep('search')}>Retour</button>
                            <button
                                className="afm-btn-send"
                                onClick={handleSend}
                                disabled={!message.trim() || sending || sent}
                            >
                                {sending ? '...' : <><IoSend size={14} /> Envoyer</>}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
