import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    IoCheckmark, IoClose,
    IoSearch, IoSparkles, IoStar, IoStarOutline,
    IoChatbubblesOutline,
    IoCreateOutline, IoTrashOutline, IoCompassOutline, IoPersonOutline, IoAddOutline,
} from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useNavigation } from '../contexts/NavigationContext';
import { useAuth } from '../contexts/AuthContext';
import { useConversations, type Conversation } from '../hooks/useConversations';
import { webDatabaseManager } from '../services/webDatabase';
import { TOOL_CATEGORIES, enrichAgent, type BackendAgent, type ToolItem } from '../data/toolsCatalog';
import { ensureAgentFavorite } from '../services/agentFavorites';
import AgentIdentityCard from '../components/agents/AgentIdentityCard';
import AgentActionRow from '../components/agents/AgentActionRow';
import AgentIdentityDialog from '../components/agents/AgentIdentityDialog';
import { agentDraft, draftPayload, emptyAgentDraft, type AgentDraft } from '../utils/agentIdentity';
import AgentIdentityEditor from '../components/agents/AgentIdentityEditor';
import './MarketplacePage.css';

type MarketplaceView = 'catalog' | 'mine' | 'create';
function normalizeAgentList(payload: unknown): BackendAgent[] {
    if (Array.isArray(payload)) return payload as BackendAgent[];
    if (!payload || typeof payload !== 'object') return [];
    const data = payload as Record<string, unknown>;
    if (Array.isArray(data.results)) return data.results as BackendAgent[];
    const created = Array.isArray(data.created_agents) ? data.created_agents : [];
    const favorites = Array.isArray(data.favorite_agents) ? data.favorite_agents : [];
    const unique = new Map<string, BackendAgent>();
    [...created, ...favorites].forEach((agent) => {
        const item = agent as BackendAgent;
        if (item.uuid) unique.set(item.uuid, { ...unique.get(item.uuid), ...item });
    });
    return [...unique.values()];
}

async function readError(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json();
        const messages = (value: unknown): string[] => typeof value === 'string' ? [value]
            : Array.isArray(value) ? value.flatMap(messages)
            : value && typeof value === 'object' ? Object.values(value).flatMap(messages) : [];
        return messages(data.error || data.detail || data).join(' ') || fallback;
    } catch { return fallback; }
}

