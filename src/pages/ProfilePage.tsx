import React, { useState, useEffect } from 'react';
import {
    IoCalendarOutline, IoLogOutOutline, IoPeopleOutline,
    IoStatsChartOutline, IoDocumentTextOutline, IoFlagOutline,
    IoCloseOutline, IoTrashOutline,
    IoSettingsOutline, IoShieldCheckmarkOutline, IoSparklesOutline,
    IoBanOutline, IoArchiveOutline, IoPersonCircleOutline,
    IoLinkOutline, IoChevronDownOutline, IoChevronUpOutline,
    IoArrowBackOutline, IoChatbubbleEllipsesOutline, IoSendOutline,
    IoPersonAddOutline, IoCreateOutline
} from 'react-icons/io5';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { CGU_CONTENT, CGU_TITLE } from '@web/constants/cgu';
import ExpandedFriends from '../components/profile/ExpandedFriends';
import ExpandedStats from '../components/profile/ExpandedStats';
import ExpandedCalendar from '../components/profile/ExpandedCalendar';
import SettingsBlockedUsers from '../components/profile/SettingsBlockedUsers';
import SettingsMyReports from '../components/profile/SettingsMyReports';
import SettingsArchivedConversations from '../components/profile/SettingsArchivedConversations';
import SettingsAiFeatures from '../components/profile/SettingsAiFeatures';
import SettingsOAuth from '../components/profile/SettingsOAuth';
import { useNavigation } from '../contexts/NavigationContext';
import '../components/profile/SettingsPages.css';
import './ProfilePage.css';

interface ProfileStats {
    total_connexions: number;
    total_evenements: number;
    evenements_ce_mois: number;
    total_reponses: number;
    date_inscription: string;
    derniere_activite: string;
}

interface ProfileNewsItem {
    uuid: string; title: string; description: string; published_at: string;
    first_media?: { media_type: 'image' | 'video'; file_url: string; thumbnail_url?: string | null } | null;
}

type ExpandedViewType = 'friends' | 'calendar' | 'stats' | null;
type SettingsPageType = 'edit' | 'ai' | 'blocked' | 'archived' | 'reports' | 'oauth' | null;

