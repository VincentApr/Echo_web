import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    IoCheckmark, IoClose, IoCloudUploadOutline, IoDocumentTextOutline,
    IoLockClosedOutline, IoSearch, IoSparkles, IoStar, IoStarOutline,
    IoChatbubblesOutline, IoPeopleOutline,
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
import AgentIdentityDialog, { IdentityPanel } from '../components/agents/AgentIdentityDialog';
import { composeAgentPrompt, type IdentityContent, type IdentitySection } from '../utils/agentIdentity';
import { useMediaQuery } from '../hooks/useMediaQuery';
import './MarketplacePage.css';

type MarketplaceView = 'catalog' | 'mine' | 'create';
interface AgentDocument { id: string; name: string; content: string; size: number; }
interface CreatorForm { name: string; description: string; systemPrompt: string; documentation: string; visibility: 'private' | 'friends'; }

const EMPTY_FORM: CreatorForm = { name: '', description: '', systemPrompt: '', documentation: '', visibility: 'private' };

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
        return data.error || data.detail || fallback;
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
    const [editForm, setEditForm] = useState({ name: '', description: '', systemPrompt: '' });
    const [form, setForm] = useState<CreatorForm>(EMPTY_FORM);
    const [documents, setDocuments] = useState<AgentDocument[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [creatorError, setCreatorError] = useState<string | null>(null);
    const [creatorSuccess, setCreatorSuccess] = useState<string | null>(null);
    const [pendingFavorite, setPendingFavorite] = useState<{ uuid: string; name: string } | null>(null);
    const [retryingFavorite, setRetryingFavorite] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        setEditForm({ name: agent.name, description: agent.description, systemPrompt: agent.systemPrompt });
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
            setEditForm({ name: enriched.name, description: enriched.description, systemPrompt: enriched.systemPrompt });
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
            name: editForm.name.trim(),
            description: editForm.description.trim(),
            system_prompt: editForm.systemPrompt.trim(),
        });
        if (updated) setIsEditingAgent(false);
    };

    const toggleVisibility = async () => {
        if (!selectedAgent) return;
        await updateOwnedAgent({
            visibility: selectedAgent.visibility === 'private' ? 'friends' : 'private',
        });
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

    const handleFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setCreatorError(null);
        const next: AgentDocument[] = [];
        for (const file of Array.from(files)) {
            if (file.size > 1_500_000) {
                setCreatorError(`« ${file.name} » est trop volumineux (1,5 Mo maximum).`);
                continue;
            }
            try {
                next.push({ id: `${file.name}-${file.lastModified}-${file.size}`, name: file.name, content: await file.text(), size: file.size });
            } catch { setCreatorError(`Impossible de lire « ${file.name} » comme document texte.`); }
        }
        setDocuments((current) => {
            const existing = new Set(current.map((document) => document.id));
            return [...current, ...next.filter((document) => !existing.has(document.id))];
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
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
        if (!form.systemPrompt.trim() && !form.documentation.trim() && documents.length === 0) {
            setCreatorError('Ajoutez au moins des instructions ou une documentation.'); return;
        }
        const systemPrompt = composeAgentPrompt(
            form.systemPrompt.trim() || `Tu es ${form.name.trim()}, un agent spécialisé.`,
            form.documentation,
            documents,
        );

        setPendingFavorite(null);
        setIsCreating(true); setCreatorError(null); setCreatorSuccess(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/mistral/`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(), description: form.description.trim(), system_prompt: systemPrompt,
                    visibility: form.visibility,
                }),
            });
            if (!response.ok) throw new Error(await readError(response, "Impossible de créer l'agent."));
            const created = await response.json() as BackendAgent;
            const createdName = form.name.trim();
            setForm(EMPTY_FORM); setDocuments([]);
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
                <main className="agent-creator">
                    <AgentIdentityPreview form={form} documents={documents} />
                    <CreatorIntro step="1" title="Rôle" />
                    <section className="agent-creator__form">
                        <div className="agent-creator__row">
                            <label>Nom de l’agent<input value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex. Assistant juridique" /></label>
                            <label>Description<input value={form.description} maxLength={240} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ce que cet agent sait faire" /></label>
                        </div>
                        <label>Instructions système<textarea value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} placeholder="Tu es un avocat spécialisé en droit du travail français. Tu réponds de manière claire, tu cites tes sources et tu précises lorsqu’une information manque…" rows={7} /></label>
                    </section>
                    <CreatorIntro step="2" title="Connaissances" />
                    <section className="agent-creator__form">
                        <label>Documentation<textarea value={form.documentation} onChange={(event) => setForm({ ...form, documentation: event.target.value })} placeholder="Collez ici un extrait de code, une procédure interne, un guide produit…" rows={8} /></label>
                        <input ref={fileInputRef} className="agent-creator__file-input" type="file" multiple accept=".txt,.md,.csv,.json,.xml,.html" onChange={(event) => void handleFiles(event.target.files)} />
                        <button className="agent-creator__upload" type="button" onClick={() => fileInputRef.current?.click()}><IoCloudUploadOutline size={21} /><span><strong>Importer des documents</strong><small>TXT, Markdown, CSV, JSON, XML ou HTML · 1,5 Mo maximum</small></span></button>
                        {documents.length > 0 && <div className="agent-creator__documents">{documents.map((document) => <div key={document.id}><IoDocumentTextOutline size={18} /><span>{document.name}<small>{Math.max(1, Math.round(document.size / 1024))} Ko</small></span><button onClick={() => setDocuments((current) => current.filter((item) => item.id !== document.id))}><IoClose size={14} /></button></div>)}</div>}
                    </section>
                    <section className="agent-creator__publish">
                        <VisibilityChoice active={form.visibility === 'private'} icon={<IoLockClosedOutline size={20} />} title="Privé" hint="Visible uniquement par vous" onClick={() => setForm({ ...form, visibility: 'private' })} />
                        <VisibilityChoice active={form.visibility === 'friends'} icon={<IoPeopleOutline size={20} />} title="Amis uniquement" hint="Accessible uniquement à vous et à vos amis" onClick={() => setForm({ ...form, visibility: 'friends' })} />
                    </section>
                    {creatorError && <div className="agent-creator__message agent-creator__message--error">{creatorError}</div>}
                    {pendingFavorite && <button type="button" className="agent-creator__upload" disabled={isCreating || retryingFavorite} onClick={() => void retryFavorite()}>{retryingFavorite ? 'Ajout en cours…' : `Réessayer l’ajout de « ${pendingFavorite.name} » aux favoris`}</button>}
                    {creatorSuccess && <div className="agent-creator__message agent-creator__message--success"><IoCheckmark /> {creatorSuccess}</div>}
                    <button className="agent-creator__submit" onClick={() => void createAgent()} disabled={isCreating || retryingFavorite}>{isCreating ? 'Création…' : <><IoSparkles size={18} /> Créer mon agent</>}</button>
                </main>
            )}

            {activeAgent && <AgentIdentityDialog key={activeAgent.agentUuid} agent={activeAgent}
                loading={agentDetails.isPending} error={agentDetails.isError ? agentDetails.error.message : null}
                onRetry={() => void agentDetails.refetch()} onClose={closeDetails} onStopEditing={() => setIsEditingAgent(false)}
                editing={isEditingAgent ? <form className="identity-edit" onSubmit={event => { event.preventDefault(); void saveOwnedAgent(); }}>
                    <label>Nom<input autoFocus value={editForm.name} maxLength={100} onChange={event => setEditForm({ ...editForm, name: event.target.value })} /></label>
                    <label>Description<input value={editForm.description} maxLength={500} onChange={event => setEditForm({ ...editForm, description: event.target.value })} /></label>
                    <label>Instructions système<textarea value={editForm.systemPrompt} onChange={event => setEditForm({ ...editForm, systemPrompt: event.target.value })} rows={8} /></label>
                    <div className="identity-edit__actions"><button type="button" className="identity-white-button" disabled={agentActionPending} onClick={() => setIsEditingAgent(false)}>Annuler</button><button className="identity-white-button" disabled={agentActionPending}>Enregistrer</button></div>
                </form> : undefined}
                actions={<>
                    {catalogError && <p className="identity-dialog__error" role="alert">{catalogError}</p>}
                    <p className="identity-dialog__hint">Visibilité : {visibilityLabel(activeAgent.visibility)}</p>
                    {!isEditingAgent && <>
                        <div className="identity-actions">
                            <button className="identity-white-button" aria-pressed={activeAgent.isFavorite} disabled={favoritePending === activeAgent.agentUuid} onClick={() => void toggleFavorite(activeAgent)}>
                                {activeAgent.isFavorite ? <IoStar size={17} /> : <IoStarOutline size={17} />}{favoritePending === activeAgent.agentUuid ? 'Mise à jour…' : activeAgent.isFavorite ? 'Retirer de mes favoris' : 'Ajouter à mes favoris'}
                            </button>
                            <button className="identity-white-button" disabled={openingConversation || agentActionPending} onClick={() => void startConversation(activeAgent)}>
                                <IoChatbubblesOutline size={17} />{openingConversation ? 'Ouverture…' : 'Commencer une conversation'}
                            </button>
                        </div>
                        {activeAgent.isMine && !openingConversation && <div className="identity-actions">
                            <button className="identity-white-button" disabled={agentDetails.isPending || agentDetails.isError || agentActionPending} onClick={() => {
                                setEditForm({ name: activeAgent.name, description: activeAgent.description, systemPrompt: activeAgent.systemPrompt });
                                setIsEditingAgent(true);
                            }}><IoCreateOutline size={17} />Modifier</button>
                            <button className="identity-white-button" disabled={agentActionPending} onClick={() => void toggleVisibility()}>{activeAgent.visibility === 'private' ? <IoPeopleOutline size={17} /> : <IoLockClosedOutline size={17} />}{activeAgent.visibility === 'private' ? 'Partager avec mes amis' : 'Rendre privé'}</button>
                            {!confirmDelete ? <button className="identity-white-button identity-white-button--danger" disabled={agentActionPending} onClick={() => setConfirmDelete(true)}><IoTrashOutline size={17} />Supprimer</button>
                                : <div className="identity-delete-confirm"><span>Supprimer cet agent ?</span><button className="identity-white-button" disabled={agentActionPending} onClick={() => setConfirmDelete(false)}>Non</button><button className="identity-white-button identity-white-button--danger" disabled={agentActionPending} onClick={() => void deleteOwnedAgent()}>Oui</button></div>}
                        </div>}
                        <p className="identity-dialog__hint">Les favoris apparaissent dans + → Agents au sein de vos conversations.</p>
                    </>}
                </>} />}

        </div>
    );
}

function visibilityLabel(visibility: ToolItem['visibility']) {
    return visibility === 'friends' ? 'Amis uniquement' : visibility === 'public' ? 'Public' : 'Privé';
}

function CreatorIntro({ step, title }: { step: string; title: string }) {
    return <section className="agent-creator__intro"><span className="agent-creator__step">{step}</span><h2>{title}</h2></section>;
}

function VisibilityChoice({ active, icon, title, hint, onClick }: { active: boolean; icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
    return <button className={`agent-creator__visibility ${active ? 'is-active' : ''}`} onClick={onClick}>{icon}<span><strong>{title}</strong><small>{hint}</small></span>{active && <IoCheckmark />}</button>;
}

function AgentIdentityPreview({ form, documents }: { form: CreatorForm; documents: AgentDocument[] }) {
    const [section, setSection] = useState<IdentitySection | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const overlay = useMediaQuery('(max-width: 1250px)');
    const close = () => { setSection(null); requestAnimationFrame(() => trigger.current?.focus()); };
    const agent = enrichAgent({ uuid: 'draft', name: form.name.trim() || 'Votre agent', description: form.description.trim() || 'Son rôle, en quelques mots.', system_prompt: form.systemPrompt });
    const content: IdentityContent = { instructions: form.systemPrompt, context: form.documentation, documents, tools: [] };
    return <section className="agent-creator__identity-preview" aria-label="Aperçu de la carte">
        <p>Votre carte prend forme. Cliquez sur une rubrique pour consulter son contenu.</p>
        <div className="identity-preview__row" onKeyDown={event => { if (event.key === 'Escape' && section) { event.stopPropagation(); close(); } }}>
            <AgentIdentityCard agent={agent} content={content} inert={overlay && Boolean(section)} activeSection={section} onSection={(next, button) => { trigger.current = button; setSection(next); }} />
            {section && <IdentityPanel section={section} content={content} onClose={close} />}
        </div>
    </section>;
}
