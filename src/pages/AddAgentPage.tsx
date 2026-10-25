import React, { useState } from 'react';
import { IoChevronBack, IoSearchOutline, IoSparklesOutline, IoStar, IoStarOutline } from 'react-icons/io5';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentFramework, type Agent } from '../hooks/useAgentFramework';
import { useConversations, type Conversation } from '../hooks/useConversations';
import { useAuth } from '../contexts/AuthContext';
import { conversationAgentUuid } from '../services/agentCollection';
import { webDatabaseManager } from '../services/webDatabase';
import { useNavigation } from '../contexts/NavigationContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import './AddPage.css';

export default function AddAgentPage() {
    const { navigate, openConversation } = useNavigation();
    const { user } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const { myAgents, publicAgents, isLoading, toggleFavorite } = useAgentFramework();
    const { agentConversations } = useConversations();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'mine' | 'public'>('mine');
    const [search, setSearch] = useState('');
    const [openingUuid, setOpeningUuid] = useState<string | null>(null);

    const agents = tab === 'mine' ? myAgents : publicAgents;
    const filtered = search.trim()
        ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
        : agents;

    const handleOpenAgent = async (agent: Agent) => {
        if (openingUuid) return;
        setOpeningUuid(agent.uuid);
        setError(null);
        try {
            // Look for existing conversation with this agent
            const existing = agentConversations.find(c => conversationAgentUuid(c) === agent.uuid);
            if (existing) {
                openConversation(existing);
                return;
            }
            const res = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/agents/create/`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent_uuid: agent.uuid }),
            });
            if (!res.ok) throw new Error('Impossible de créer cette conversation. Réessaie dans un instant.');
            const data = await res.json() as Partial<Conversation>;
            if (!data.uuid) throw new Error('La conversation créée ne contient pas d’identifiant.');
            const conversation: Conversation = {
                ...data, uuid: data.uuid, conversation_type: 'agent', unread_count: 0,
                name: agent.name, avatar_url: agent.avatar_url || '',
                framework_agent: { uuid: agent.uuid, name: agent.name, avatar_url: agent.avatar_url || '' },
            };
            if (user?.uuid) await webDatabaseManager.upsertConversation(conversation as unknown as Record<string, unknown>, user.uuid);
            await queryClient.invalidateQueries({ queryKey: ['conversations', 'agents'] });
            openConversation(conversation);
        } catch (error) { setError(error instanceof Error ? error.message : 'Impossible de créer la conversation.'); }
        finally { setOpeningUuid(null); }
    };

    return (
        <div className="add-page">
            <div className="add-page__top-vignette" aria-hidden="true" />
            <div className="add-page__header">
                <button className="add-page__back-btn" onClick={() => navigate('agents')}>
                    <IoChevronBack size={22} />
                </button>
                <div className="add-page__title-bubble">
                    <IoSparklesOutline size={18} className="add-page__header-icon" />
                    <span className="add-page__header-title">Nouvelle conversation</span>
                </div>
            </div>

            <div className="add-page__content">
                {error && <p role="alert">{error}</p>}
                {/* Tabs */}
                <div className="add-page__tabs">
                    <button className={`add-page__tab ${tab === 'mine' ? 'add-page__tab--active' : ''}`} onClick={() => setTab('mine')}>
                        Mes agents
                    </button>
                    <button className={`add-page__tab ${tab === 'public' ? 'add-page__tab--active' : ''}`} onClick={() => setTab('public')}>
                        Agents publics
                    </button>
                </div>

                {/* Search */}
                <div className="add-page__search-wrap">
                    <IoSearchOutline size={17} className="add-page__search-icon" />
                    <input
                        className="add-page__search"
                        placeholder="Rechercher un agent..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                {/* List */}
                <div className="add-page__agent-list">
                    {isLoading ? (
                        <div className="add-page__empty"><div className="add-page__spinner" /></div>
                    ) : filtered.length === 0 ? (
                        <div className="add-page__empty">
                            <IoSparklesOutline size={56} className="add-page__empty-icon" />
                            <p>{tab === 'mine' ? 'Aucun agent configuré' : 'Aucun agent public disponible'}</p>
                        </div>
                    ) : (
                        filtered.map(agent => (
                            <AgentRow
                                key={agent.uuid}
                                agent={agent}
                                isOpening={openingUuid === agent.uuid}
                                onFavorite={() => toggleFavorite(agent.uuid)}
                                onOpen={() => handleOpenAgent(agent)}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function AgentRow({ agent, isOpening, onFavorite, onOpen }: {
    agent: Agent;
    isOpening?: boolean;
    onFavorite: () => void;
    onOpen: () => void;
}) {
    return (
        <div className="add-page__agent-row" onClick={onOpen} style={{ cursor: 'pointer', opacity: isOpening ? 0.6 : 1 }}>
            <div className="add-page__agent-avatar">
                {agent.avatar_url ? (
                    <img src={agent.avatar_url} alt={agent.name} />
                ) : (
                    <IoSparklesOutline size={18} color="rgba(10,145,104,0.8)" />
                )}
            </div>
            <div className="add-page__agent-info">
                <span className="add-page__agent-name">{agent.name}</span>
                {agent.description && <span className="add-page__agent-desc">{agent.description}</span>}
            </div>
            <button
                className={`add-page__fav-btn ${agent.is_favorite ? 'add-page__fav-btn--active' : ''}`}
                onClick={e => { e.stopPropagation(); onFavorite(); }}
                title={agent.is_favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
                {agent.is_favorite ? <IoStar size={20} /> : <IoStarOutline size={20} />}
            </button>
        </div>
    );
}