export default function MarketplacePage() {
    const queryClient = useQueryClient();
    const { openConversation } = useNavigation();
    const { user } = useAuth();
    const { agentConversations } = useConversations();
    const [openingConversation, setOpeningConversation] = useState(false);
    const openingConversationRef = useRef(false);
    const [view, setView] = useState<MarketplaceView>('catalog');
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<ToolItem | null>(null);
    const [favoritePending, setFavoritePending] = useState<string | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [agentActionPending, setAgentActionPending] = useState(false);
    const [isEditingAgent, setIsEditingAgent] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [editForm, setEditForm] = useState<AgentDraft>(emptyAgentDraft);
    const [form, setForm] = useState<AgentDraft>(emptyAgentDraft);
    const [isCreating, setIsCreating] = useState(false);
    const [creatorError, setCreatorError] = useState<string | null>(null);
    const [creatorSuccess, setCreatorSuccess] = useState<string | null>(null);
    const [pendingFavorite, setPendingFavorite] = useState<{ uuid: string; name: string } | null>(null);
    const [retryingFavorite, setRetryingFavorite] = useState(false);

    const { data: agents = [], isLoading } = useQuery({
        queryKey: ['agents', 'marketplace'],
        queryFn: async (): Promise<ToolItem[]> => {
            const [publicResponse, mineResponse] = await Promise.all([
                fetchWithAuth(`${API_BASE_URL}/framework/agents/public/`),
                fetchWithAuth(`${API_BASE_URL}/framework/agents/`),
            ]);
            const publicPayload = publicResponse.ok ? await publicResponse.json() : [];
            const minePayload = mineResponse.ok ? await mineResponse.json() : [];
            const mine = normalizeAgentList(minePayload);
            const favoriteUuids = new Set(mine.filter((agent) => agent.is_favorite).map((agent) => agent.uuid));
            return normalizeAgentList(publicPayload).filter((agent) => agent.visibility ? agent.visibility === 'public' : agent.is_public).map((agent) => enrichAgent({
                ...agent,
                is_favorite: Boolean(agent.is_favorite || favoriteUuids.has(agent.uuid)),
            }));
        },
        staleTime: 2 * 60_000,
    });

    const { data: myAgents = [], isLoading: isLoadingMine } = useQuery({
        queryKey: ['agents', 'mine', 'marketplace'],
        queryFn: async (): Promise<ToolItem[]> => {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/`);
            if (!response.ok) return [];
            const payload = await response.json();
            if (payload && !Array.isArray(payload) && Array.isArray(payload.created_agents)) {
                return (payload.created_agents as BackendAgent[]).map((agent) => enrichAgent({ ...agent, is_mine: true }));
            }
            return normalizeAgentList(payload).filter((agent) => agent.is_mine).map(enrichAgent);
        },
        staleTime: 2 * 60_000,
    });

    const agentDetails = useQuery({
        queryKey: ['agents', 'identity', selectedAgent?.agentUuid],
        enabled: Boolean(selectedAgent),
        queryFn: async ({ signal }): Promise<BackendAgent> => {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${selectedAgent!.agentUuid}/`, { signal });
            if (!response.ok) throw new Error(await readError(response, 'Impossible de charger les informations de cet agent.'));
            const data = await response.json() as BackendAgent;
            if (data.uuid !== selectedAgent!.agentUuid) throw new Error('La fiche reçue ne correspond pas à cet agent.');
            return data;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
    const activeAgent = selectedAgent && agentDetails.data ? {
        ...enrichAgent(agentDetails.data),
        isFavorite: selectedAgent.isFavorite,
        isMine: selectedAgent.isMine,
        visibility: agentDetails.data.visibility ?? selectedAgent.visibility,
    } : selectedAgent;

    const displayedAgents = useMemo(() => {
        const query = search.trim().toLowerCase();
        const source = view === 'mine' ? myAgents : agents;
        return source.filter((agent) => {
            const matchesCategory = !activeCategory || agent.categoryId === activeCategory;
            const matchesSearch = !query || [agent.name, agent.description, agent.longDescription, ...agent.examples]
                .some((value) => value.toLowerCase().includes(query));
            return matchesCategory && matchesSearch;
        });
    }, [activeCategory, agents, myAgents, search, view]);

    const closeDetails = useCallback(() => {
        if (openingConversationRef.current || agentActionPending) return;
        setSelectedAgent(null);
        setIsEditingAgent(false);
        setConfirmDelete(false);
    }, [agentActionPending]);

    const startConversation = async (agent: ToolItem) => {
        if (openingConversationRef.current || agentActionPending) return;
        openingConversationRef.current = true;
        setOpeningConversation(true);
        setCatalogError(null);
        try {
            let conversation = agentConversations.find(item => !item.is_archived && (
                item.framework_agent?.uuid === agent.agentUuid || item.agent_info?.uuid === agent.agentUuid
            ));
            if (!conversation) {
                const response = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/agents/create/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ agent_uuid: agent.agentUuid }),
                });
                if (!response.ok) throw new Error(await readError(response, 'Impossible de commencer cette conversation.'));
                const created = await response.json() as Partial<Conversation>;
                if (!created.uuid) throw new Error('La conversation créée ne contient pas d’identifiant.');
                conversation = {
                    ...created,
                    uuid: created.uuid,
                    conversation_type: 'agent',
                    unread_count: created.unread_count ?? 0,
                    name: created.framework_agent?.name || created.agent_info?.name || agent.name,
                    avatar_url: created.framework_agent?.avatar_url || created.agent_info?.avatar_url || agent.avatarUrl || '',
                    framework_agent: created.framework_agent || { uuid: agent.agentUuid, name: agent.name, avatar_url: agent.avatarUrl || '' },
                };
                if (user?.uuid) await webDatabaseManager.upsertConversation(conversation as unknown as Record<string, unknown>, user.uuid);
                await queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
            openingConversationRef.current = false;
            closeDetails();
            openConversation(conversation);
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : 'Impossible de commencer cette conversation.');
        } finally {
            openingConversationRef.current = false;
            setOpeningConversation(false);
        }
    };

    const openDetails = (agent: ToolItem) => {
        setSelectedAgent(agent);
        setEditForm(agentDraft(agent));
        setIsEditingAgent(false);
        setConfirmDelete(false);
        setCatalogError(null);
    };

    const toggleFavorite = async (agent: ToolItem) => {
        if (favoritePending) return;
        setCatalogError(null);
        setFavoritePending(agent.agentUuid);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agent.agentUuid}/favorite/`, { method: 'POST' });
            if (!response.ok) throw new Error(await readError(response, 'Impossible de modifier les favoris.'));
            const result = await response.json();
            const isFavorite = typeof result.is_favorite === 'boolean' ? result.is_favorite : !agent.isFavorite;
            setSelectedAgent((current) => current?.id === agent.id ? { ...current, isFavorite } : current);
            queryClient.setQueryData<ToolItem[]>(['agents', 'marketplace'], (current = []) => (
                current.map((item) => item.id === agent.id ? { ...item, isFavorite } : item)
            ));
            queryClient.setQueryData<ToolItem[]>(['agents', 'mine', 'marketplace'], (current = []) => (
                current.map((item) => item.id === agent.id ? { ...item, isFavorite } : item)
            ));
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : 'Impossible de modifier les favoris.');
        } finally { setFavoritePending(null); }
    };

    const updateOwnedAgent = async (data: Record<string, unknown>) => {
        if (!selectedAgent || agentActionPending) return null;
        setAgentActionPending(true);
        setCatalogError(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${selectedAgent.agentUuid}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) throw new Error(await readError(response, "Impossible de modifier l'agent."));
            const updated = await response.json() as BackendAgent;
            const enriched = enrichAgent({
                ...updated,
                is_mine: true,
                is_favorite: updated.is_favorite ?? selectedAgent.isFavorite,
                visibility: updated.visibility ?? (data.visibility as BackendAgent['visibility']) ?? selectedAgent.visibility,
            });
            setSelectedAgent(enriched);
            queryClient.setQueryData(['agents', 'identity', enriched.agentUuid], updated);
            setEditForm(agentDraft(enriched));
            queryClient.setQueryData<ToolItem[]>(['agents', 'mine', 'marketplace'], (current = []) => (
                current.map((item) => item.id === enriched.id ? enriched : item)
            ));
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            return enriched;
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : "Impossible de modifier l'agent.");
            return null;
        } finally { setAgentActionPending(false); }
    };

    const saveOwnedAgent = async () => {
        if (!editForm.name.trim()) { setCatalogError("Le nom de l'agent est obligatoire."); return; }
        const updated = await updateOwnedAgent({
            ...draftPayload(editForm),
            visibility: editForm.visibility,
            ...(activeAgent?.agentType === 'ToolAgent' ? { tool_uuids: editForm.tools.map(tool => tool.uuid) } : {}),
        });
        if (updated) setIsEditingAgent(false);
    };

    const deleteOwnedAgent = async () => {
        if (!selectedAgent || agentActionPending) return;
        setAgentActionPending(true);
        setCatalogError(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${selectedAgent.agentUuid}/`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await readError(response, "Impossible de supprimer l'agent."));
            const deletedId = selectedAgent.id;
            queryClient.setQueryData<ToolItem[]>(['agents', 'mine', 'marketplace'], (current = []) => current.filter((item) => item.id !== deletedId));
            closeDetails();
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : "Impossible de supprimer l'agent.");
        } finally { setAgentActionPending(false); }
    };

    const retryFavorite = async () => {
        if (!pendingFavorite || retryingFavorite || isCreating) return;
        setRetryingFavorite(true); setCreatorError(null);
        try {
            await ensureAgentFavorite(pendingFavorite.uuid);
            setCreatorSuccess(`« ${pendingFavorite.name} » a été ajouté aux favoris.`);
            setPendingFavorite(null);
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
        } catch {
            setCreatorError('Impossible de confirmer l’ajout aux favoris. Réessayez dans un instant.');
        } finally { setRetryingFavorite(false); }
    };

    const createAgent = async () => {
        if (!form.name.trim()) { setCreatorError("Donnez un nom à l'agent."); return; }
        if (!form.instructions.trim() && !form.context.trim() && form.documents.length === 0) {
            setCreatorError('Ajoutez au moins des instructions ou une documentation.'); return;
        }
        setPendingFavorite(null);
        setIsCreating(true); setCreatorError(null); setCreatorSuccess(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/tools/`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...draftPayload(form),
                    tool_uuids: form.tools.map(tool => tool.uuid),
                    visibility: form.visibility,
                }),
            });
            if (!response.ok) throw new Error(await readError(response, "Impossible de créer l'agent."));
            const created = await response.json() as BackendAgent;
            const createdName = form.name.trim();
            setForm(emptyAgentDraft);
            setPendingFavorite({ uuid: created.uuid, name: createdName });
            try {
                await ensureAgentFavorite(created.uuid);
                setPendingFavorite(null);
                setCreatorSuccess(`« ${createdName} » a été créé et ajouté aux favoris.`);
            } catch {
                setCreatorSuccess(`« ${createdName} » a été créé.`);
                setCreatorError('L’ajout aux favoris n’a pas pu être confirmé. Vous pouvez réessayer sans recréer l’agent.');
            }
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
        } catch (error) {
            setCreatorError(error instanceof Error ? error.message : "Impossible de créer l'agent.");
        } finally { setIsCreating(false); }
    };

    return (
        <div className="marketplace-page">
            <div className="marketplace-page__vignette" aria-hidden="true" />
            <header className="marketplace-header">
                <div>
                    <h1>Agents</h1>
                </div>
                <div className="marketplace-switch" role="tablist" aria-label="Marketplace d'agents">
                    <button className={view === 'catalog' ? 'is-active' : ''} onClick={() => setView('catalog')} aria-label="Découvrir" title="Découvrir">
                        <IoCompassOutline size={17} />{view === 'catalog' && <span>Découvrir</span>}
                    </button>
                    <button className={view === 'mine' ? 'is-active' : ''} onClick={() => setView('mine')} aria-label="Mes Agents" title="Mes Agents">
                        <IoPersonOutline size={17} />{view === 'mine' && <span>Mes Agents</span>}
                    </button>
                    <button className={view === 'create' ? 'is-active' : ''} onClick={() => setView('create')} aria-label="Créer" title="Créer">
                        <IoAddOutline size={19} />{view === 'create' && <span>Créer</span>}
                    </button>
                </div>
            </header>

            {view !== 'create' ? (
                <main className="marketplace-catalog">
                    <div className="marketplace-toolbar">
                        <div className="marketplace-search">
                            <IoSearch size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === 'mine' ? 'Rechercher dans mes agents…' : 'Rechercher un agent ou un besoin…'} />
                            {search && <button onClick={() => setSearch('')} aria-label="Effacer"><IoClose size={14} /></button>}
                        </div>
                    </div>
                    <div className="marketplace-categories">
                        <button className={!activeCategory ? 'is-active' : ''} onClick={() => setActiveCategory(null)}>Tous</button>
                        {TOOL_CATEGORIES.map((category) => <button key={category.id} className={activeCategory === category.id ? 'is-active' : ''} onClick={() => setActiveCategory(category.id)}>{category.name}</button>)}
                    </div>
                    {catalogError && <div className="marketplace-catalog__error">{catalogError}</div>}
                    {(view === 'mine' ? isLoadingMine : isLoading) ? (
                        <div className="marketplace-grid">{Array.from({ length: 6 }).map((_, index) => <div className="agent-card agent-card--skeleton" key={index} />)}</div>
                    ) : displayedAgents.length === 0 ? (
                        <div className="marketplace-empty"><IoSparkles size={42} /><strong>{view === 'mine' ? 'Aucun agent créé' : 'Aucun agent trouvé'}</strong><span>{view === 'mine' ? 'Créez votre premier agent.' : 'Essayez une autre recherche.'}</span></div>
                    ) : (
                        <div className="marketplace-grid">
                            {displayedAgents.map((agent) => <AgentIdentityCard key={agent.id} agent={agent} compact
                                visibilityLabel={view === 'mine' ? visibilityLabel(agent.visibility) : undefined}
                                onOpen={() => openDetails(agent)} />)}
                        </div>
                    )}
                </main>
            ) : (
                <main className="identity-creator-page">
                    <AgentIdentityEditor draft={form} onChange={setForm} busy={isCreating || retryingFavorite} status={<>
                        {creatorError && <p className="identity-dialog__error" role="alert">{creatorError}</p>}
                        {creatorSuccess && <p className="identity-dialog__status" role="status"><IoCheckmark /> {creatorSuccess}</p>}
                    </>} actions={<>
                            {pendingFavorite && <button type="button" className="identity-white-button" onClick={() => void retryFavorite()}>{retryingFavorite ? 'Ajout en cours…' : `Réessayer l’ajout de « ${pendingFavorite.name} » aux favoris`}</button>}
                            <button type="button" className="identity-white-button" onClick={() => void createAgent()}>{isCreating ? 'Création…' : 'Créer mon agent'}</button>
                    </>} />
                </main>
            )}

            {activeAgent && <AgentIdentityDialog key={activeAgent.agentUuid} agent={activeAgent}
                loading={agentDetails.isPending} error={agentDetails.isError ? agentDetails.error.message : null}
                onRetry={() => void agentDetails.refetch()} onClose={closeDetails} onStopEditing={() => { if (!agentActionPending) { setIsEditingAgent(false); setCatalogError(null); } }}
                editing={isEditingAgent ? <AgentIdentityEditor draft={editForm} onChange={setEditForm} agent={activeAgent} busy={agentActionPending} status={catalogError && <p className="identity-dialog__error" role="alert">{catalogError}</p>} actions={<>
                    <button type="button" className="identity-white-button" onClick={() => { setIsEditingAgent(false); setCatalogError(null); }}>Quitter la modification</button><button type="button" className="identity-white-button" onClick={() => void saveOwnedAgent()}>{agentActionPending ? 'Enregistrement…' : 'Enregistrer'}</button>
                </>} /> : undefined}
                actions={resetPanel => <>
                    {catalogError && <p className="identity-dialog__error" role="alert">{catalogError}</p>}
                    <p className="identity-dialog__hint">Visibilité : {visibilityLabel(activeAgent.visibility)}</p>
                    {!isEditingAgent && <>
                        <AgentActionRow>
                            <button className="identity-white-button" aria-pressed={activeAgent.isFavorite} disabled={favoritePending === activeAgent.agentUuid} onClick={() => void toggleFavorite(activeAgent)}>
                                {activeAgent.isFavorite ? <IoStar size={17} /> : <IoStarOutline size={17} />}{favoritePending === activeAgent.agentUuid ? 'Mise à jour…' : activeAgent.isFavorite ? 'Retirer de mes favoris' : 'Ajouter à mes favoris'}
                            </button>
                            <button className="identity-white-button" disabled={openingConversation || agentActionPending} onClick={() => void startConversation(activeAgent)}>
                                <IoChatbubblesOutline size={17} />{openingConversation ? 'Ouverture…' : 'Commencer une conversation'}
                            </button>
                        {activeAgent.isMine && !openingConversation && <>
                            <button className="identity-white-button" disabled={agentDetails.isPending || agentDetails.isError || agentActionPending} onClick={() => {
                                resetPanel();
                                setEditForm(agentDraft(activeAgent));
                                setIsEditingAgent(true);
                            }}><IoCreateOutline size={17} />Modifier</button>
                            {!confirmDelete ? <button className="identity-white-button identity-white-button--danger" disabled={agentActionPending} onClick={() => setConfirmDelete(true)}><IoTrashOutline size={17} />Supprimer</button>
                                : <div className="identity-delete-confirm"><span>Supprimer cet agent ?</span><button className="identity-white-button" disabled={agentActionPending} onClick={() => setConfirmDelete(false)}>Non</button><button className="identity-white-button identity-white-button--danger" disabled={agentActionPending} onClick={() => void deleteOwnedAgent()}>Oui</button></div>}
                        </>}
                        </AgentActionRow>
                        <p className="identity-dialog__hint">Les favoris apparaissent dans + → Agents au sein de vos conversations.</p>
                    </>}
                </>} />}

        </div>
    );
}

function visibilityLabel(visibility: ToolItem['visibility']) {
    return visibility === 'friends' ? 'Amis uniquement' : visibility === 'public' ? 'Public' : 'Privé';
}