export default function ProfilePage() {
    const { user, logout, reloadUser } = useAuth();
    const { navigate } = useNavigation();
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [isModerationExpanded, setIsModerationExpanded] = useState(false);
    const [isAccountExpanded, setIsAccountExpanded] = useState(false);
    const [showEulaModal, setShowEulaModal] = useState(false);
    const [settingsPage, setSettingsPage] = useState<SettingsPageType>(null);

    const [expandedView, setExpandedView] = useState<ExpandedViewType>(null);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

    const extendedUser = user as any;

    const { data: stats } = useQuery({
        queryKey: ['profile-stats', user?.uuid],
        queryFn: async () => {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/stats/`);
            if (!res.ok) return null;
            return await res.json() as ProfileStats;
        },
        enabled: !!user,
        staleTime: 5 * 60_000,
    });

    const { data: friendsCount } = useQuery({
        queryKey: ['friends-count', user?.uuid],
        queryFn: async () => {
            if (!user?.uuid) return 0;
            const res = await fetchWithAuth(`${API_BASE_URL}/relations/connections/my-connections/`);
            if (!res.ok) return 0;
            const data = await res.json();
            const connections = Array.isArray(data?.connexions) ? data.connexions : Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
            return connections.length;
        },
        enabled: !!user?.uuid,
        staleTime: 30_000,
    });

    const { data: news = [] } = useQuery({
        queryKey: ['profile-news'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/news/`);
            if (!response.ok) return [];
            const data = await response.json();
            return (Array.isArray(data) ? data : data?.results || []) as ProfileNewsItem[];
        },
        staleTime: 5 * 60_000,
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedView(null); };
        if (expandedView) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [expandedView]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (settingsPage) { setSettingsPage(null); return; }
            setShowSettingsMenu(false);
            setIsModerationExpanded(false);
            setIsAccountExpanded(false);
            setShowEulaModal(false);
        };
        if (showSettingsMenu || showEulaModal || settingsPage) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showSettingsMenu, showEulaModal, settingsPage]);

    const toggleView = (view: Exclude<ExpandedViewType, null>) => setExpandedView(current => current === view ? null : view);

    const closeSettingsMenu = () => {
        setShowSettingsMenu(false);
        setIsModerationExpanded(false);
        setIsAccountExpanded(false);
    };

    const handleDeleteAccount = async () => {
        if (!window.confirm("Êtes-vous sûr de vouloir supprimer définitivement votre compte ? Cette action est irréversible.")) return;
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/`, { method: 'DELETE' });
            if (res.ok || res.status === 204) await logout();
        } catch {
            alert('Erreur lors de la suppression du compte');
        }
    };

    const sendFeedback = async () => {
        if (!feedback.trim() || feedbackState === 'sending') return;
        setFeedbackState('sending');
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/feedback/quick-comments/`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commentaire: feedback.trim() }),
            });
            if (!response.ok) throw new Error();
            setFeedback(''); setFeedbackState('sent');
        } catch { setFeedbackState('error'); }
    };

    if (!user) return null;

    const displayName = user.username || extendedUser?.first_name || 'Utilisateur';
    const photoUrl = extendedUser?.photo_profil_url || extendedUser?.photo_profil || null;

    const registrationDate = stats?.date_inscription || extendedUser?.created_at;
    const parsedDate = registrationDate ? new Date(registrationDate) : null;
    const daysOnEcho = parsedDate && !isNaN(parsedDate.getTime()) ? Math.max(1, Math.ceil((Date.now() - parsedDate.getTime()) / 86_400_000)) : null;

    const eventsThisMonth = stats?.evenements_ce_mois ?? 0;
    const totalEvents = stats?.total_evenements ?? 0;
    const calendarValue = eventsThisMonth > 0 ? String(eventsThisMonth) : totalEvents > 0 ? String(totalEvents) : '—';
    const calendarLabel = eventsThisMonth > 0 ? 'Ce mois' : 'Événements';
    const tokenUsage = Number(extendedUser?.tokens_used ?? extendedUser?.token_usage ?? extendedUser?.monthly_tokens_used);
    const tokenLimit = Number(extendedUser?.token_limit ?? extendedUser?.monthly_token_limit ?? extendedUser?.tokens_quota);
    const hasTokenQuota = Number.isFinite(tokenUsage) && Number.isFinite(tokenLimit) && tokenLimit > 0;
    const tokenRemaining = hasTokenQuota ? Math.max(0, tokenLimit - tokenUsage) : null;
    const tokenPercent = hasTokenQuota ? Math.min(100, Math.max(0, (tokenUsage / tokenLimit) * 100)) : 0;

    return (
        <div className="profile-page">
            <div className={`prof-content-scroll ${settingsPage ? 'prof-content-scroll--blurred' : ''}`}>
                {/* ── Hero ── */}
                <div className={`prof-hero ${expandedView ? 'prof-hero--compact' : ''}`}>
                    <div className="prof-hero-top-row">
                        <button
                            type="button"
                            className="prof-settings-btn"
                            onClick={() => { setIsModerationExpanded(false); setIsAccountExpanded(false); setShowSettingsMenu(true); }}
                            aria-label="Ouvrir les réglages"
                        >
                            <IoSettingsOutline size={22} color="rgba(10, 145, 104, 1)" />
                        </button>
                    </div>
                    <div className="prof-avatar">
                        {photoUrl
                            ? <img src={photoUrl} alt={displayName} className="prof-avatar__img" />
                            : <span className="prof-avatar__letter">{displayName.charAt(0).toUpperCase()}</span>
                        }
                    </div>
                    <h1 className="prof-name">{displayName}</h1>
                    {!expandedView && extendedUser?.surnom && <p className="prof-surnom">"{extendedUser.surnom}"</p>}
                    {!expandedView && extendedUser?.bio && <p className="prof-bio">{extendedUser.bio}</p>}

                    <div className="prof-stats">
                        <button className={`prof-stat-card ${expandedView === 'friends' ? 'prof-stat-card--active' : ''}`} onClick={() => toggleView('friends')}>
                            <IoPeopleOutline size={18} className="prof-stat-card__icon" />
                            <span className="prof-stat-card__value">{friendsCount ?? stats?.total_connexions ?? extendedUser?.nb_connexions ?? 0}</span>
                            <span className="prof-stat-card__label">Amis</span>
                        </button>
                        <button className={`prof-stat-card ${expandedView === 'calendar' ? 'prof-stat-card--active' : ''}`} onClick={() => toggleView('calendar')}>
                            <IoCalendarOutline size={18} className="prof-stat-card__icon" />
                            <span className="prof-stat-card__value">{calendarValue}</span>
                            <span className="prof-stat-card__label">{calendarLabel}</span>
                        </button>
                        <button className={`prof-stat-card ${expandedView === 'stats' ? 'prof-stat-card--active' : ''}`} onClick={() => toggleView('stats')}>
                            <IoStatsChartOutline size={18} className="prof-stat-card__icon" />
                            <span className="prof-stat-card__value">{daysOnEcho ? `${daysOnEcho}j` : '...'}</span>
                            <span className="prof-stat-card__label">Sur Echo</span>
                        </button>
                    </div>
                </div>

                {expandedView ? (
                    <section className="prof-inline-panel">
                        <header className="prof-inline-panel__header">
                            <button className="prof-inline-panel__back" onClick={() => setExpandedView(null)} aria-label="Fermer"><IoArrowBackOutline /></button>
                            <div><h2>{expandedView === 'friends' ? 'Amis et invitations' : expandedView === 'calendar' ? 'Calendrier' : 'Statistiques'}</h2><p>{expandedView === 'friends' ? 'Gérez vos connexions' : expandedView === 'calendar' ? 'Votre activité à venir' : 'Votre activité sur Echo'}</p></div>
                        </header>
                        {expandedView === 'friends' && <div className="prof-friend-actions"><button onClick={() => navigate('add-friend')}><IoPersonAddOutline />Ajouter un ami</button><button onClick={() => navigate('add-group')}><IoPeopleOutline />Gérer un groupe</button></div>}
                        <div className="prof-inline-panel__body">
                            {expandedView === 'friends' && <ExpandedFriends />}
                            {expandedView === 'calendar' && <ExpandedCalendar />}
                            {expandedView === 'stats' && <ExpandedStats />}
                        </div>
                    </section>
                ) : (
                    <div className="prof-feed">
                        <section className="prof-usage-dashboard">
                            <div className="prof-usage-dashboard__top">
                                <div><span className="prof-usage-dashboard__eyebrow">Utilisation IA</span><h2>{hasTokenQuota ? `${tokenUsage.toLocaleString('fr-FR')} tokens` : 'Votre utilisation'}</h2></div>
                                <span className="prof-usage-dashboard__period">Ce mois</span>
                            </div>
                            <div className={`prof-usage-progress ${!hasTokenQuota ? 'prof-usage-progress--pending' : ''}`}><span style={{ width: hasTokenQuota ? `${tokenPercent}%` : '28%' }} /></div>
                            <div className="prof-usage-dashboard__footer">
                                <span>{hasTokenQuota ? `${Math.round(tokenPercent)} % utilisé` : 'Le suivi des tokens apparaîtra ici'}</span>
                                <strong>{hasTokenQuota && tokenRemaining !== null ? `${tokenRemaining.toLocaleString('fr-FR')} restants` : 'Quota en attente'}</strong>
                            </div>
                        </section>
                        <section className={`prof-feedback ${feedbackOpen ? 'prof-feedback--open' : ''}`}>
                            <button className="prof-feedback__header" onClick={() => setFeedbackOpen(v => !v)}><span><IoChatbubbleEllipsesOutline />Votre avis nous intéresse</span>{feedbackOpen ? <IoChevronUpOutline /> : <IoChevronDownOutline />}</button>
                            {feedbackOpen && <div className="prof-feedback__content"><p>Une idée ? Une remarque ? Dites-nous ce que vous pensez de l'application !</p><textarea value={feedback} onChange={e => { setFeedback(e.target.value); setFeedbackState('idle'); }} placeholder="Écrivez votre message ici..." /><button className="prof-feedback__send" disabled={!feedback.trim() || feedbackState === 'sending'} onClick={() => void sendFeedback()}>{feedbackState === 'sending' ? 'Envoi…' : feedbackState === 'sent' ? 'Merci !' : <><span>Envoyer</span><IoSendOutline /></>}</button>{feedbackState === 'error' && <small>Impossible d’envoyer votre avis pour le moment.</small>}</div>}
                        </section>
                        <section className="prof-news" aria-label="Actualités Echo">
                            {news.map(item => <article className="prof-news-card" key={item.uuid}>
                                {item.first_media?.media_type === 'image' && <img src={item.first_media.file_url || item.first_media.thumbnail_url || ''} alt="" />}
                                <div><h3>{item.title}</h3><p>{item.description}</p></div>
                            </article>)}
                        </section>
                    </div>
                )}
            </div>

            {/* ── Settings sub-pages ── */}
            {settingsPage && (() => {
                const PAGE_META: Record<NonNullable<SettingsPageType>, { title: string; icon: React.ReactNode }> = {
                    edit:     { title: 'Modifier le profil',      icon: <IoCreateOutline size={18} /> },
                    ai:       { title: 'Fonctionnalités IA',      icon: <IoSparklesOutline size={18} /> },
                    blocked:  { title: 'Utilisateurs bloqués',    icon: <IoBanOutline size={18} /> },
                    archived: { title: 'Conversations archivées', icon: <IoArchiveOutline size={18} /> },
                    reports:  { title: 'Mes signalements',        icon: <IoFlagOutline size={18} /> },
                    oauth:    { title: 'Connexions OAuth',        icon: <IoLinkOutline size={18} /> },
                };
                const { title, icon } = PAGE_META[settingsPage];
                return (
                    <div className={`spage-overlay ${settingsPage === 'edit' ? 'spage-overlay--edit' : ''}`}>
                        <div className="spage-backdrop" onClick={() => setSettingsPage(null)} />
                        <div className={`spage-panel ${settingsPage === 'edit' ? 'spage-panel--edit' : ''}`}>
                            <div className="spage-header">
                                <button className="spage-back-btn" onClick={() => setSettingsPage(null)} aria-label="Retour">
                                    {settingsPage === 'edit' ? <IoCloseOutline size={19} /> : <IoChevronDownOutline size={18} style={{ transform: 'rotate(90deg)' }} />}
                                </button>
                                <div className="spage-header-icon">{icon}</div>
                                <h2 className="spage-title">{title}</h2>
                            </div>
                            <div className="spage-body">
                                {settingsPage === 'edit'     && <EditProfileForm onSaved={async () => { await reloadUser(); setSettingsPage(null); }} />}
                                {settingsPage === 'ai'       && <SettingsAiFeatures />}
                                {settingsPage === 'blocked'  && <SettingsBlockedUsers />}
                                {settingsPage === 'archived' && <SettingsArchivedConversations />}
                                {settingsPage === 'reports'  && <SettingsMyReports />}
                                {settingsPage === 'oauth'    && <SettingsOAuth />}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ── Settings menu ── */}
            {showSettingsMenu && (
                <div className="prof-settings-overlay" onClick={closeSettingsMenu}>
                        <div className="prof-settings-menu" onClick={(e) => e.stopPropagation()}>

                        <button type="button" className="prof-settings-item" onClick={() => { closeSettingsMenu(); setSettingsPage('edit'); }}>
                            <IoCreateOutline size={20} /><span>Modifier le profil</span>
                        </button>

                        <div className="prof-settings-group">
                            <button
                                type="button"
                                className="prof-settings-accordion-trigger"
                                onClick={() => { setIsModerationExpanded(p => !p); setIsAccountExpanded(false); }}
                            >
                                <span className="prof-settings-accordion-left">
                                    <IoShieldCheckmarkOutline size={20} />
                                    <span>Modération</span>
                                </span>
                                {isModerationExpanded ? <IoChevronUpOutline size={20} /> : <IoChevronDownOutline size={20} />}
                            </button>
                            {isModerationExpanded && (
                                <div className="prof-settings-accordion-content">
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setSettingsPage('ai'); }}>
                                        <IoSparklesOutline size={20} /><span>Fonctionnalités IA</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setSettingsPage('blocked'); }}>
                                        <IoBanOutline size={20} /><span>Utilisateurs bloqués</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setSettingsPage('archived'); }}>
                                        <IoArchiveOutline size={20} /><span>Conversations archivées</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setSettingsPage('reports'); }}>
                                        <IoFlagOutline size={20} /><span>Mes signalements</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="prof-settings-group">
                            <button
                                type="button"
                                className="prof-settings-accordion-trigger"
                                onClick={() => { setIsAccountExpanded(p => !p); setIsModerationExpanded(false); }}
                            >
                                <span className="prof-settings-accordion-left">
                                    <IoPersonCircleOutline size={20} />
                                    <span>Compte</span>
                                </span>
                                {isAccountExpanded ? <IoChevronUpOutline size={20} /> : <IoChevronDownOutline size={20} />}
                            </button>
                            {isAccountExpanded && (
                                <div className="prof-settings-accordion-content">
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setExpandedView('stats'); }}>
                                        <IoStatsChartOutline size={20} /><span>Statistiques</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setSettingsPage('oauth'); }}>
                                        <IoLinkOutline size={20} /><span>Connexions OAuth</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem" onClick={() => { closeSettingsMenu(); setShowEulaModal(true); }}>
                                        <IoDocumentTextOutline size={20} /><span>Conditions d&apos;utilisation</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem prof-settings-subitem--danger" onClick={() => { closeSettingsMenu(); void logout(); }}>
                                        <IoLogOutOutline size={20} /><span>Déconnexion</span>
                                    </button>
                                    <button type="button" className="prof-settings-subitem prof-settings-subitem--danger" onClick={() => { closeSettingsMenu(); void handleDeleteAccount(); }}>
                                        <IoTrashOutline size={20} /><span>Supprimer mon compte</span>
                                    </button>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}

            {/* ── EULA ── */}
            {showEulaModal && (
                <div className="prof-eula-overlay" onClick={() => setShowEulaModal(false)}>
                    <div className="prof-eula-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="prof-eula-header">
                            <h3 className="prof-eula-title">{CGU_TITLE}</h3>
                            <button type="button" className="prof-eula-close" onClick={() => setShowEulaModal(false)}>
                                <IoCloseOutline size={24} />
                            </button>
                        </div>
                        <div className="prof-eula-body">
                            <p className="prof-eula-text">{CGU_CONTENT}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function EditProfileForm({ onSaved }: { onSaved: () => Promise<void> }) {
    const { user } = useAuth();
    const current = user as any;
    const [username, setUsername] = useState(user?.username || '');
    const [email, setEmail] = useState(current?.email || '');
    const [surnom, setSurnom] = useState(current?.surnom || '');
    const [bio, setBio] = useState(current?.bio || '');
    const [photo, setPhoto] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = async (event: React.FormEvent) => {
        event.preventDefault(); setSaving(true); setError('');
        const body = new FormData();
        body.append('username', username); body.append('email', email);
        body.append('surnom', surnom); body.append('bio', bio);
        if (photo) body.append('photo_profil', photo);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/`, { method: 'PATCH', body });
            if (!response.ok) throw new Error();
            await onSaved();
        } catch { setError('Impossible de mettre à jour le profil.'); }
        finally { setSaving(false); }
    };

    return <form className="prof-edit-form" onSubmit={save}>
        <label className="prof-edit-avatar"><input type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] || null)} /><span>{photo ? photo.name : 'Changer la photo'}</span></label>
        <label>Nom d’utilisateur<input value={username} onChange={e => setUsername(e.target.value)} required /></label>
        <label>Adresse e-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Surnom<input value={surnom} onChange={e => setSurnom(e.target.value)} /></label>
        <label>Bio<textarea value={bio} onChange={e => setBio(e.target.value)} /></label>
        {error && <p className="prof-edit-error">{error}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form>;
}
