import React, { useState } from 'react';
import { IoChevronBack, IoSearchOutline, IoSparklesOutline, IoStar, IoStarOutline } from 'react-icons/io5';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentFramework, type Agent } from '../hooks/useAgentFramework';
import { useConversations } from '../hooks/useConversations';
import { useNavigation } from '../contexts/NavigationContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import './AddPage.css';

export default function AddAgentPage() {
    const { navigate, openConversation } = useNavigation();
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
        try {
            // Look for existing conversation with this agent
            const existing = agentConversations.find(c =>
                c.framework_agent?.uuid === agent.uuid ||
                c.agent_info?.uuid === agent.uuid ||
                (c as any).agent_uuid === agent.uuid
            );
            if (existing) {
                openConversation(existing);
                return;
            }
            // Create new conversation with this agent
            const res = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agent.uuid}/start-conversation/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (res.ok) {
                await queryClient.invalidateQueries({ queryKey: ['conversations', 'agents'] });
                // Fetch the updated list to find the new conversation
                const listRes = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/agents/`);
                if (listRes.ok) {
                    const data = await listRes.json();
                    const convs = Array.isArray(data) ? data : data.results || [];
                    const newConv = convs.find((c: any) =>
                        c.framework_agent?.uuid === agent.uuid ||
                        c.agent_info?.uuid === agent.uuid
                    );
                    if (newConv) {
                        const enriched = {
                            ...newConv,
                            conversation_type: 'agent' as const,
                            name: newConv.framework_agent?.name || agent.name || 'Agent',
                            avatar_url: newConv.framework_agent?.avatar_url || agent.avatar_url || '',
                        };
                        openConversation(enriched);
                        return;
                    }
                }
                // Fallback: just navigate to agents view
                navigate('agents');
            }
        } catch { /* silent */ }
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
